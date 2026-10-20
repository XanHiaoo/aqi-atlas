"""Comparison display limits derived from the same report as the calendar."""
from itertools import combinations
import math

from .data import valid_number


def paired_days(a: dict, b: dict) -> list[dict]:
    def available(city):
        return {row["date"]: row["mean"] for row in city["days"]
                if valid_number(row.get("mean")) and not row.get("provisional")}
    left, right = available(a), available(b)
    return [{"date": day, "a": left[day], "b": right[day], "delta": left[day] - right[day]}
            for day in sorted(left.keys() & right.keys())]


def comparison_metadata(report: dict) -> dict:
    cities = report["cities"]
    maximum = max((abs(row["delta"]) for a, b in combinations(cities, 2) for row in paired_days(a, b)), default=0)
    absolute = max((row["mean"] for city in cities for row in city["days"]
                    if valid_number(row.get("mean")) and not row.get("provisional")), default=0)
    return {"delta_limit": max(25, math.ceil(maximum / 25) * 25),
            "absolute_limit": max(100, math.ceil(absolute / 25) * 25),
            "paired_method": "Same published non-provisional calendar dates only; no imputation.",
            "delta_definition": "A minus B, in published AQI points; not a proportional health-risk estimate.",
            "shared_report": True}
