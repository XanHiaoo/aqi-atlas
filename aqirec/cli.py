from __future__ import annotations

import argparse
import sys
import webbrowser
from datetime import date
from pathlib import Path

from .data import resolve_period
from .report import write_report
from .history import build_history_report
from .aqiin_api import refresh_calendars
from .cities import load_cities

ROOT = Path.cwd()


def main(argv=None):
    parser = argparse.ArgumentParser(description="美标 AQI 城市日历与差异对比网站")
    parser.add_argument("--year", type=int, help="指定自然年度；不能与 --start-date 同用")
    parser.add_argument("--start-date", type=date.fromisoformat, help="开始日期 YYYY-MM-DD，默认截至结束日期的365天")
    parser.add_argument("--end-date", type=date.fromisoformat, help="结束日期 YYYY-MM-DD，默认北京时间昨天")
    parser.add_argument("--output", type=Path, default=ROOT / "output", help="生成页面与数据表的目录，默认 output")
    parser.add_argument("--snapshots", type=Path, default=ROOT / "data" / "aqiin", help="AQI.in 公开页面快照目录")
    parser.add_argument("--aqiin-page", type=Path, default=ROOT / "data" / "aqiin" / "client.html", help="含 AQI.in 公开客户端配置的页面快照")
    parser.add_argument("--cities-file", type=Path, default=ROOT / "data" / "cities.json", help="已添加城市的本地记录")
    parser.add_argument("--serve", action="store_true", help="启动本地网站，支持城市搜索、日历和差异对比")
    parser.add_argument("--port", type=int, default=8765, help="本地服务端口，默认 8765")
    parser.add_argument("--refresh", action="store_true", help="从 AQI.in 更新历史日值；默认使用已保存的快照")
    parser.add_argument("--open", action="store_true", help="生成后用默认浏览器打开")
    args = parser.parse_args(argv)
    try:
        start, end = resolve_period(args.year, args.end_date, start=args.start_date)
        cities = load_cities(args.cities_file)
        if args.refresh:
            refresh_calendars(start, end, args.snapshots, args.aqiin_page, cities=cities)
        report = build_history_report(start, end, args.snapshots, selected_cities=cities)
        output = args.output.resolve()
        html = write_report(report, output)
        for city in report["cities"]:
            stats = city["summary"]["mean"]
            average = f'{stats["average"]:.1f}' if stats["average"] is not None else "无有效数据"
            print(f'{city["name"]}：有效 {stats["valid_days"]} 天，缺失 {stats["missing_days"]} 天，有值日期的美标 AQI 均值 {average}')
        print(f"报告：{html}")
        if args.serve:
            from .server import serve
            serve(output, args.snapshots, args.aqiin_page, args.cities_file, port=args.port, open_browser=args.open,
                  rolling=args.year is None and args.start_date is None and args.end_date is None)
        elif args.open:
            webbrowser.open(html.as_uri())
        return 0
    except (ValueError, RuntimeError, OSError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1
