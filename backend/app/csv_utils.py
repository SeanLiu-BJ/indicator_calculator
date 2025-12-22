from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Any


class CsvError(ValueError):
    pass


@dataclass
class ParsedCsv:
    columns: list[str]
    rows: list[dict[str, str]]


def _strip_bom(text: str) -> str:
    if text.startswith("\ufeff"):
        return text.lstrip("\ufeff")
    return text


def parse_csv_text(csv_text: str) -> ParsedCsv:
    raw = _strip_bom(csv_text).strip()
    if not raw:
        raise CsvError("CSV 为空")

    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        raise CsvError("CSV 缺少表头")

    columns = [c.strip() for c in reader.fieldnames if c is not None and str(c).strip()]
    rows: list[dict[str, str]] = []
    for row in reader:
        cleaned: dict[str, str] = {}
        for col in columns:
            v = row.get(col)
            cleaned[col] = "" if v is None else str(v).strip()
        rows.append(cleaned)
    return ParsedCsv(columns=columns, rows=rows)


def infer_schema(columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    types: dict[str, str] = {}
    for col in columns:
        non_empty = [r.get(col, "") for r in rows if r.get(col, "").strip() != ""]
        if not non_empty:
            types[col] = "string"
            continue
        if col == "year":
            ok = True
            for v in non_empty:
                try:
                    int(float(v))
                except Exception:
                    ok = False
                    break
            types[col] = "int" if ok else "string"
            continue
        is_num = True
        for v in non_empty:
            try:
                float(v)
            except Exception:
                is_num = False
                break
        types[col] = "number" if is_num else "string"

    return {
        "columns": columns,
        "types": types,
        "rowCount": len(rows),
        "required": ["entity", "year"],
    }


def ensure_required_columns(
    parsed: ParsedCsv,
    *,
    year_override: int | None,
) -> ParsedCsv:
    columns = list(parsed.columns)
    rows = [dict(r) for r in parsed.rows]

    if "entity" not in columns:
        raise CsvError("CSV 必须包含 entity 列")

    if "year" not in columns:
        if year_override is None:
            raise CsvError("CSV 缺少 year 列，请在导入时输入 year")
        columns = ["entity", "year"] + [c for c in columns if c != "entity"]
        for r in rows:
            r["year"] = str(int(year_override))

    # normalize year
    for r in rows:
        y = r.get("year", "").strip()
        if not y:
            if year_override is None:
                raise CsvError("存在空 year 值")
            r["year"] = str(int(year_override))
            continue
        try:
            r["year"] = str(int(float(y)))
        except Exception:
            raise CsvError(f"year 非数字: {y}")

    return ParsedCsv(columns=columns, rows=rows)


def ensure_unique_entity_year(rows: list[dict[str, str]]) -> None:
    seen: set[tuple[str, str]] = set()
    dup: set[tuple[str, str]] = set()
    for r in rows:
        k = (r.get("entity", "").strip(), r.get("year", "").strip())
        if k in seen:
            dup.add(k)
        seen.add(k)
    if dup:
        examples = ", ".join([f"({e},{y})" for e, y in list(dup)[:5]])
        raise CsvError(f"entity+year 重复（示例 {examples}）")


def to_csv_text(columns: list[str], rows: list[dict[str, str]]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for r in rows:
        writer.writerow({c: r.get(c, "") for c in columns})
    return buf.getvalue()

