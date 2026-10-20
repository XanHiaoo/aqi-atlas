"""Export public data and build a backend-free GitHub Pages site."""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import tempfile
from dataclasses import fields
from datetime import date, datetime
from pathlib import Path

from .aqiin_api import refresh_calendars
from .data import City, SHANGHAI, resolve_period
from .history import build_history_report
from .realtime import RealtimeCache
from .report import write_report, write_text_atomic


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_snapshot(path: Path, report: dict, selected_keys: list, realtime: dict):
    validate_report(report)
    keys = {city["key"] for city in report["cities"]}
    allowed = {"key", "name", "aqi", "observed_at", "fetched_at", "provider", "standard", "status", "platform_source"}
    live = {key: realtime.get(key) for key in ("today", "server_time", "provider", "standard")}
    live.update(refreshing=False, cities=[{key: value for key, value in row.items() if key in allowed}
                                         for row in realtime.get("cities", []) if row.get("key") in keys])
    payload = {"version": 1, "published_at": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
               "selected_keys": list(dict.fromkeys(key for key in selected_keys if key in keys)),
               "report": report, "realtime": live}
    path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")


def validate_report(report: dict):
    if report.get("source_kind") != "platform_daily" or report.get("provider") != "AQI.in" or report.get("standard") != "AQI-US":
        raise ValueError("Pages 仅发布 AQI.in 美标日值报告。")
    start, end = date.fromisoformat(report["start_date"]), date.fromisoformat(report["end_date"])
    if start > end or (end - start).days + 1 != report["expected_days"]:
        raise ValueError("报告统计区间与日期数量不符。")
    keys = [city["key"] for city in report["cities"]]
    if len(keys) != len(set(keys)):
        raise ValueError("报告包含重复城市。")


def export_snapshot(output: Path, snapshots: Path, registry: Path, destination: Path):
    report = read_json(output / "report.json")
    metadata = {field.name for field in fields(City)}
    cities = tuple(City(**{key: city[key] for key in metadata if key in city}) for city in report["cities"])
    state_file = registry.with_name(registry.stem + ".updates.json")
    selected = read_json(state_file).get("selected_keys") if state_file.exists() else None
    realtime = RealtimeCache(snapshots / "realtime", snapshots / "client.html").snapshot(cities)
    save_snapshot(destination, report, [city.key for city in cities] if selected is None else selected, realtime)


def build_pages(snapshot: Path, output: Path):
    payload = read_json(snapshot)
    report = copy.deepcopy(payload["report"])
    validate_report(report)
    if (output / "report.json").resolve() == snapshot.resolve():
        raise ValueError("发布目录不能覆盖源快照。")
    report["publication"] = {"mode": "static", "published_at": payload["published_at"],
                              "selected_keys": payload["selected_keys"], "realtime": payload["realtime"]}
    write_report(report, output)
    write_text_atomic(output / ".nojekyll", "")


def refresh_snapshot(snapshot: Path, token: str):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", token):
        raise ValueError("AQIIN_CLIENT_TOKEN 格式无效。")
    old = read_json(snapshot)
    validate_report(old["report"])
    metadata = {field.name for field in fields(City)}
    selected = set(old["selected_keys"])
    # The published city list is the website's data configuration, not a visitor's preferences.
    cities = tuple(City(**{key: city[key] for key in metadata if key in city}) for city in old["report"]["cities"])
    start, end = resolve_period()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        page = root / "client.html"
        flight = '0:{"siteStore":' + json.dumps({"token2": token}) + '}\n'
        page.write_text("<script>self.__next_f.push(" + json.dumps([1, flight]) + ")</script>", encoding="utf-8")
        refresh_calendars(start, end, root, page, cities=cities)
        report = build_history_report(start, end, root, selected_cities=cities)
        old_days = {city["key"]: {day["date"]: day["mean"] for day in city["days"]} for city in old["report"]["cities"]}
        for city in report["cities"]:
            for day in city["days"]:
                if day["mean"] is None and old_days.get(city["key"], {}).get(day["date"]) is not None:
                    raise ValueError(f"{city['name']} {day['date']} 的已有日值缺失，保留上次发布数据。")
        live = RealtimeCache(root / "realtime", page)
        live.tick(tuple(city for city in cities if city.key in selected))
        save_snapshot(snapshot, report, old["selected_keys"], live.snapshot(cities))


def main(argv=None):
    parser = argparse.ArgumentParser(description="GitHub Pages 公共数据导出、构建及更新")
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export", help="从本机输出导出公共快照，不包含客户端配置或账户信息")
    export.add_argument("--output", type=Path, default=Path("output"))
    export.add_argument("--snapshots", type=Path, default=Path("data/aqiin"))
    export.add_argument("--cities-file", type=Path, default=Path("data/cities.json"))
    export.add_argument("--snapshot", type=Path, default=Path("site-data/snapshot.json"))
    build = sub.add_parser("build", help="由公共快照生成静态站点，不访问网络")
    build.add_argument("--snapshot", type=Path, default=Path("site-data/snapshot.json"))
    build.add_argument("--output", type=Path, default=Path("dist"))
    refresh = sub.add_parser("refresh", help="使用环境变量 AQIIN_CLIENT_TOKEN 更新公共快照")
    refresh.add_argument("--snapshot", type=Path, default=Path("site-data/snapshot.json"))
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            export_snapshot(args.output, args.snapshots, args.cities_file, args.snapshot)
        elif args.command == "build":
            build_pages(args.snapshot, args.output)
        else:
            token = os.environ.get("AQIIN_CLIENT_TOKEN", "")
            if not token:
                print("未配置 AQIIN_CLIENT_TOKEN，跳过在线更新，保留已发布快照。")
                return 0
            refresh_snapshot(args.snapshot, token)
        print(f"Pages {args.command} 完成。")
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Pages {args.command} 失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
