from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from typing import Any


class CsvError(ValueError):
    pass


@dataclass
class ParsedCsv:
    columns: list[str]
    rows: list[dict[str, str]]


@dataclass
class PreparedImport:
    csv_text: str
    schema: dict[str, Any]
    auto_templates: list[dict[str, Any]]
    detected_layout: str


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


def _extract_year_from_header(header: str) -> int | None:
    text = (header or "").strip()
    match = re.search(r"(20\d{2})", text)
    if not match:
        return None
    return int(match.group(1))


def _looks_like_hierarchical_indicator_sheet(parsed: ParsedCsv) -> bool:
    columns = set(parsed.columns)
    if "一级指标" not in columns or "二级指标" not in columns:
        return False
    year_headers = [column for column in parsed.columns if _extract_year_from_header(column) is not None]
    return len(year_headers) >= 2


def _transform_hierarchical_indicator_sheet(
    parsed: ParsedCsv,
    *,
    default_entity: str,
) -> tuple[ParsedCsv, list[dict[str, Any]]]:
    year_headers = [(column, _extract_year_from_header(column)) for column in parsed.columns]
    year_headers = [(column, year) for column, year in year_headers if year is not None]
    if not year_headers:
        raise CsvError("原始指标表缺少可识别的年份列")

    current_group = "default"
    metric_names: list[str] = []
    templates: list[dict[str, Any]] = []
    rows_by_year: dict[int, dict[str, str]] = {}

    for row in parsed.rows:
        group_value = (row.get("一级指标", "") or "").strip()
        if group_value:
            current_group = group_value

        metric_name = (row.get("二级指标", "") or "").strip()
        if not metric_name:
            continue

        metric_names.append(metric_name)
        templates.append(
            {
                "key": metric_name,
                "name": metric_name,
                "dimension2Key": current_group or "default",
                "direction": "positive",
                "unit": None,
            }
        )

        for header, year in year_headers:
            value = (row.get(header, "") or "").strip()
            if value == "":
                continue
            row_for_year = rows_by_year.setdefault(year, {"entity": default_entity, "year": str(year)})
            row_for_year[metric_name] = value

    if not metric_names:
        raise CsvError("原始指标表没有可转换的二级指标")

    columns = ["entity", "year", *metric_names]
    normalized_rows = [{column: row.get(column, "") for column in columns} for _, row in sorted(rows_by_year.items())]
    if not normalized_rows:
        raise CsvError("原始指标表没有可转换的数据行")

    return ParsedCsv(columns=columns, rows=normalized_rows), templates


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
