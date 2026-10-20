"""Build daily AQI reports from verified AQI.in calendar snapshots."""
from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from .aqiin_api import city_slug, load_api_snapshots
from .data import CATEGORIES, CITIES, SHANGHAI, date_range, summarize


def build_history_report(start: date, end: date, snapshots: Path, *, selected_cities=None):
    now = datetime.now(SHANGHAI)
    cities = []
    for city in (selected_cities if selected_cities is not None else CITIES):
        values, receipts = load_api_snapshots(city, snapshots, now.date())
        if not receipts:
            raise ValueError(f"没有 {city.name} 的日历快照，请先使用 --refresh 获取历史日值。")
        days = [{"date": str(day), "mean": values.get(str(day)), "complete": str(day) in values and day != now.date(),
                 "provisional": day == now.date(), "source": "AQI.in", "standard": "AQI-US"}
                for day in date_range(start, end)]
        monthly = []
        for key in dict.fromkeys(day["date"][:7] for day in days):
            subset = [row for row in days if row["date"].startswith(key)]
            monthly.append({"key": key, "year": int(key[:4]), "month": int(key[5:]), "mean": summarize(subset, "mean")})
        available = [row["date"] for row in days if row["mean"] is not None]
        provenance = {"request_url": f"https://www.aqi.in/dashboard/{city_slug(city)}/historical-analysis",
                      "snapshot_files": receipts, "access": "official AQI.in calendar API",
                      "first_available": min(available, default=None), "last_available": max(available, default=None)}
        cities.append({**asdict(city), "days": days, "monthly": monthly, "provenance": provenance,
                       "summary": {"mean": summarize(days, "mean")}})
    return {"schema_version": 3, "source_kind": "platform_daily", "provider": "AQI.in", "standard": "AQI-US",
            "available_metrics": ["mean"], "year": end.year, "start_date": str(start), "end_date": str(end),
            "generated_at": now.isoformat(timespec="seconds"), "as_of": now.isoformat(timespec="seconds"),
            "timezone": "source-published-date", "expected_days": (end - start).days + 1,
            "source": "AQI.in 平台发布的美标日值", "source_url": "https://www.aqi.in/cn/air-quality-map",
            "categories": CATEGORIES, "cities": cities,
            "validation": {"status": "platform_coverage_reported", "audit_file": "source-policy.md"}}


def write_policy(output: Path, report: dict):
    lines = ["# 数据来源与统计口径", "",
             "数据来源：AQI.in 官方日历接口。采用 sensorname=aqi 对应的 AQI (US) 日值，保持平台日期标签。",
             "", f"统计区间：{report['start_date']} 至 {report['end_date']}（含起止日）。", "",
             "期间及月度均值按有效日等权计算；缺失不填补，AQI≤100 占比以有效日数为分母。",
             "两城差异仅比较双方都有已发布日值的共同日期。实时数据独立展示，不进入历史统计。",
             "日聚合算法与时区以平台定义为准，未独立核验。", "",
             "## 数据覆盖", "", "| 城市 | 有效日数 | 历史缺失 | 待发布 | 来源 |", "| --- | ---: | ---: | ---: | --- |"]
    for city in report["cities"]:
        stats = city["summary"]["mean"]
        lines.append(f"| {city['name']} | {stats['valid_days']} | {stats['missing_days']} | {stats['pending_days']} | "
                     f"[平台页面]({city['provenance']['request_url']}) |")
    lines.extend(["", "原始响应、请求地址、获取时间及 SHA-256 保存在日历快照目录，文件摘要亦写入 report.json。", ""])
    (output / "source-policy.md").write_text("\n".join(lines), encoding="utf-8")
