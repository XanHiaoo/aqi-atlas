import contextlib
import hashlib
import copy
import io
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from aqirec.aqiin_api import published_client_token
from aqirec.data import CITIES
from aqirec.history import build_history_report
from aqirec.pages import build_pages, export_snapshot, main, refresh_snapshot, save_snapshot
from aqirec.report import write_report

FIXTURES = Path(__file__).parent / "fixtures"


class PagesTests(unittest.TestCase):
    def test_desktop_sources_match_last_version_before_mobile_work(self):
        fingerprints = {
            "report.html": "803bd1240b0f08c11e85c4208aa39fdc3d47ea089f111fefa964307374319c8a",
            "compare.html": "b7132ca7668d43b5ec0b83cea5ffb366f22c0005c1f433c64afeb2a1dc5b4cee",
            "site-nav.html": "8e2406be6737907ad6a0b7eba11b893e31ccb9219e8853ca03774144b7b4edfd",
            "site.css": "b91496f66980eaf54337888d0df3a5dbf61af0cfd58e4f452d9d795f81a9df15",
            "site.js": "cb9370e2b1d3fbf923fe94814ece1adb61afd16e08c3e54899ee7bd672b5a5a1",
        }
        for name, expected in fingerprints.items():
            source = (Path(__file__).parents[1] / "aqirec/templates" / ("desktop-" + name)).read_text(encoding="utf-8")
            self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), expected, name)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.report = build_history_report(date(2025, 10, 20), date(2026, 10, 19), FIXTURES / "aqiin", selected_cities=CITIES)
        self.snapshot = self.root / "site-data/snapshot.json"
        self.live = {"today": "2026-10-20", "server_time": "2026-10-20T12:00:00+08:00", "refreshing": True,
                     "cities": [{"key": "hangzhou", "aqi": 35, "status": "ok", "error": "private-local-path", "token": "never-publish"}]}

    def save(self):
        save_snapshot(self.snapshot, self.report, ["beijing", "hangzhou", "beijing", "deleted"], self.live)

    def test_snapshot_keeps_data_and_selection_but_excludes_private_realtime_fields(self):
        self.save()
        saved = json.loads(self.snapshot.read_text(encoding="utf-8"))
        self.assertEqual(saved["report"], self.report)
        self.assertEqual(saved["selected_keys"], ["beijing", "hangzhou"])
        self.assertEqual(saved["realtime"]["cities"], [{"key": "hangzhou", "aqi": 35, "status": "ok"}])
        self.assertFalse(saved["realtime"]["refreshing"])
        self.assertNotIn("private-local-path", self.snapshot.read_text(encoding="utf-8"))

    def test_build_is_offline_preserves_source_and_embeds_static_data_in_both_pages(self):
        self.save()
        original = self.snapshot.read_bytes()
        output = self.root / "dist"
        with patch("aqirec.aqiin_api.urlopen") as request:
            build_pages(self.snapshot, output)
        request.assert_not_called()
        self.assertEqual(self.snapshot.read_bytes(), original)
        saved = json.loads((output / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["publication"]["mode"], "static")
        self.assertEqual(saved["publication"]["selected_keys"], ["beijing", "hangzhou"])
        for name, element in [("index.html", "report-data"), ("compare.html", "data"),
                              ("desktop-index.html", "report-data"), ("desktop-compare.html", "data")]:
            text = (output / name).read_text(encoding="utf-8")
            embedded = text.split(f'id="{element}">', 1)[1].split("</script>", 1)[0]
            self.assertEqual(json.loads(embedded), saved)
            self.assertNotIn("__AQIREC_", text)
        self.assertTrue((output / ".nojekyll").exists())
        self.assertTrue((output / "daily.csv").exists())

    def test_export_reads_only_existing_local_files(self):
        output = self.root / "output"
        write_report(self.report, output)
        registry = self.root / "cities.json"
        registry.with_name("cities.updates.json").write_text(json.dumps({"selected_keys": ["sanya", "hangzhou"]}), encoding="utf-8")
        with patch("aqirec.pages.RealtimeCache") as cache, patch("aqirec.aqiin_api.urlopen") as request:
            cache.return_value.snapshot.return_value = self.live
            export_snapshot(output, self.root / "snapshots", registry, self.snapshot)
        request.assert_not_called()
        self.assertEqual(json.loads(self.snapshot.read_text(encoding="utf-8"))["selected_keys"], ["sanya", "hangzhou"])

    def test_network_failure_does_not_replace_published_snapshot(self):
        self.save()
        original = self.snapshot.read_bytes()
        with patch("aqirec.pages.refresh_calendars", side_effect=OSError("source unavailable")):
            with self.assertRaises(OSError):
                refresh_snapshot(self.snapshot, "sample.public.token")
        self.assertEqual(self.snapshot.read_bytes(), original)

    def test_refresh_rejects_loss_of_previously_available_data(self):
        self.save()
        original = self.snapshot.read_bytes()
        incomplete = copy.deepcopy(self.report)
        next(day for day in incomplete["cities"][0]["days"] if day["mean"] is not None)["mean"] = None
        with patch("aqirec.pages.refresh_calendars"), patch("aqirec.pages.build_history_report", return_value=incomplete):
            with self.assertRaisesRegex(ValueError, "已有日值缺失"):
                refresh_snapshot(self.snapshot, "sample.public.token")
        self.assertEqual(self.snapshot.read_bytes(), original)

    def test_refresh_uses_environment_configuration_without_publishing_it(self):
        self.save()

        def fetch(start, end, directory, page, **kwargs):
            self.assertEqual(published_client_token(page.read_text(encoding="utf-8")), "sample.public.token")

        with patch("aqirec.pages.refresh_calendars", side_effect=fetch), patch("aqirec.pages.build_history_report", return_value=self.report), patch("aqirec.pages.RealtimeCache") as cache:
            cache.return_value.snapshot.return_value = self.live
            refresh_snapshot(self.snapshot, "sample.public.token")
        self.assertNotIn("sample.public.token", self.snapshot.read_text(encoding="utf-8"))

    def test_no_secret_skips_refresh_without_changing_data(self):
        self.save()
        original = self.snapshot.read_bytes()
        with patch.dict("os.environ", {"AQIIN_CLIENT_TOKEN": ""}), patch("aqirec.pages.refresh_calendars") as fetch, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["refresh", "--snapshot", str(self.snapshot)]), 0)
        fetch.assert_not_called()
        self.assertEqual(self.snapshot.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
