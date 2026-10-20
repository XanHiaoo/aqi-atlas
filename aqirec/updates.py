"""Persistent daily update schedule; the loopback service owns the worker."""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta
from pathlib import Path

from .data import SHANGHAI
from .report import write_text_atomic


def next_midnight(now: datetime) -> datetime:
    # Five minutes after midnight avoids racing the date boundary.
    deadline = now.replace(hour=0, minute=5, second=0, microsecond=0)
    return deadline if now < deadline else deadline + timedelta(days=1)


class AutoUpdater:
    def __init__(self, file: Path, refresh, *, now=None):
        self.file, self.refresh = file, refresh
        self.lock = threading.RLock()
        now = now or datetime.now(SHANGHAI)
        self.state = {"version": 1, "timezone": "Asia/Shanghai", "selected_keys": None,
                      "status": "idle", "last_attempt_at": None, "last_success_at": None,
                      "last_error": None, "attempts": 0,
                      "next_attempt_at": next_midnight(now).isoformat(timespec="seconds")}
        if file.exists():
            self.state.update(json.loads(file.read_text(encoding="utf-8")))
        # A stopped process must not leave a permanent "updating" flag.
        if self.state["status"] == "updating":
            self.state["status"] = "retry"
            self.state["next_attempt_at"] = now.isoformat(timespec="seconds")
        self._save()

    def _save(self):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self.file, json.dumps(self.state, ensure_ascii=False, indent=2))

    def snapshot(self):
        with self.lock:
            return dict(self.state, selected_keys=None if self.state["selected_keys"] is None else list(self.state["selected_keys"]))

    def select(self, keys):
        with self.lock:
            self.state["selected_keys"] = list(dict.fromkeys(keys))
            self._save()

    def forget(self, key):
        with self.lock:
            if self.state["selected_keys"] is not None:
                self.state["selected_keys"] = [value for value in self.state["selected_keys"] if value != key]
                self._save()

    def tick(self, now=None):
        now = now or datetime.now(SHANGHAI)
        with self.lock:
            if self.state["status"] == "updating" or now < datetime.fromisoformat(self.state["next_attempt_at"]):
                return False
            keys = self.state["selected_keys"]
            if not keys:
                self.state.update(status="no_selection", next_attempt_at=next_midnight(now).isoformat(timespec="seconds"))
                self._save()
                return False
            keys = list(keys)
            if self.state.get("cycle_date") != now.date().isoformat():
                self.state["attempts"] = 0
            self.state.update(status="updating", cycle_date=now.date().isoformat(),
                              last_attempt_at=now.isoformat(timespec="seconds"), last_error=None,
                              attempts=self.state["attempts"] + 1, attempted_keys=keys)
            self._save()
        try:
            result = self.refresh(keys, now.date())
        except Exception as error:
            # Transient network/validation errors must not kill the daily worker.
            result = {"complete": False, "error": str(error)[:400] or type(error).__name__}
        with self.lock:
            if result.get("error"):
                self.state.update(status="retry", last_error=result["error"])
            else:
                self.state.update(status="complete" if result["complete"] else "waiting",
                                  last_success_at=now.isoformat(timespec="seconds"), last_error=None,
                                  publication=result.get("publication", []))
            if self.state["status"] == "complete":
                deadline = next_midnight(now)
            else:
                # 15, 30, then 60 minute retries; never postpone the next daily cycle.
                minutes = min(60, 15 * 2 ** min(self.state["attempts"] - 1, 2))
                deadline = min(now + timedelta(minutes=minutes), next_midnight(now))
            self.state["next_attempt_at"] = deadline.isoformat(timespec="seconds")
            self._save()
        return True
