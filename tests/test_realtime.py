import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from aqirec.aqiin_api import city_slug
from aqirec.data import CITIES, SHANGHAI
from aqirec.realtime import RealtimeCache, parse_realtime


def payload(city=CITIES[0], value=116):
    return {"status": "Success", "data": [{"slug": city_slug(city), "searchType": "cityId",
            "iaqi": {"aqi": value, "AQI-IN": 999}, "updatedAt": "2026-10-20T05:31:00.000Z",
            "updated_at": "2026-10-20T13:31:00.000Z", "time_zone": "Asia/Manila",
            "isOnline": True, "source": "Data Model"}]}


NOW = datetime(2026, 10, 20, 13, 40, tzinfo=SHANGHAI)


class RealtimeTests(unittest.TestCase):
    def test_exact_city_us_sensor_and_real_utc_timestamp_are_preserved(self):
        row = parse_realtime(payload(), CITIES[0], NOW)
        self.assertEqual(row["aqi"], 116)
        self.assertEqual(row["standard"], "AQI-US")
        self.assertEqual(datetime.fromisoformat(row["observed_at"]).astimezone(SHANGHAI).hour, 13)
        self.assertEqual(row["platform_source"], "Data Model")
        self.assertEqual(parse_realtime(payload(value=0), CITIES[0], NOW)["aqi"], 0)

    def test_nearest_other_city_station_wrong_index_and_bad_values_are_rejected(self):
        for change in ({"slug": city_slug(CITIES[1])}, {"searchType": "locationId"},
                       {"iaqi": {"AQI-IN": 40}}, {"iaqi": {"aqi": float("nan")}},
                       {"iaqi": {"aqi": True}}, {"iaqi": {"aqi": -1}},
                       {"updatedAt": "2026-10-20T13:31:00Z"}, {"isOnline": False}):
            data = payload()
            data["data"][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse_realtime(data, CITIES[0], NOW)

    def test_background_cache_throttles_requests_preserves_raw_hash_and_survives_restart(self):
        # Multiline/unicode bytes must hash identically on Windows after saving.
        raw = json.dumps(payload(), indent=2, ensure_ascii=False).encode("utf-8")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "public.html"
            page.write_text("public bootstrap", encoding="utf-8")
            cache = RealtimeCache(root / "realtime", page)
            with patch("aqirec.realtime.published_client_token", return_value="public.example"), \
                    patch("aqirec.realtime.urlopen", side_effect=lambda *a, **k: io.BytesIO(raw)) as request:
                cache.tick((CITIES[0],), NOW)
                cache.tick((CITIES[0],), NOW + timedelta(minutes=4))
                self.assertEqual(request.call_count, 1)
                cache.tick((CITIES[0],), NOW + timedelta(minutes=5))
                self.assertEqual(request.call_count, 2)
                self.assertIn("type=2", request.call_args.args[0].full_url)
            reloaded = RealtimeCache(root / "realtime", page)
            row = reloaded.snapshot((CITIES[0],), NOW + timedelta(minutes=5))["cities"][0]
            self.assertEqual((row["aqi"], row["status"]), (116, "ok"))
            self.assertEqual((root / "realtime/hangzhou.json").read_bytes(), raw)
            self.assertFalse((root / "api").exists())

    def test_failure_keeps_previous_value_marks_stale_and_does_not_show_yesterday_as_today(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "public.html"
            page.write_text("public bootstrap", encoding="utf-8")
            cache = RealtimeCache(root / "live", page)
            with patch("aqirec.realtime.published_client_token", return_value="public.example"), \
                    patch("aqirec.realtime.urlopen", return_value=io.BytesIO(json.dumps(payload()).encode())):
                cache.tick((CITIES[0],), NOW)
            with patch("aqirec.realtime.published_client_token", return_value="public.example"), \
                    patch("aqirec.realtime.urlopen", side_effect=OSError("offline")):
                cache.tick((CITIES[0],), NOW + timedelta(minutes=5))
            row = cache.snapshot((CITIES[0],), NOW + timedelta(minutes=5))["cities"][0]
            self.assertEqual((row["aqi"], row["status"]), (116, "stale"))
            next_day = cache.snapshot((CITIES[0],), NOW + timedelta(days=1))["cities"][0]
            self.assertIsNone(next_day["aqi"])
            self.assertEqual(next_day["status"], "unavailable")

    def test_empty_selection_makes_no_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RealtimeCache(Path(directory), Path(directory) / "unused.html")
            with patch("aqirec.realtime.urlopen") as request:
                cache.tick((), NOW)
                request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
