import hashlib
import json
import tempfile
import unittest
from collections import Counter
from datetime import date
from pathlib import Path

from aqirec.aqiin_api import calendar_url, load_api_snapshots, parse_calendar, published_client_token
from aqirec.data import CITIES, category_index, date_range


class CalendarApiTests(unittest.TestCase):
    def test_daily_records_keep_dates_and_reject_bad_years_values_and_duplicates(self):
        payload = {"status": "success", "data": [{"day": "2025-11-01", "value": 91}, {"day": "2025-11-02", "value": 133}]}
        self.assertEqual(parse_calendar(payload, year=2025, cutoff=date(2025, 11, 1)), {"2025-11-01": 91})
        for rows in ([{"day": "2026-11-01", "value": 91}],
                     [{"day": "2025-11-01", "value": -1}],
                     [{"day": "2025-11-01", "value": True}],
                     [{"day": "2025-11-01", "value": float("nan")}],
                     [{"value": 91}],
                     payload["data"] * 2):
            with self.assertRaises(ValueError):
                parse_calendar({"status": "success", "data": rows}, year=2025, cutoff=date(2026, 10, 20))

    def test_public_bootstrap_is_decoded_as_json(self):
        parts = ['f:["$","$L19",null,{"site', 'Store":{"token2":"public.config.sample"}}]']
        html = ''.join('<script>self.__next_f.push(' + json.dumps([1, part]) + ')</script>' for part in parts)
        self.assertEqual(published_client_token(html), "public.config.sample")
        with self.assertRaises(ValueError):
            published_client_token('<script>throw new Error("must not execute")</script>')

    def test_cache_receipts_reject_other_metrics_and_tampered_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "api").mkdir()
            file = root / "api/hangzhou-2025.json"
            raw = json.dumps({"status": "success", "data": [{"day": "2025-11-01", "value": 91}]}).encode()
            file.write_bytes(raw)
            receipt = {"sha256": hashlib.sha256(raw).hexdigest(), "request_url": calendar_url("hangzhou", 2025),
                       "standard": "AQI-US", "sensorname": "aqi", "period": "daily", "city": "hangzhou", "year": 2025,
                       "http_status": 200, "retrieved_at": "2026-10-20T10:00:00+08:00"}
            receipt_file = file.with_suffix(".receipt.json")
            receipt_file.write_text(json.dumps(receipt), encoding="utf-8")
            values, _ = load_api_snapshots("hangzhou", root, date(2026, 10, 20))
            self.assertEqual(values, {"2025-11-01": 91})
            for sensor, standard in (("AQI-IN", "AQI-US"), ("aqi", "CN AQI"), ("pm25", "AQI-US")):
                receipt_file.write_text(json.dumps({**receipt, "sensorname": sensor, "standard": standard}), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_api_snapshots("hangzhou", root, date(2026, 10, 20))
            receipt_file.write_text(json.dumps(receipt), encoding="utf-8")
            file.write_bytes(raw + b' ')
            with self.assertRaises(ValueError):
                load_api_snapshots("hangzhou", root, date(2026, 10, 20))


class PublishedSnapshotIntegrityTests(unittest.TestCase):
    """Pinned public calendar responses provide repeatable offline fixtures."""
    def test_all_four_cities_cover_every_published_day(self):
        root = Path(__file__).parent / "fixtures/aqiin"
        for city in CITIES:
            values, _ = load_api_snapshots(city, root, date(2026, 10, 20))
            self.assertTrue(all(str(day) in values for day in date_range(date(2025, 10, 20), date(2026, 10, 19))))

    def test_hangzhou_2025_known_month_means_and_category_counts(self):
        root = Path(__file__).parent / "fixtures/aqiin"
        values, _ = load_api_snapshots("hangzhou", root, date(2026, 10, 20))
        months = [round(sum(v for d, v in values.items() if d.startswith(f"2025-{m:02}")) /
                        sum(d.startswith(f"2025-{m:02}") for d in values)) for m in range(1, 13)]
        self.assertEqual(months, [123, 112, 89, 97, 79, 59, 51, 54, 64, 81, 99, 110])
        counts = Counter(category_index(v) for d, v in values.items() if d.startswith("2025-"))
        self.assertEqual([counts[i] for i in range(6)], [30, 237, 87, 10, 1, 0])


if __name__ == "__main__":
    unittest.main()
