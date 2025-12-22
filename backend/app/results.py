from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any


def read_csv_rows(path: Path, *, limit: int | None = None) -> tuple[list[str], list[dict[str, Any]]]:
    text = path.read_text(encoding="utf-8")
    reader = csv.DictReader(io.StringIO(text))
    cols = reader.fieldnames or []
    rows: list[dict[str, Any]] = []
    for idx, r in enumerate(reader):
        if limit is not None and idx >= limit:
            break
        rows.append({k: r.get(k, "") for k in cols})
    return cols, rows


def write_csv(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            writer.writerow({c: r.get(c, "") for c in columns})

