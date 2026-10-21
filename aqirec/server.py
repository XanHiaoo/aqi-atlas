"""Loopback-only dashboard service for background city search and acquisition."""
from __future__ import annotations

import json
import shutil
import tempfile
import threading
import webbrowser
from dataclasses import asdict
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .aqiin_api import city_slug, load_api_snapshots, refresh_calendars
from .cities import Region, load_cities, save_cities, save_city, search_cities
from .data import SHANGHAI, resolve_period
from .history import build_history_report
from .report import write_report
from .updates import AutoUpdater
from .realtime import RealtimeCache


class Dashboard:
    def __init__(self, output: Path, snapshots: Path, page: Path, registry: Path, *, rolling=True):
        self.output, self.snapshots, self.page, self.registry = output, snapshots, page, registry
        self.lock = threading.RLock()
        self.results = {}
        self.rolling = rolling
        self.updater = AutoUpdater(registry.with_name(registry.stem + ".updates.json"), self.refresh_selected)
        self.realtime = RealtimeCache(snapshots / "realtime", page)

    def read_report(self):
        return json.loads((self.output / "report.json").read_text(encoding="utf-8"))

    def status(self):
        return {"update": self.updater.snapshot(), "revision": self.read_report().get("revision"),
                "rolling": self.rolling}

    def roll_period(self, today=None):
        if not self.rolling:
            return False
        today = today or datetime.now(SHANGHAI).date()
        start, end = resolve_period(today=today)
        with self.lock:
            report = self.read_report()
            if report["start_date"] == str(start) and report["end_date"] == str(end):
                return False
            updated = build_history_report(start, end, self.snapshots, selected_cities=load_cities(self.registry))
            write_report(updated, self.output)
            return True

    def live_snapshot(self):
        return self.realtime.snapshot(load_cities(self.registry))

    def refresh_live(self):
        keys = self.updater.snapshot()["selected_keys"] or []
        cities = tuple(city for city in load_cities(self.registry) if city.key in keys)
        self.realtime.tick(cities)

    def select(self, keys):
        if not isinstance(keys, list) or any(not isinstance(key, str) for key in keys) or len(keys) > 100:
            raise ValueError("城市勾选格式无效。")
        # Registry writes are atomic. Selection changes can be saved during network I/O.
        valid = {city.key for city in load_cities(self.registry)}
        self.updater.select([key for key in keys if key in valid])
        return self.status()

    def delete(self, key):
        if not isinstance(key, str):
            raise ValueError("城市标识无效。")
        with self.lock:
            cities = load_cities(self.registry)
            remaining = tuple(city for city in cities if city.key != key)
            if len(remaining) != len(cities):
                report = self.read_report()
                updated = build_history_report(date.fromisoformat(report["start_date"]),
                                                date.fromisoformat(report["end_date"]),
                                                self.snapshots, selected_cities=remaining)
                write_report(updated, self.output)
                save_cities(self.registry, remaining)
            self.updater.forget(key)
            # Raw source snapshots are retained for auditing and re-adding the city.
            return self.status()

    def refresh_selected(self, keys, today):
        """Validate in a staging directory, then publish both pages together."""
        with self.lock:
            cities = load_cities(self.registry)
            selected = tuple(city for city in cities if city.key in keys)
            if not selected:
                return {"complete": True, "publication": []}
            report = self.read_report()
            start, end = (resolve_period(today=today) if self.rolling else
                          (date.fromisoformat(report["start_date"]), date.fromisoformat(report["end_date"])))
            expected = max(start, min(end, today - timedelta(days=1)))
            # Daily retries fetch recent years; older, already acquired history stays cached.
            years = sorted({max(start.year, expected.year), end.year})
            with tempfile.TemporaryDirectory(prefix="aqirec-update-", dir=self.registry.parent) as directory:
                staging = Path(directory) / "snapshots"
                shutil.copytree(self.snapshots, staging)
                refresh_calendars(start, end, staging, self.page, cities=selected, years=years)
                for city in selected:
                    previous, _ = load_api_snapshots(city, self.snapshots, end)
                    current, _ = load_api_snapshots(city, staging, end)
                    if any(str(start) <= day < str(today) and day not in current for day in previous):
                        raise ValueError(f"{city.name} 的返回记录减少，已保留原快照，稍后重试。")
                updated = build_history_report(start, end, staging, selected_cities=cities)
                publication = []
                for row in updated["cities"]:
                    if row["key"] in keys:
                        values = [day["date"] for day in row["days"] if day["mean"] is not None]
                        publication.append({"key": row["key"], "name": row["name"],
                                            "latest_date": max(values, default=None),
                                            "expected_date": str(expected), "available": str(expected) in values})
                # No active snapshot is replaced until all source/hash/overlap checks pass.
                replacements = [(staging / "api" / f"{city.key}-{year}{suffix}",
                                 self.snapshots / "api" / f"{city.key}-{year}{suffix}")
                                for city in selected for year in years for suffix in (".json", ".receipt.json")]
                # Roll back active caches if publishing fails; the report can be rebuilt from them.
                previous_files = {target: target.read_bytes() if target.exists() else None for _, target in replacements}
                try:
                    for source, target in replacements:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        temporary = target.with_suffix(target.suffix + ".tmp")
                        temporary.write_bytes(source.read_bytes())
                        temporary.replace(target)
                    write_report(updated, self.output)
                except Exception:
                    for target, raw in previous_files.items():
                        if raw is None:
                            target.unlink(missing_ok=True)
                        else:
                            target.write_bytes(raw)
                    raise
            return {"complete": all(row["available"] for row in publication), "publication": publication}

    def search(self, query):
        cities = search_cities(query, self.page)
        with self.lock:
            self.results.update({city_slug(city): city for city in cities})
        return [{**asdict(city), "slug": city_slug(city)} for city in cities]

    def region_cities(self, slug):
        with self.lock:
            region = self.results.get(slug)
        if not isinstance(region, Region):
            raise ValueError("请先搜索并选择平台返回的地区。")
        matches = search_cities(region.english, self.page)
        cities = [city for city in matches if not isinstance(city, Region) and city_slug(city).startswith(slug + "/")]
        with self.lock:
            self.results.update({city_slug(city): city for city in cities})
        return {"region": asdict(region), "cities": [{**asdict(city), "slug": city_slug(city)} for city in cities],
                "source_url": f"https://www.aqi.in/dashboard/{slug}"}

    def add(self, slug):
        with self.lock:
            report = json.loads((self.output / "report.json").read_text(encoding="utf-8"))
            for row in report["cities"]:
                if (row.get("slug") or row["provenance"]["request_url"].split("/dashboard/", 1)[1].removesuffix("/historical-analysis")) == slug:
                    return row
            city = self.results.get(slug)
            if city is None:
                raise ValueError("请先搜索并选择平台返回的城市。")
            if isinstance(city, Region):
                raise ValueError("平台暂不提供地区级历史日值，请展开地区后选择下辖城市。")
            start, end = date.fromisoformat(report["start_date"]), date.fromisoformat(report["end_date"])
            refresh_calendars(start, end, self.snapshots, self.page, cities=(city,))
            added = build_history_report(start, end, self.snapshots, selected_cities=(city,))
            row = added["cities"][0]
            if not row["summary"]["mean"]["valid_days"]:
                raise ValueError("该城市在当前日期范围没有已发布的美标日值。")
            # Build all data before publishing the updated dashboard or registry.
            cities = (*load_cities(self.registry), city)
            updated = build_history_report(start, end, self.snapshots, selected_cities=cities)
            write_report(updated, self.output)
            save_city(self.registry, city)
            return row


