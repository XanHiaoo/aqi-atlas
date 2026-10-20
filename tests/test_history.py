import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from aqirec.data import CITIES
from aqirec.history import build_history_report
from aqirec.report import write_report

FIXTURES = Path(__file__).parent / "fixtures" / "aqiin"


class HistoryTests(unittest.TestCase):
    def test_months_remain_separate_across_years_and_use_only_in_range_dates(self):
        report = build_history_report(date(2025, 10, 20), date(2026, 10, 19), FIXTURES, selected_cities=CITIES)
        self.assertEqual(report["provider"], "AQI.in")
        self.assertEqual(report["expected_days"], 365)
        city = report["cities"][0]
        self.assertEqual(len(city["monthly"]), 13)
        self.assertEqual(city["monthly"][0]["mean"]["valid_days"], 12)
        self.assertEqual(city["monthly"][-1]["mean"]["valid_days"], 19)
        values = [row["mean"] for row in city["days"] if row["mean"] is not None]
        self.assertAlmostEqual(city["summary"]["mean"]["average"], sum(values) / len(values))

    def test_missing_cache_requires_refresh_and_does_not_fabricate_values(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "--refresh"):
            build_history_report(date(2026, 1, 1), date(2026, 1, 2), Path(directory), selected_cities=CITIES[:1])

    def test_policy_and_both_pages_use_only_current_data_and_provider(self):
        report = build_history_report(date(2025, 10, 20), date(2026, 10, 19), FIXTURES, selected_cities=CITIES)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            write_report(report, output)
            policy = (output / "source-policy.md").read_text(encoding="utf-8")
            self.assertIn("AQI.in", policy)
            for retired in ("CAMS", "IQAir", "verification", "prototypes"):
                for filename in ("source-policy.md", "index.html", "compare.html"):
                    self.assertNotIn(retired, (output / filename).read_text(encoding="utf-8"))
            saved = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["cities"], report["cities"])
