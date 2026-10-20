"""AQI.in city-level US AQI, cached separately from historical daily values."""
from __future__ import annotations

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .aqiin_api import city_slug, published_client_token
from .data import SHANGHAI, valid_number
from .report import write_text_atomic

ENDPOINT = "https://apiserver.aqi.in/aqi/v2/getNearestLocation"


def realtime_url(city):
    return ENDPOINT + "?" + urlencode({"lat": city.latitude, "long": city.longitude, "type": "2", "source": "web"})


def parse_realtime(payload, city, now):
    if not isinstance(payload, dict) or str(payload.get("status", "")).lower() != "success" or not isinstance(payload.get("data"), list):
        raise ValueError("平台未返回有效的实时城市记录。")
    # The nearest-city endpoint is usable only when it returns the exact saved city.
    matches = [row for row in payload["data"] if isinstance(row, dict)
               and row.get("searchType") == "cityId" and row.get("slug") == city_slug(city)]
    if len(matches) != 1:
        raise ValueError("平台返回城市与所选城市不符，未采用附近城市或站点的数值。")
    row = matches[0]
    value = row.get("iaqi", {}).get("aqi") if isinstance(row.get("iaqi"), dict) else None
    if not valid_number(value):
        raise ValueError("平台没有返回有效的美标实时 AQI。")
    observed_at = row.get("updatedAt")
    if observed_at:
        if not isinstance(observed_at, str):
            raise ValueError("平台实时记录的更新时间无效。")
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        if observed.tzinfo is None or observed > now + timedelta(minutes=5):
            raise ValueError("平台实时记录的更新时间无效。")
        observed_at = observed.isoformat(timespec="seconds")
    if row.get("isOnline") is False:
        raise ValueError("平台城市实时数据暂时离线。")
    return {"key": city.key, "name": city.name, "slug": city_slug(city), "aqi": value,
            "standard": "AQI-US", "provider": "AQI.in", "observed_at": observed_at,
            "source_time_label": row.get("updated_at"), "source_timezone": row.get("time_zone"),
            "platform_source": row.get("source"), "fetched_at": now.isoformat(timespec="seconds"),
            "source_url": f"https://www.aqi.in/dashboard/{city_slug(city)}"}


class RealtimeCache:
    def __init__(self, directory: Path, page: Path):
        self.directory, self.page = directory, page
        self.lock = threading.RLock()
        self.rows, self.attempts, self.errors = {}, {}, {}
        self.refreshing = False

    def _load(self, city):
        if city.key in self.rows:
            return
        file = self.directory / f"{city.key}.json"
        if not file.exists():
            return
        try:
            raw = file.read_bytes()
            receipt = json.loads(file.with_suffix(".receipt.json").read_text(encoding="utf-8"))
            if (receipt["request_url"] != realtime_url(city) or receipt["standard"] != "AQI-US"
                    or receipt["sha256"] != hashlib.sha256(raw).hexdigest()):
                raise ValueError("实时快照校验失败。")
            fetched = datetime.fromisoformat(receipt["fetched_at"])
            self.rows[city.key] = parse_realtime(json.loads(raw), city, fetched)
        except (OSError, KeyError, ValueError, TypeError):
            self.errors[city.key] = "实时缓存不可用，正在重新获取。"

    def tick(self, cities, now=None):
        now = now or datetime.now(SHANGHAI)
        with self.lock:
            if self.refreshing:
                return
            due = []
            for city in cities:
                self._load(city)
                row = self.rows.get(city.key)
                last_attempt = self.attempts.get(city.key)
                if last_attempt and now - last_attempt < timedelta(seconds=60):
                    continue
                if row and city.key not in self.errors and now - datetime.fromisoformat(row["fetched_at"]) < timedelta(minutes=5):
                    continue
                due.append(city)
                self.attempts[city.key] = now
            if not due:
                return
            self.refreshing = True
        try:
            token = published_client_token(self.page.read_text(encoding="utf-8"))

            def fetch(city):
                try:
                    request = Request(realtime_url(city), headers={"Authorization": "bearer " + token, "Accept": "application/json"})
                    with urlopen(request, timeout=20) as response:
                        raw = response.read()
                    row = parse_realtime(json.loads(raw), city, now)
                    receipt = {"request_url": realtime_url(city), "source_url": row["source_url"],
                               "standard": "AQI-US", "value_field": "iaqi.aqi", "level": "cityId",
                               "fetched_at": row["fetched_at"], "sha256": hashlib.sha256(raw).hexdigest()}
                    self.directory.mkdir(parents=True, exist_ok=True)
                    file = self.directory / f"{city.key}.json"
                    temporary = file.with_suffix(".json.tmp")
                    temporary.write_bytes(raw)
                    temporary.replace(file)
                    write_text_atomic(self.directory / f"{city.key}.receipt.json", json.dumps(receipt, ensure_ascii=False, indent=2))
                    return city.key, row, None
                except Exception as error:
                    return city.key, None, str(error)[:300]

            with ThreadPoolExecutor(max_workers=3) as pool:
                for key, row, error in pool.map(fetch, due):
                    with self.lock:
                        if error:
                            self.errors[key] = error
                        else:
                            self.rows[key] = row
                            self.errors.pop(key, None)
        except Exception as error:
            with self.lock:
                self.errors.update({city.key: str(error)[:300] for city in due})
        finally:
            with self.lock:
                self.refreshing = False

    def snapshot(self, cities, now=None):
        now = now or datetime.now(SHANGHAI)
        result = []
        with self.lock:
            for city in cities:
                self._load(city)
                row = dict(self.rows.get(city.key, {}))
                observed = datetime.fromisoformat(row["observed_at"]) if row.get("observed_at") else None
                current = bool(row) and (observed or datetime.fromisoformat(row["fetched_at"])).astimezone(SHANGHAI).date() == now.date()
                stale = bool(row) and (city.key in self.errors or now - datetime.fromisoformat(row["fetched_at"]) > timedelta(minutes=10)
                                       or (observed is not None and now - observed > timedelta(hours=2)))
                if not current:
                    row["aqi"] = None
                row.update(key=city.key, name=city.name, status=("stale" if stale else "ok") if current else
                           "unavailable" if city.key in self.errors or row.get("fetched_at") else "loading",
                           error=self.errors.get(city.key))
                result.append(row)
            return {"today": now.date().isoformat(), "server_time": now.isoformat(timespec="seconds"),
                    "provider": "AQI.in", "standard": "AQI-US", "refreshing": self.refreshing, "cities": result}
