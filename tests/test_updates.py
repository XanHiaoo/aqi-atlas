import json
import hashlib
import shutil
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

from aqirec.aqiin_api import city_slug
from aqirec.cities import load_cities, save_cities
from aqirec.data import CITIES, SHANGHAI
from aqirec.history import build_history_report
from aqirec.report import write_report
from aqirec.server import Dashboard
from aqirec.updates import AutoUpdater

ROOT = Path(__file__).resolve().parents[1]


class ScheduleTests(unittest.TestCase):
    def test_midnight_selection_persistence_and_restart_catchup(self):
        start = datetime(2026, 10, 19, 23, 55, tzinfo=SHANGHAI)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "updates.json"
            refresh = Mock(return_value={"complete": True})
            updater = AutoUpdater(file, refresh, now=start)
            updater.select(["hangzhou", "sanya"])
            self.assertFalse(updater.tick(start + timedelta(minutes=9)))
            updater = AutoUpdater(file, refresh, now=start + timedelta(minutes=10))
            self.assertTrue(updater.tick(start + timedelta(minutes=10)))
            refresh.assert_called_once_with(["hangzhou", "sanya"], date(2026, 10, 20))
            self.assertFalse(updater.tick(start + timedelta(hours=2)))
            self.assertEqual(updater.snapshot()["next_attempt_at"], "2026-10-21T00:05:00+08:00")
            # A service that was off at midnight catches up on its next start.
            later = datetime(2026, 10, 22, 9, 0, tzinfo=SHANGHAI)
            updater = AutoUpdater(file, refresh, now=later)
            self.assertTrue(updater.tick(later))
            self.assertEqual(refresh.call_args.args[1], later.date())

    def test_unpublished_and_network_failure_retry_only_current_selection(self):
        start = datetime(2026, 10, 19, 23, 59, tzinfo=SHANGHAI)
        with tempfile.TemporaryDirectory() as directory:
            refresh = Mock(side_effect=[{"complete": False}, OSError("offline"), {"complete": True}])
            updater = AutoUpdater(Path(directory) / "updates.json", refresh, now=start)
            updater.select(["hangzhou", "beijing"])
            due = datetime(2026, 10, 20, 0, 5, tzinfo=SHANGHAI)
            updater.tick(due)
            self.assertEqual(updater.snapshot()["status"], "waiting")
            self.assertFalse(updater.tick(due + timedelta(minutes=14)))
            updater.forget("beijing")
            updater.tick(due + timedelta(minutes=15))
            self.assertEqual(refresh.call_args.args[0], ["hangzhou"])
            self.assertEqual(updater.snapshot()["status"], "retry")
            self.assertEqual(updater.snapshot()["last_error"], "offline")
            self.assertEqual(updater.snapshot()["next_attempt_at"], "2026-10-20T00:50:00+08:00")
            updater.tick(due + timedelta(minutes=45))
            self.assertEqual(updater.snapshot()["status"], "complete")

    def test_empty_selection_makes_no_network_requests(self):
        start = datetime(2026, 10, 19, 23, 59, tzinfo=SHANGHAI)
        with tempfile.TemporaryDirectory() as directory:
            refresh = Mock()
            updater = AutoUpdater(Path(directory) / "updates.json", refresh, now=start)
            updater.select([])
            updater.tick(start + timedelta(minutes=10))
            refresh.assert_not_called()
            self.assertEqual(updater.snapshot()["status"], "no_selection")


class DashboardUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.snapshots = self.root / "snapshots"
        shutil.copytree(ROOT / "tests/fixtures/aqiin", self.snapshots)
        self.output = self.root / "output"
        save_cities(self.root / "cities.json", CITIES)
        write_report(build_history_report(date(2025, 10, 19), date(2026, 10, 19), self.snapshots, selected_cities=CITIES), self.output)
        self.dashboard = Dashboard(self.output, self.snapshots, ROOT / "tests/fixtures/client.html", self.root / "cities.json")

    def tearDown(self):
        self.temporary.cleanup()

    def test_saved_cities_can_be_deleted_empty_stays_empty_and_readding_works(self):
        self.dashboard.select(["hangzhou", "sanya", "beijing"])
        self.dashboard.delete("hangzhou")
        self.assertNotIn("hangzhou", [city.key for city in load_cities(self.dashboard.registry)])
        self.assertEqual(self.dashboard.status()["update"]["selected_keys"], ["sanya", "beijing"])
        self.assertEqual(len(self.dashboard.read_report()["cities"]), 3)
        for city in CITIES:
            self.dashboard.delete(city.key)
        self.assertEqual(load_cities(self.dashboard.registry), ())
        self.assertEqual(self.dashboard.read_report()["cities"], [])
        city = CITIES[0]
        self.dashboard.results[city_slug(city)] = city
        with patch("aqirec.server.refresh_calendars"):
            self.dashboard.add(city_slug(city))
        self.assertEqual(load_cities(self.dashboard.registry), (city,))
        # Deleting is reversible and never removes original source files.
        self.assertTrue((self.snapshots / "api/hangzhou-2026.json").exists())

    def test_version_one_registry_contains_only_explicitly_saved_cities(self):
        registry = self.dashboard.registry
        registry.write_text(json.dumps({"version": 1, "cities": []}), encoding="utf-8")
        self.assertEqual(load_cities(registry), ())
        save_cities(registry, CITIES[1:])
        payload = json.loads(registry.read_text(encoding="utf-8"))
        payload["version"] = 1
        registry.write_text(json.dumps(payload), encoding="utf-8")
        self.assertEqual(load_cities(registry), CITIES[1:])

    def test_refresh_rolls_dates_but_fetches_only_selected_cities_and_recent_year(self):
        with patch("aqirec.server.refresh_calendars") as fetch:
            result = self.dashboard.refresh_selected(["hangzhou", "sanya"], date(2026, 10, 20))
        self.assertEqual([city.key for city in fetch.call_args.kwargs["cities"]], ["hangzhou", "sanya"])
        self.assertEqual(fetch.call_args.kwargs["years"], [2026])
        report = self.dashboard.read_report()
        self.assertEqual(report["start_date"], "2025-10-20")
        self.assertEqual(report["end_date"], "2026-10-19")
        self.assertEqual(report["expected_days"], 365)
        self.assertEqual(len(report["cities"]), 4)
        self.assertTrue(result["complete"])
        self.assertEqual([city["key"] for city in result["publication"]], ["hangzhou", "sanya"])

    def test_network_or_validation_failure_preserves_active_cache_and_report(self):
        before = {file: file.read_bytes() for file in self.snapshots.rglob("*") if file.is_file()}
        original_report = (self.output / "report.json").read_bytes()
        for error in (OSError("offline"), ValueError("source conflict")):
            with patch("aqirec.server.refresh_calendars", side_effect=error):
                with self.assertRaises(type(error)):
                    self.dashboard.refresh_selected(["hangzhou"], date(2026, 10, 20))
            self.assertEqual((self.output / "report.json").read_bytes(), original_report)
            self.assertTrue(all(file.read_bytes() == raw for file, raw in before.items()))

    def test_incomplete_returned_history_cannot_erase_previously_acquired_values(self):
        original = (self.snapshots / "api/hangzhou-2026.json").read_bytes()
        def partial(start, end, staging, page, **kwargs):
            file = staging / "api/hangzhou-2026.json"
            payload = json.loads(file.read_text(encoding="utf-8"))
            payload["data"] = payload["data"][1:]
            raw = json.dumps(payload).encode("utf-8")
            file.write_bytes(raw)
            receipt_file = file.with_suffix(".receipt.json")
            receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
            receipt["sha256"] = hashlib.sha256(raw).hexdigest()
            receipt_file.write_text(json.dumps(receipt), encoding="utf-8")
        with patch("aqirec.server.refresh_calendars", side_effect=partial):
            with self.assertRaisesRegex(ValueError, "返回记录减少"):
                self.dashboard.refresh_selected(["hangzhou"], date(2026, 10, 20))
        self.assertEqual((self.snapshots / "api/hangzhou-2026.json").read_bytes(), original)

    def test_new_year_refresh_does_not_request_the_excluded_current_day_year(self):
        with patch("aqirec.server.refresh_calendars") as fetch:
            self.dashboard.refresh_selected(["hangzhou"], date(2026, 1, 1))
        self.assertEqual(fetch.call_args.kwargs["years"], [2025])

    def test_date_and_year_labels_roll_without_waiting_for_a_network_fetch(self):
        with patch("aqirec.server.refresh_calendars") as fetch:
            self.assertTrue(self.dashboard.roll_period(date(2026, 10, 20)))
            fetch.assert_not_called()
        report = self.dashboard.read_report()
        self.assertEqual((report["start_date"], report["end_date"], report["expected_days"]),
                         ("2025-10-20", "2026-10-19", 365))
        self.assertFalse(self.dashboard.roll_period(date(2026, 10, 20)))
        self.assertTrue(self.dashboard.roll_period(date(2027, 1, 1)))
        self.assertEqual(self.dashboard.read_report()["end_date"], "2026-12-31")
        html = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertIn('<div class="year">2026</div>', html)

    def test_no_city_selected_does_not_fetch_and_invalid_selection_is_rejected(self):
        with patch("aqirec.server.refresh_calendars") as fetch:
            self.dashboard.refresh_selected([], date(2026, 10, 20))
            fetch.assert_not_called()
        with self.assertRaises(ValueError):
            self.dashboard.select("hangzhou")
        self.dashboard.select(["hangzhou", "removed-city"])
        self.assertEqual(self.dashboard.status()["update"]["selected_keys"], ["hangzhou"])


if __name__ == "__main__":
    unittest.main()
