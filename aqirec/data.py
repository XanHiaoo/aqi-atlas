"""City metadata, date ranges, AQI categories and daily summaries."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from statistics import mean

SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")


CATEGORIES = [
    {"name": "良好", "upper": 50, "color": "#79ba86", "range": "0–50"},
    {"name": "中等", "upper": 100, "color": "#edcf61", "range": "51–100"},
    {"name": "对敏感人群不健康", "upper": 150, "color": "#ee9957", "range": "101–150"},
    {"name": "不健康", "upper": 200, "color": "#dc6862", "range": "151–200"},
    {"name": "非常不健康", "upper": 300, "color": "#aa79ab", "range": "201–300"},
    {"name": "危险", "upper": None, "color": "#86465b", "range": "301+"},
]


@dataclass(frozen=True)
class City:
    key: str
    name: str
    english: str
    province: str
    latitude: float
    longitude: float
    slug: str = ""
    country: str = "China"


CITIES = (
    City("hangzhou", "杭州", "HANGZHOU", "浙江", 30.2741, 120.1551),
    City("jinhua", "金华", "JINHUA", "浙江", 29.0792, 119.6474),
    City("sanya", "三亚", "SANYA", "海南", 18.2528, 109.5119),
    City("beijing", "北京", "BEIJING", "北京", 39.9042, 116.4074),
)


def local_today() -> date:
    return datetime.now(SHANGHAI).date()


def date_range(start: date, end: date):
    for offset in range((end - start).days + 1):
        yield start + timedelta(days=offset)


def resolve_period(year: int | None = None, end: date | None = None, today: date | None = None, *, start: date | None = None):
    today = today or local_today()
    if year is not None:
        if start is not None:
            raise ValueError("--year 与 --start-date 不能同时使用。")
        start = date(year, 1, 1)
        end = end or min(today - timedelta(days=1), date(year, 12, 31))
        if end.year != year:
            raise ValueError("使用 --year 时结束日期必须在该年份内。")
    else:
        end = end or today - timedelta(days=1)
        if start is None:
            start = end - timedelta(days=364)
    if end < start:
        raise ValueError("结束日期不能早于开始日期。")
    if end > today:
        raise ValueError("结束日期不能晚于北京时间今天。")
    if (end - start).days > 731:
        raise ValueError("日历报告最多支持两年范围。")
    return start, end


def aqi_integer(value: float) -> int:
    """Nonnegative half-up rounding, used only for AQI category assignment."""
    return math.floor(value + 0.5)


def category_index(value: float | None) -> int | None:
    if value is None:
        return None
    integer = aqi_integer(value)
    for i, item in enumerate(CATEGORIES):
        if item["upper"] is None or integer <= item["upper"]:
            return i
    raise AssertionError("unreachable")


def valid_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def summarize(records: list[dict], metric: str) -> dict:
    if metric not in ("mean", "max"):
        raise ValueError("未知统计口径。")
    available = [row for row in records if row[metric] is not None]
    values = [row[metric] for row in available]
    counts = [0] * len(CATEGORIES)
    for value in values:
        counts[category_index(value)] += 1
    worst = max(available, key=lambda row: row[metric]) if available else None
    pending = sum(row.get("provisional", False) and row[metric] is None for row in records)
    return {
        "valid_days": len(values), "missing_days": len(records) - len(values) - pending,
        "provisional_days": sum(row.get("provisional", False) for row in available),
        "pending_days": pending,
        "average": mean(values) if values else None,
        "maximum": max(values) if values else None,
        "worst_date": worst["date"] if worst else None,
        "days_le_100": counts[0] + counts[1], "days_gt_100": sum(counts[2:]),
        "share_le_100": (counts[0] + counts[1]) / len(values) if values else None,
        "category_counts": counts,
    }
