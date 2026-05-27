from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    log_dir: Path
    token: str | None


def get_settings() -> Settings:
    data_dir = Path(os.environ.get("INDICATOR_DATA_DIR", ""))
    if not str(data_dir).strip():
        data_dir = Path(__file__).resolve().parents[2] / ".localdata"
    log_dir = Path(os.environ.get("INDICATOR_LOG_DIR", ""))
    if not str(log_dir).strip():
        log_dir = data_dir / "logs"
    token = os.environ.get("INDICATOR_TOKEN") or None
    return Settings(data_dir=data_dir, log_dir=log_dir, token=token)
