"""Read the same daily US AQI calendar endpoint used by AQI.in's website.

The anonymous website client configuration is read from a public page snapshot.
No browser profile, cookies, account credentials or desktop controls are used.
"""
from __future__ import annotations

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .data import CITIES, SHANGHAI, City, valid_number

REGIONS = {"hangzhou": "zhejiang", "jinhua": "zhejiang", "sanya": "hainan", "beijing": "beijing"}
API_ENDPOINT = "https://apiserver.aqi.in/aqi/v2/getAqiCalender"


def city_slug(city: str | City) -> str:
    key = city if isinstance(city, str) else city.key
    return (city.slug if isinstance(city, City) and city.slug else f"china/{REGIONS[key]}/{key}")


def calendar_url(city: str | City, year: int) -> str:
    return API_ENDPOINT + "?" + urlencode({"slug": city_slug(city), "slugType": "cityId",
                                         "sensorname": "aqi", "year": str(year), "source": "web"})


def parse_calendar(payload: dict, *, year: int, cutoff: date) -> dict[str, float]:
    if not isinstance(payload, dict) or payload.get("status") != "success" or not isinstance(payload.get("data"), list):
        raise ValueError("AQI.in 日历接口未返回成功的逐日记录。")
    values = {}
    for row in payload["data"]:
        if not isinstance(row, dict):
            raise ValueError("AQI.in 日历记录格式错误。")
        try:
            day = date.fromisoformat(row["day"])
            value = row["value"]
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("AQI.in 日历记录缺少有效日期或日 AQI。") from error
        if day.year != year or not valid_number(value) or isinstance(value, bool):
            raise ValueError("AQI.in 日历包含年份不符或无效的日 AQI。")
        if str(day) in values:
            raise ValueError(f"AQI.in 日历出现重复日期：{day}")
        if day <= cutoff:
            values[str(day)] = value
    return values


def load_api_snapshots(city: str | City, directory: Path, cutoff: date):
    key = city if isinstance(city, str) else city.key
    values, receipts = {}, []
    for file in sorted((directory / "api").glob(key + "-*.json")):
        match = re.fullmatch(re.escape(key) + r"-(20\d{2})\.json", file.name)
        if not match:
            continue
        year = int(match[1])
        raw = file.read_bytes()
        receipt = json.loads(file.with_suffix(".receipt.json").read_text(encoding="utf-8"))
        digest = hashlib.sha256(raw).hexdigest()
        if (receipt.get("sha256") != digest or receipt.get("request_url") != calendar_url(city, year)
                or receipt.get("standard") != "AQI-US" or receipt.get("sensorname") != "aqi"
                or receipt.get("period") != "daily" or receipt.get("city") != key
                or receipt.get("year") != year or receipt.get("http_status") != 200):
            raise ValueError(f"AQI.in 接口快照的来源、标准或文件哈希不符：{file}")
        parsed = parse_calendar(json.loads(raw), year=year, cutoff=cutoff)
        values.update(parsed)
        receipts.append({"file": "api/" + file.name, "sha256": digest, "parsed_days": len(parsed),
                         "request_url": receipt["request_url"], "retrieved_at": receipt["retrieved_at"]})
    return values, receipts


class _Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.active = True

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False


def published_client_token(html: str) -> str:
    """Decode public Next.js bootstrap strings as JSON, without executing JS."""
    parser = _Scripts()
    parser.feed(html)
    flight = []
    prefix = "self.__next_f.push("
    for script in parser.parts:
        if script.startswith(prefix + "[1,"):
            record, _ = json.JSONDecoder().raw_decode(script[len(prefix):])
            flight.append(record[1])
    stream = "".join(flight)
    try:
        store, _ = json.JSONDecoder().raw_decode(stream.split('"siteStore":', 1)[1])
        token = store["token2"]
    except (IndexError, KeyError, ValueError) as error:
        raise ValueError("公开页面快照中未找到官网日历客户端配置；请更新该快照。") from error
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", token):
        raise ValueError("官网日历客户端配置格式无效。")
    return token


def refresh_calendars(start: date, end: date, directory: Path, page: Path, *, cities=CITIES, years=None):
    """Fetch and validate all requested years before replacing any local cache."""
    token = published_client_token(page.read_text(encoding="utf-8"))

    def fetch(task):
        city, year = task
        url = calendar_url(city, year)
        request = Request(url, headers={"Authorization": "bearer " + token, "Accept": "application/json"})
        with urlopen(request, timeout=30) as response:
            raw = response.read()
            status = response.status
        payload = json.loads(raw)
        values = parse_calendar(payload, year=year, cutoff=end)
        receipt = {"request_url": url,
                   "source_url": f"https://www.aqi.in/dashboard/{city_slug(city)}/historical-analysis",
                   "http_status": status, "retrieved_at": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
                   "sha256": hashlib.sha256(raw).hexdigest(), "standard": "AQI-US", "sensorname": "aqi",
                   "period": "daily", "year": year, "city": city.key, "rows": len(payload["data"]),
                   "in_range_rows": sum(str(start) <= day <= str(end) for day in values)}
        return city, year, raw, receipt

    requested_years = range(start.year, end.year + 1) if years is None else sorted(set(years))
    if any(year < start.year or year > end.year for year in requested_years):
        raise ValueError("请求年份超出报告范围。")
    tasks = [(city, year) for city in cities for year in requested_years]
    with ThreadPoolExecutor(max_workers=3) as pool:
        fetched = list(pool.map(fetch, tasks))
    for city in cities:
        if not sum(receipt["in_range_rows"] for fetched_city, _, _, receipt in fetched if fetched_city.key == city.key):
            raise ValueError(f"{city.name} 在当前日期范围没有已发布的美标历史日值。")
    target = directory / "api"
    target.mkdir(parents=True, exist_ok=True)
    for city, year, raw, receipt in fetched:
        file = target / f"{city.key}-{year}.json"
        file.write_bytes(raw)
        file.with_suffix(".receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"后台更新 {city.name} {year}：{receipt['rows']} 条 AQI-US 日值。")
