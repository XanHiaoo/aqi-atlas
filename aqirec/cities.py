"""Search the approved platform and retain user-added city metadata."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .aqiin_api import city_slug, published_client_token
from .data import CITIES, City

SEARCH_ENDPOINT = "https://apiserver.aqi.in/aqi/searchLocationCityStateCountry"
ALIASES = dict(pair.split(":", 1) for pair in (
    "杭州:Hangzhou 金华:Jinhua 三亚:Sanya 北京:Beijing 上海:Shanghai 天津:Tianjin 重庆:Chongqing "
    "广州:Guangzhou 深圳:Shenzhen 成都:Chengdu 南京:Nanjing 苏州:Suzhou 无锡:Wuxi 常州:Changzhou "
    "宁波:Ningbo 温州:Wenzhou 绍兴:Shaoxing 嘉兴:Jiaxing 湖州:Huzhou 舟山:Zhoushan 台州:Taizhou 丽水:Lishui 衢州:Quzhou "
    "武汉:Wuhan 长沙:Changsha 郑州:Zhengzhou 西安:Xian 济南:Jinan 青岛:Qingdao 厦门:Xiamen 福州:Fuzhou "
    "合肥:Hefei 南昌:Nanchang 南宁:Nanning 昆明:Kunming 贵阳:Guiyang 海口:Haikou 珠海:Zhuhai 佛山:Foshan "
    "东莞:Dongguan 惠州:Huizhou 中山:Zhongshan 大连:Dalian 沈阳:Shenyang 长春:Changchun 哈尔滨:Harbin "
    "石家庄:Shijiazhuang 太原:Taiyuan 兰州:Lanzhou 西宁:Xining 银川:Yinchuan 乌鲁木齐:Urumqi 呼和浩特:Hohhot "
    "拉萨:Lhasa 香港:Hong Kong 澳门:Macau 台北:Taipei 东京:Tokyo 大阪:Osaka 首尔:Seoul 新加坡:Singapore "
    "曼谷:Bangkok 伦敦:London 巴黎:Paris 纽约:New York 洛杉矶:Los Angeles 悉尼:Sydney 墨尔本:Melbourne"
).split(" ") if pair and ":" in pair)
# Names containing spaces are kept explicitly, rather than split into words.
ALIASES.update({"香港": "Hong Kong", "纽约": "New York", "洛杉矶": "Los Angeles"})
ALIASES.update({"泰州": "Taizhou", "宿州": "Suzhou"})
ALIASES["东京都"] = "Tokyo"


@dataclass(frozen=True)
class Region(City):
    search_type: str = "stateId"


def region_from_location(row: dict) -> Region:
    slug = row.get("slug", "")
    if row.get("searchType") != "stateId" or not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]+/[a-z0-9-]+", slug):
        raise ValueError("请选择 AQI.in 返回的地区记录。")
    latitude, longitude = float(row["latitude"]), float(row["longitude"])
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("地区坐标无效。")
    english = str(row.get("state") or row.get("location") or "").strip()
    if not english or len(english) > 120:
        raise ValueError("地区名称无效。")
    name = next((cn for cn, en in ALIASES.items() if en.casefold() == english.casefold()), english)
    if slug == "japan/tokyo":
        name = "东京都"
    return Region(city_key(slug), name, english.upper(), english, latitude, longitude, slug, str(row.get("country") or ""))


def city_key(slug: str) -> str:
    for city in CITIES:
        if city_slug(city) == slug:
            return city.key
    return "aqi-" + hashlib.sha256(slug.encode()).hexdigest()[:16]


def city_from_location(row: dict) -> City:
    slug = row.get("slug", "")
    if row.get("searchType") != "cityId" or not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+", slug):
        raise ValueError("请选择 AQI.in 返回的城市记录。")
    latitude, longitude = float(row["latitude"]), float(row["longitude"])
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("城市坐标无效。")
    english = str(row.get("city") or row.get("location") or "").strip()
    if not english or len(english) > 120:
        raise ValueError("城市名称无效。")
    for city in CITIES:
        if city_slug(city) == slug:
            return city
    name = next((cn for cn, en in ALIASES.items() if en.casefold() == english.casefold()), english)
    # Different Chinese cities can share one romanized name; retain the region.
    if str(row.get("country", "")).casefold() == "china":
        regional_names = {("taizhou", "jiangsu"): "泰州", ("taizhou", "zhejiang"): "台州",
                          ("suzhou", "anhui"): "宿州", ("suzhou", "jiangsu"): "苏州"}
        name = regional_names.get((english.casefold(), str(row.get("state", "")).casefold()), name)
    return City(city_key(slug), name, english.upper(), str(row.get("state") or ""), latitude, longitude,
                slug, str(row.get("country") or ""))


def load_cities(file: Path) -> tuple[City, ...]:
    cities = []
    if file.exists():
        payload = json.loads(file.read_text(encoding="utf-8"))
        if payload.get("version", 1) not in (1, 2):
            raise ValueError("城市记录版本无效。")
        for row in payload["cities"]:
            city = City(**row)
            slug = city_slug(city)
            if city.key != city_key(slug):
                raise ValueError("已保存城市的来源标识无效。")
            checked = city_from_location({"slug": slug, "searchType": "cityId", "latitude": city.latitude,
                                          "longitude": city.longitude, "city": city.english, "state": city.province,
                                          "country": city.country})
            if checked.key not in {c.key for c in cities}:
                cities.append(city)
    return tuple(cities)


def save_city(file: Path, city: City):
    cities = list(load_cities(file))
    if any(c.key == city.key for c in cities):
        return
    cities.append(city)
    save_cities(file, cities)


def save_cities(file: Path, cities):
    """Version 2 stores the complete list, including an intentionally empty list."""
    if any(isinstance(city, Region) for city in cities):
        raise ValueError("地区仅用于查找下辖城市，不能保存为城市日值记录。")
    file.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 2, "cities": [asdict(c) for c in cities]}
    temporary = file.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(file)


def _search_request(query: str, token: str) -> list[dict]:
    url = SEARCH_ENDPOINT + "?" + urlencode({"searchString": query, "source": "web"})
    try:
        with urlopen(Request(url, headers={"Authorization": "bearer " + token, "Accept": "application/json"}), timeout=20) as response:
            payload = json.load(response)
    except HTTPError as error:
        if error.code == 404:
            return []
        raise
    if payload.get("status") != "success":
        raise ValueError("城市搜索暂不可用，请稍后重试。")
    data = payload.get("data", {})
    cities = list(data.get("cities", []))
    # Search returns a short, varying subset of cities. An exact-name city's
    # station can locate its official city record, without reusing station AQI.
    if not any(str(city.get("city", "")).casefold() == query.casefold() for city in cities):
        candidates = [row for row in data.get("stations", [])
                      if str(row.get("city", "")).casefold() == query.casefold()
                      and row.get("searchType") == "locationId"]
        for station in candidates[:2]:
            slug = station.get("slug", "")
            if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+", slug):
                continue
            try:
                params = {"lat": station["latitude"], "long": station["longitude"], "type": "2", "source": "web"}
                url = "https://apiserver.aqi.in/aqi/v2/getNearestLocation?" + urlencode(params)
                with urlopen(Request(url, headers={"Authorization": "bearer " + token, "Accept": "application/json"}), timeout=15) as response:
                    nearest = json.load(response)
                if str(nearest.get("status", "")).casefold() != "success":
                    continue
                matched = [row for row in nearest.get("data", []) if row.get("searchType") == "cityId"
                           and row.get("slug") == slug.rsplit("/", 1)[0]
                           and str(row.get("city", "")).casefold() == query.casefold()]
                if matched:
                    cities.extend(matched)
                    break
            except (OSError, ValueError, KeyError, TypeError):
                continue
    # A same-name regional capital may also be absent from the short station
    # subset. Geocoding supplies coordinates only; AQI.in must confirm the exact
    # city name and parent region before the result is offered for adding.
    if not any(str(city.get("city", "")).casefold() == query.casefold() for city in cities):
        regions = [row for row in data.get("states", []) if str(row.get("state", "")).casefold() == query.casefold()]
        for region in regions[:1]:
            try:
                checked_region = region_from_location(region)
                url = "https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": query, "count": 5, "language": "en", "format": "json"})
                with urlopen(url, timeout=10) as response:
                    coordinates = json.load(response).get("results", [])
                for location in coordinates:
                    if (str(location.get("name", "")).casefold() != query.casefold()
                            or str(location.get("country", "")).casefold() != checked_region.country.casefold()):
                        continue
                    params = {"lat": location["latitude"], "long": location["longitude"], "type": "2", "source": "web"}
                    url = "https://apiserver.aqi.in/aqi/v2/getNearestLocation?" + urlencode(params)
                    with urlopen(Request(url, headers={"Authorization": "bearer " + token, "Accept": "application/json"}), timeout=15) as response:
                        nearest = json.load(response)
                    if str(nearest.get("status", "")).casefold() != "success":
                        continue
                    matched = [row for row in nearest.get("data", []) if row.get("searchType") == "cityId"
                               and str(row.get("slug", "")).startswith(checked_region.slug + "/")
                               and str(row.get("city", "")).casefold() == query.casefold()]
                    if matched:
                        cities.extend(matched)
                    break
            except (OSError, ValueError, KeyError, TypeError):
                continue
    return [*cities, *data.get("states", [])]


def search_cities(query: str, page: Path) -> list[City | Region]:
    query = query.strip()
    if not query or len(query) > 100:
        raise ValueError("请输入 1–100 个字符的城市名称。")
    token = published_client_token(page.read_text(encoding="utf-8"))
    query_without_suffix = query[:-1] if query.endswith("市") else query
    translated = ALIASES.get(query_without_suffix, query)
    rows = _search_request(translated, token)
    # Geocoding translates names only; all AQI and final city records remain AQI.in data.
    if not rows and re.search(r"[\u3400-\u9fff]", query):
        url = "https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": query_without_suffix, "count": 3, "language": "en", "format": "json"})
        with urlopen(url, timeout=15) as response:
            locations = json.load(response).get("results", [])
        for location in locations[:2]:
            rows = _search_request(location["name"], token)
            if rows:
                break
    cities = {}
    for row in rows:
        try:
            city = region_from_location(row) if row.get("searchType") == "stateId" else city_from_location(row)
        except (ValueError, KeyError, TypeError):
            continue
        cities[city.key] = city
    ordered = list(cities.values())
    ordered.sort(key=lambda city: (city.english.casefold() != translated.casefold(), not isinstance(city, Region), city.english))
    return ordered[:20]
