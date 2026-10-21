"""Write a self-contained HTML report, auditable JSON and CSV tables."""

import csv
import json
import uuid
from pathlib import Path
from .history import write_policy
from .colors import COLOR_SCALE
from .comparison import comparison_metadata


def render_page(template: str, inline: str, year_label: str, page: str) -> str:
    directory = Path(__file__).parent / "templates"
    navigation = (directory / "site-nav.html").read_text(encoding="utf-8")
    navigation = navigation.replace("__CALENDAR_CURRENT__", 'aria-current="page"' if page == "calendar" else "")
    navigation = navigation.replace("__COMPARE_CURRENT__", 'aria-current="page"' if page == "compare" else "")
    return (template.replace("__AQIREC_DATA__", inline).replace("__AQIREC_YEAR__", year_label)
            .replace("__AQIREC_NAV__", navigation)
            .replace("__AQIREC_SITE_STYLE__", "\n".join((directory / name).read_text(encoding="utf-8") for name in ("site.css", "mobile.css")))
            .replace("__AQIREC_SITE_SCRIPT__", "\n".join((directory / name).read_text(encoding="utf-8") for name in ("site.js", "mobile.js"))))


def write_text_atomic(file: Path, text: str):
    temporary = file.with_suffix(file.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(file)


def write_report(report: dict, output: Path) -> Path:
    report["revision"] = uuid.uuid4().hex
    report["color_scale"] = COLOR_SCALE
    report["comparison"] = comparison_metadata(report)
    output.mkdir(parents=True, exist_ok=True)
    if report.get("source_kind") != "platform_daily" or report.get("provider") != "AQI.in":
        raise ValueError("仅支持 AQI.in 平台逐日值报告。")
    metrics = [("mean", "平台发布的日AQI(US)")]
    write_policy(output, report)
    write_text_atomic(output / "report.json", json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    template = (Path(__file__).parent / "templates" / "report.html").read_text(encoding="utf-8")
    # Escaping '<' prevents data from ever terminating the embedded JSON script.
    inline = json.dumps(report, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    year_label = report["start_date"][:4] + "–" + report["end_date"][:4] if report["start_date"][:4] != report["end_date"][:4] else str(report["year"])
    html = render_page(template, inline, year_label, "calendar")
    html_file = output / "index.html"
    write_text_atomic(html_file, html)
    comparison_template = (Path(__file__).parent / "templates" / "compare.html").read_text(encoding="utf-8")
    write_text_atomic(output / "compare.html", render_page(comparison_template, inline, year_label, "compare"))
    with (output / "daily.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(["城市", "日期", "AQI(US)", "状态", "标准", "数据源", "原始页面"])
        for city in report["cities"]:
            for row in city["days"]:
                status = ("今日暂定" if row["provisional"] else "有值") if row["mean"] is not None else ("待发布" if row["provisional"] else "缺失")
                writer.writerow([city["name"], row["date"], rounded(row["mean"]), status, report["standard"], report["provider"], city["provenance"]["request_url"]])
    fields = ["城市", "口径", "有效天数(含今日暂定)", "缺失天数", "期间均值", "最高值", "最高值日期", "AQI≤100天数", "AQI>100天数", "AQI≤100比例", *[c["name"] + "天数" for c in report["categories"]], "暂定日数", "待统计日数"]
    with (output / "summary.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(fields)
        for city in report["cities"]:
            for metric, label in metrics:
                writer.writerow(summary_row(city["name"], label, city["summary"][metric]))
    with (output / "monthly.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(["月份", *fields])
        for city in report["cities"]:
            for month in city["monthly"]:
                for metric, label in metrics:
                    writer.writerow([month["key"], *summary_row(city["name"], label, month[metric])])
    return html_file


def rounded(value):
    return round(value, 3) if isinstance(value, (float, int)) else value


def summary_row(name, label, stats):
    return [name, label, stats["valid_days"], stats["missing_days"], rounded(stats["average"]), rounded(stats["maximum"]), stats["worst_date"], stats["days_le_100"], stats["days_gt_100"], rounded(stats["share_le_100"]), *stats["category_counts"], stats["provisional_days"], stats["pending_days"]]
