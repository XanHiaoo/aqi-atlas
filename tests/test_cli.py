import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aqirec.cli import main

FIXTURES = Path(__file__).parent / "fixtures"


class CliTests(unittest.TestCase):
    def test_builds_current_report_from_offline_fixtures_without_user_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("aqirec.cli.refresh_calendars") as refresh, contextlib.redirect_stdout(io.StringIO()):
                result = main(["--start-date", "2025-10-20", "--end-date", "2026-10-19",
                               "--snapshots", str(FIXTURES / "aqiin"), "--cities-file", str(root / "cities.json"),
                               "--output", str(root / "site")])
            self.assertEqual(result, 0)
            refresh.assert_not_called()
            self.assertTrue((root / "site/index.html").exists())
            self.assertTrue((root / "site/compare.html").exists())
            self.assertEqual(json.loads((root / "site/report.json").read_text(encoding="utf-8"))["cities"], [])

    def test_first_start_with_refresh_has_no_cities_and_needs_no_client_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("aqirec.aqiin_api.urlopen") as request, patch("aqirec.server.serve") as serve, contextlib.redirect_stdout(io.StringIO()):
                result = main(["--snapshots", str(root / "snapshots"), "--cities-file", str(root / "cities.json"),
                               "--aqiin-page", str(root / "missing-client.html"), "--output", str(root / "site"),
                               "--refresh", "--serve"])
            self.assertEqual(result, 0)
            request.assert_not_called()
            serve.assert_called_once()
            self.assertEqual(json.loads((root / "site/report.json").read_text(encoding="utf-8"))["cities"], [])
            self.assertFalse((root / "cities.json").exists())

    def test_serve_uses_current_paths_and_preserves_explicit_date_ranges(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("aqirec.server.serve") as serve, contextlib.redirect_stdout(io.StringIO()):
                result = main(["--year", "2025", "--snapshots", str(FIXTURES / "aqiin"),
                               "--cities-file", str(root / "cities.json"), "--output", str(root / "site"),
                               "--aqiin-page", str(FIXTURES / "client.html"), "--serve", "--port", "8766"])
            self.assertEqual(result, 0)
            self.assertFalse(serve.call_args.kwargs["rolling"])
            self.assertEqual(serve.call_args.kwargs["port"], 8766)
            self.assertEqual(serve.call_args.args[0], (root / "site").resolve())

    def test_rejects_retired_model_source_options(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            main(["--source", "cams"])
        self.assertEqual(error.exception.code, 2)
