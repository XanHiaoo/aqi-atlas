import io
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from aqirec.aqiin_api import calendar_url, load_api_snapshots, refresh_calendars
from aqirec.cities import city_from_location, load_cities, save_city, search_cities
from aqirec.data import CITIES


def location(slug="china/shanghai/shanghai", city="Shanghai", country="China"):
    return {"slug": slug, "searchType": "cityId", "city": city, "country": country,
            "state": "Shanghai", "latitude": 31.2286, "longitude": 121.475}


class CitySelectionTests(unittest.TestCase):
    def test_official_city_metadata_keeps_region_and_deduplicates_saved_city(self):
        city = city_from_location(location())
        self.assertEqual(city.name, "上海")
        self.assertEqual(city_from_location({**location(), "city": "Taizhou", "state": "Jiangsu", "slug": "china/jiangsu/taizhou"}).name, "泰州")
        self.assertEqual(city_from_location({**location(), "city": "Taizhou", "state": "Zhejiang", "slug": "china/zhejiang/taizhou"}).name, "台州")
        self.assertIn("slug=china%2Fshanghai%2Fshanghai", calendar_url(city, 2025))
        overseas = city_from_location(location("japan/tokyo/tokyo", "Tokyo", "Japan"))
        self.assertNotEqual(overseas.key, city.key)
        self.assertIn("slug=japan%2Ftokyo%2Ftokyo", calendar_url(overseas, 2025))
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "cities.json"
            save_city(file, city)
            save_city(file, city)
            cities = load_cities(file)
            self.assertEqual(len(cities), len(CITIES) + 1)
            self.assertEqual(cities[-1], city)

    def test_stations_invalid_coordinates_and_unsafe_slugs_are_rejected(self):
        for row in ({**location(), "searchType": "stationId"},
                    {**location(), "slug": "../../outside"},
                    {**location(), "latitude": float("nan")},
                    {**location(), "longitude": 181}):
            with self.assertRaises(ValueError):
                city_from_location(row)

    def test_chinese_search_uses_official_city_results_and_city_suffix(self):
        with tempfile.TemporaryDirectory() as directory:
            page = Path(directory) / "public.html"
            page.write_text("test snapshot", encoding="utf-8")
            with patch("aqirec.cities.published_client_token", return_value="public.example"), patch("aqirec.cities._search_request", return_value=[location()]) as request:
                cities = search_cities("上海市", page)
                self.assertEqual(cities[0].name, "上海")
                request.assert_called_once_with("Shanghai", "public.example")

    def test_new_city_can_have_an_empty_year_without_fabricating_days(self):
        city = city_from_location(location())
        class Response(io.BytesIO):
            status = 200
        def fetch(request, timeout):
            rows = [{"day": "2026-10-19", "value": 42}] if "year=2026" in request.full_url else []
            return Response(json.dumps({"status": "success", "data": rows}).encode())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "public.html"
            page.write_text("test snapshot", encoding="utf-8")
            with patch("aqirec.aqiin_api.published_client_token", return_value="public.example"), patch("aqirec.aqiin_api.urlopen", side_effect=fetch):
                refresh_calendars(date(2025, 10, 20), date(2026, 10, 20), root, page, cities=(city,))
            values, receipts = load_api_snapshots(city, root, date(2026, 10, 20))
            self.assertEqual(values, {"2026-10-19": 42})
            self.assertEqual(len(receipts), 2)


if __name__ == "__main__":
    unittest.main()
