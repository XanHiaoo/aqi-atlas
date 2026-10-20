import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aqirec.cities import Region, _search_request, city_from_location, region_from_location, save_cities, search_cities
from aqirec.server import Dashboard


REGION = {"searchType": "stateId", "slug": "japan/tokyo", "state": "Tokyo", "location": "Tokyo",
          "country": "Japan", "latitude": 35.6769, "longitude": 139.764}
TOKYO = {"searchType": "cityId", "slug": "japan/tokyo/tokyo", "city": "Tokyo", "state": "Tokyo",
         "country": "Japan", "latitude": 35.6895, "longitude": 139.6917}
STATION = {"searchType": "locationId", "slug": "japan/tokyo/tokyo/naitamachi", "city": "Tokyo",
           "latitude": 35.6867, "longitude": 139.708, "iaqi": {"aqi": 999}}


def response(payload):
    return io.BytesIO(json.dumps(payload).encode())


class RegionSearchTests(unittest.TestCase):
    def test_regions_and_cities_remain_distinct_and_stations_are_rejected(self):
        region, city = region_from_location(REGION), city_from_location(TOKYO)
        self.assertIsInstance(region, Region)
        self.assertEqual(region.name, "东京都")
        self.assertEqual(region.search_type, "stateId")
        self.assertNotEqual(region.key, city.key)
        for row in ({**REGION, "searchType": "countryId"}, {**REGION, "slug": "japan/tokyo/tokyo"},
                    {**REGION, "slug": "../tokyo"}, {**REGION, "latitude": float("nan")}):
            with self.subTest(row=row), self.assertRaises(ValueError):
                region_from_location(row)
        with self.assertRaises(ValueError):
            city_from_location(STATION)

    def test_chinese_and_english_queries_return_a_labeled_exact_region_and_city(self):
        with tempfile.TemporaryDirectory() as directory:
            page = Path(directory) / "page.html"
            page.write_text("public page", encoding="utf-8")
            for query in ("东京", "东京都", "Tokyo"):
                with patch("aqirec.cities.published_client_token", return_value="public.example"), \
                        patch("aqirec.cities._search_request", return_value=[TOKYO, REGION, TOKYO]) as request:
                    places = search_cities(query, page)
                    self.assertEqual(len(places), 2)
                    self.assertIsInstance(places[0], Region)
                    self.assertEqual(places[1].slug, "japan/tokyo/tokyo")
                    request.assert_called_once_with("Tokyo", "public.example")

    def test_search_keeps_regions_but_never_returns_a_station_as_city_data(self):
        search = {"status": "success", "data": {"states": [REGION], "cities": [], "stations": [STATION]}}
        nearest = {"status": "Success", "data": [{**TOKYO, "iaqi": {"aqi": 42}}]}
        with patch("aqirec.cities.urlopen", side_effect=[response(search), response(nearest)]) as request:
            rows = _search_request("Tokyo", "public.example")
            self.assertEqual({row["searchType"] for row in rows}, {"stateId", "cityId"})
            city = next(row for row in rows if row["searchType"] == "cityId")
            self.assertEqual(city["iaqi"]["aqi"], 42)
            self.assertEqual(city["latitude"], TOKYO["latitude"])
            self.assertIn("type=2", request.call_args.args[0].full_url)

    def test_nearby_different_city_and_failed_resolution_do_not_hide_the_region(self):
        search = {"status": "success", "data": {"states": [REGION], "stations": [STATION]}}
        for fallback in (response({"status": "Success", "data": [{**TOKYO, "slug": "japan/tokyo/shibuya"}]}), OSError("offline")):
            with patch("aqirec.cities.urlopen", side_effect=[response(search), fallback, response({"results": []})]):
                self.assertEqual(_search_request("Tokyo", "public.example"), [REGION])

    def test_missing_exact_city_can_be_confirmed_from_coordinates_without_using_geocoded_aqi(self):
        search = {"status": "success", "data": {"states": [REGION]}}
        geocoded = {"results": [{"name": "Tokyo", "country": "Japan", "latitude": 35.6895, "longitude": 139.6917}]}
        nearest = {"status": "Success", "data": [TOKYO]}
        with patch("aqirec.cities.urlopen", side_effect=[response(search), response(geocoded), response(nearest)]):
            rows = _search_request("Tokyo", "public.example")
        self.assertIn(TOKYO, rows)
        self.assertIn(REGION, rows)

    def test_region_browsing_filters_other_regions_and_prevents_aggregate_fabrication(self):
        region = region_from_location(REGION)
        tokyo = city_from_location(TOKYO)
        foreign = city_from_location({**TOKYO, "slug": "japan/osaka/osaka", "city": "Osaka", "state": "Osaka"})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.json"
            report.write_text('{"cities": []}', encoding="utf-8")
            dashboard = Dashboard(root, root / "snapshots", root / "page.html", root / "cities.json")
            dashboard.results[region.slug] = region
            with patch("aqirec.server.search_cities", return_value=[region, tokyo, foreign]):
                result = dashboard.region_cities(region.slug)
            self.assertEqual([row["slug"] for row in result["cities"]], [tokyo.slug])
            self.assertIn(tokyo.slug, dashboard.results)
            with patch("aqirec.server.refresh_calendars") as refresh, self.assertRaisesRegex(ValueError, "地区级历史日值"):
                dashboard.add(region.slug)
            refresh.assert_not_called()
            self.assertEqual(report.read_text(encoding="utf-8"), '{"cities": []}')
            with self.assertRaises(ValueError):
                dashboard.region_cities("japan/unsearched")
            with self.assertRaises(ValueError):
                save_cities(root / "cities.json", [region])
            self.assertFalse((root / "cities.json").exists())


if __name__ == "__main__":
    unittest.main()
