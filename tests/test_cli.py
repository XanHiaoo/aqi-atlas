import contextlib
import io
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
