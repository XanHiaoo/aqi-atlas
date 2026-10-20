import json
import re
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from aqirec.cities import city_from_location, save_cities
from aqirec.data import CITIES
from aqirec.comparison import comparison_metadata, paired_days
from aqirec.history import build_history_report
from aqirec.report import write_report
from aqirec.server import Dashboard

ROOT = Path(__file__).resolve().parents[1]


def embedded(file, element_id):
    text = file.read_text(encoding="utf-8")
    match = re.search(r'<script type="application/json" id="' + element_id + r'">(.*?)</script>', text, re.S)
    return json.loads(match[1])


class WebsiteTests(unittest.TestCase):
    def test_pairing_excludes_pending_and_missing_but_preserves_zero(self):
        a = {"days": [{"date": "2026-01-01", "mean": 0}, {"date": "2026-01-02", "mean": 90}, {"date": "2026-01-03", "mean": 10, "provisional": True}]}
        b = {"days": [{"date": "2026-01-01", "mean": 40}, {"date": "2026-01-02", "mean": None}, {"date": "2026-01-03", "mean": 20}]}
        self.assertEqual(paired_days(a, b), [{"date": "2026-01-01", "a": 0, "b": 40, "delta": -40}])
        limits = comparison_metadata({"cities": [a, b]})
        self.assertEqual(limits["delta_limit"], 50)
        self.assertEqual(limits["absolute_limit"], 100)

    def test_two_pages_embed_identical_data_and_work_as_offline_neighbors(self):
        report = build_history_report(date(2025, 10, 20), date(2026, 10, 20), ROOT / "tests/fixtures/aqiin", selected_cities=CITIES)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            write_report(report, output)
            saved = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(embedded(output / "index.html", "report-data"), saved)
            self.assertEqual(embedded(output / "compare.html", "data"), saved)
            for filename in ("index.html", "compare.html"):
                text = (output / filename).read_text(encoding="utf-8")
                self.assertIn('href="index.html"', text)
                self.assertIn('href="compare.html"', text)
                self.assertNotIn("__AQIREC_", text)
                self.assertNotIn("COMPARE THE SAME DAYS", text)
            self.assertNotIn("V2 独立设计预览", (output / "compare.html").read_text(encoding="utf-8"))

    def test_adding_city_rebuilds_both_pages_from_current_data(self):
        snapshots = ROOT / "tests/fixtures/aqiin"
        report = build_history_report(date(2025, 10, 20), date(2026, 10, 20), snapshots, selected_cities=CITIES)
        city = city_from_location({"slug": "china/shanghai/shanghai", "searchType": "cityId", "city": "Shanghai", "state": "Shanghai", "country": "China", "latitude": 31.2286, "longitude": 121.475})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            save_cities(root / "cities.json", CITIES)
            write_report(report, root)
            dashboard = Dashboard(root, snapshots, ROOT / "tests/fixtures/client.html", root / "cities.json")
            dashboard.results[city.slug] = city
            with patch("aqirec.server.refresh_calendars"):
                dashboard.add(city.slug)
            calendar = embedded(root / "index.html", "report-data")
            comparison = embedded(root / "compare.html", "data")
            self.assertEqual(calendar, comparison)
            self.assertEqual(len(comparison["cities"]), 5)
            self.assertIn(city.key, {row["key"] for row in comparison["cities"]})


if __name__ == "__main__":
    unittest.main()
