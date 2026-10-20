import unittest
from datetime import date, timedelta

from aqirec.data import category_index, date_range, resolve_period, summarize, valid_number


class DomainTests(unittest.TestCase):
    def test_default_period_contains_365_dates_and_excludes_today(self):
        today = date(2026, 10, 20)
        start, end = resolve_period(today=today)
        self.assertEqual((start, end), (date(2025, 10, 20), date(2026, 10, 19)))
        self.assertEqual(len(list(date_range(start, end))), 365)
        self.assertEqual(resolve_period(2025, today=today)[1], date(2025, 12, 31))
        for boundary in (date(2026, 1, 1), date(2024, 2, 29), date(2025, 2, 28)):
            start, end = resolve_period(today=boundary)
            self.assertEqual((end - start).days, 364)
            self.assertEqual(end, boundary - timedelta(days=1))

    def test_custom_dates_validate_order_future_and_two_year_limit(self):
        today = date(2026, 10, 20)
        self.assertEqual(resolve_period(end=today, today=today, start=date(2026, 9, 1)), (date(2026, 9, 1), today))
        for kwargs in ({"end": today + timedelta(days=1)}, {"start": today + timedelta(days=1)},
                       {"year": 2027}, {"year": 2026, "start": date(2026, 1, 1)},
                       {"year": 2026, "end": date(2025, 12, 31)}, {"start": date(2020, 1, 1)}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                resolve_period(today=today, **kwargs)

    def test_only_finite_nonnegative_numeric_values_are_valid(self):
        for value in (0, 1, 50.5, 650):
            self.assertTrue(valid_number(value))
        for value in (None, True, False, -1, float("nan"), float("inf"), "50"):
            self.assertFalse(valid_number(value))

    def test_category_boundaries_use_half_up_rounding(self):
        for value, index in [(0, 0), (50.49, 0), (50.5, 1), (100.49, 1), (100.5, 2),
                             (150.5, 3), (200.5, 4), (300.5, 5), (650, 5)]:
            self.assertEqual(category_index(value), index)
        self.assertIsNone(category_index(None))

    def test_summaries_preserve_zero_exclude_missing_and_separate_pending_days(self):
        days = [{"date": "2026-10-17", "mean": 0}, {"date": "2026-10-18", "mean": 120},
                {"date": "2026-10-19", "mean": None},
                {"date": "2026-10-20", "mean": None, "provisional": True}]
        stats = summarize(days, "mean")
        self.assertEqual((stats["valid_days"], stats["missing_days"], stats["pending_days"]), (2, 1, 1))
        self.assertEqual(stats["average"], 60)
        self.assertEqual(stats["share_le_100"], .5)
        self.assertEqual(sum(stats["category_counts"]), 2)
        self.assertEqual(stats["worst_date"], "2026-10-18")

    def test_all_missing_has_no_mean_share_or_worst_date(self):
        stats = summarize([{"date": "2026-01-01", "mean": None}], "mean")
        for field in ("average", "share_le_100", "worst_date"):
            self.assertIsNone(stats[field])