def make_handler(dashboard: Dashboard):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            route = urlsplit(self.path)
            if route.path == "/api/status":
                self.send_json(200, dashboard.status())
                return
            if route.path == "/api/realtime":
                self.send_json(200, dashboard.live_snapshot())
                return
            if route.path == "/api/search":
                try:
                    query = parse_qs(route.query).get("q", [""])[0]
                    self.send_json(200, {"cities": dashboard.search(query)})
                except ValueError as error:
                    self.send_json(400, {"error": str(error)})
                except OSError:
                    self.send_json(503, {"error": "无法连接城市数据服务，请稍后重试。"})
                return
            if route.path == "/api/regions":
                try:
                    slug = parse_qs(route.query).get("slug", [""])[0]
                    self.send_json(200, dashboard.region_cities(slug))
                except ValueError as error:
                    self.send_json(400, {"error": str(error)})
                except OSError:
                    self.send_json(503, {"error": "无法获取下辖城市，请稍后重试。"})
                return
            files = {"/": "index.html", "/index.html": "index.html", "/compare": "compare.html", "/compare.html": "compare.html", "/source-policy.md": "source-policy.md",
                     "/desktop-index.html": "desktop-index.html", "/desktop-compare.html": "desktop-compare.html",
                     "/report.json": "report.json", "/daily.csv": "daily.csv", "/summary.csv": "summary.csv", "/monthly.csv": "monthly.csv"}
            name = files.get(route.path)
            if name is None:
                self.send_json(404, {"error": "页面不存在。"})
                return
            file = dashboard.output / name
            data = file.read_bytes()
            mime = "text/html" if name.endswith(".html") else "application/json" if name.endswith(".json") else "text/csv" if name.endswith(".csv") else "text/plain"
            self.send_response(200)
            self.send_header("Content-Type", mime + "; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            origin = self.headers.get("Origin")
            allowed = {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
            if origin and origin not in allowed:
                self.send_json(403, {"error": "请从本机应用页面添加城市。"})
                return
            path = urlsplit(self.path).path
            if path not in ("/api/cities", "/api/selection", "/api/cities/delete"):
                self.send_json(404, {"error": "接口不存在。"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096 or self.headers.get_content_type() != "application/json":
                    raise ValueError("城市请求格式无效。")
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise ValueError("城市请求格式无效。")
                if path == "/api/selection":
                    self.send_json(200, dashboard.select(payload.get("keys")))
                elif path == "/api/cities/delete":
                    self.send_json(200, dashboard.delete(payload.get("key")))
                else:
                    slug = payload.get("slug")
                    if not isinstance(slug, str):
                        raise ValueError("请选择搜索结果中的城市。")
                    city = dashboard.add(slug)
                    self.send_json(200, {"city": city, "revision": dashboard.status()["revision"]})
            except (ValueError, KeyError, TypeError) as error:
                self.send_json(400, {"error": str(error)})
            except OSError:
                self.send_json(503, {"error": "该城市历史数据暂时无法获取，请稍后重试。"})

    return Handler


def serve(output: Path, snapshots: Path, page: Path, registry: Path, *, port=8765, open_browser=False, rolling=True):
    dashboard = Dashboard(output, snapshots, page, registry, rolling=rolling)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(dashboard))
    server.daemon_threads = True
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"AQI 城市空气网站：{url}", flush=True)
    if open_browser:
        webbrowser.open(url)
    stop = threading.Event()

    def updates():
        while not stop.is_set():
            try:
                dashboard.roll_period()
                dashboard.updater.tick()
            except Exception as error:
                print(f"自动更新调度暂不可用：{error}", flush=True)
            stop.wait(15)

    worker = threading.Thread(target=updates, name="aqirec-daily-update", daemon=True)
    worker.start()

    def live_updates():
        while not stop.is_set():
            try:
                dashboard.refresh_live()
            except Exception as error:
                print(f"实时数据暂不可用：{error}", flush=True)
            stop.wait(2)

    live_worker = threading.Thread(target=live_updates, name="aqirec-realtime", daemon=True)
    live_worker.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
