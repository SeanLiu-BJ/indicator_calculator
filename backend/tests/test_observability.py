from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app import main
from backend.app.observability import tail_log


class ObservabilityTests(unittest.TestCase):
    def test_tail_log_returns_recent_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.log"
            path.write_text("a\nb\nc\nd\n", encoding="utf-8")
            self.assertEqual(tail_log(path, limit=2), ["c", "d"])

    def test_debug_logs_reads_from_configured_log_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            original_log_dir = main.settings.log_dir
            try:
                object.__setattr__(main.settings, "log_dir", Path(tmpdir))
                (main.settings.log_dir / "requests.log").write_text("req-1\nreq-2\n", encoding="utf-8")
                (main.settings.log_dir / "events.log").write_text("event-1\n", encoding="utf-8")
                (main.settings.log_dir / "errors.log").write_text("error-1\n", encoding="utf-8")

                resp = main.get_debug_logs(limit=10)

                self.assertEqual(resp["logDir"], str(Path(tmpdir)))
                self.assertEqual(resp["requestLog"], ["req-1", "req-2"])
                self.assertEqual(resp["eventLog"], ["event-1"])
                self.assertEqual(resp["errorLog"], ["error-1"])
            finally:
                object.__setattr__(main.settings, "log_dir", original_log_dir)


if __name__ == "__main__":
    unittest.main()
