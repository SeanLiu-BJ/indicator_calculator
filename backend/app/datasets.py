from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import numpy as np

from .csv_utils import CsvError, ParsedCsv, ensure_required_columns, ensure_unique_entity_year, infer_schema, parse_csv_text, to_csv_text
from .storage import Store
from .types import Direction, IndicatorRecord


def read_csv_file(path: Path) -> ParsedCsv:
    return parse_csv_text(path.read_text(encoding="utf-8"))


def normalize_imported_csv(
    *,
    csv_text: str,
    year_override: int | None,
) -> tuple[str, dict[str, Any]]:
    parsed = parse_csv_text(csv_text)
    parsed2 = ensure_required_columns(parsed, year_override=year_override)
    ensure_unique_entity_year(parsed2.rows)
    schema = infer_schema(parsed2.columns, parsed2.rows)
    normalized_text = to_csv_text(parsed2.columns, parsed2.rows)
    return normalized_text, schema


def load_dataset_rows(store: Store, dataset_id: str) -> ParsedCsv:
    ds = store.get_dataset(dataset_id)
    return read_csv_file(Path(ds["csvPath"]))


def build_matrix_for_datasets(
    *,
    store: Store,
    dataset_ids: list[str],
    indicator_keys: list[str],
    indicators_by_key: dict[str, IndicatorRecord],
) -> tuple[list[str], list[int], np.ndarray, list[Direction]]:
    entities: list[str] = []
    years: list[int] = []
    values: list[list[float]] = []

    directions: list[Direction] = []
    for k in indicator_keys:
        ind = indicators_by_key.get(k)
        if not ind:
            raise CsvError(f"指标不存在: {k}")
        directions.append(ind["direction"])

    for dataset_id in dataset_ids:
        ds = store.get_dataset(dataset_id)
        parsed = read_csv_file(Path(ds["csvPath"]))
        mapping = store.get_mapping(dataset_id)["map"]

        col_for_key: dict[str, str] = {}
        for k in indicator_keys:
            col = mapping.get(k)
            if not col:
                raise CsvError(f"数据集 {ds['name']} 未映射指标: {k}")
            col_for_key[k] = col
            if col not in parsed.columns:
                raise CsvError(f"数据集 {ds['name']} 缺少列: {col}（用于指标 {k}）")

        if "entity" not in parsed.columns or "year" not in parsed.columns:
            raise CsvError(f"数据集 {ds['name']} 缺少 entity/year 列")

        for r in parsed.rows:
            e = r.get("entity", "").strip()
            y = r.get("year", "").strip()
            if not e or not y:
                raise CsvError(f"数据集 {ds['name']} 存在空 entity/year")
            try:
                yi = int(float(y))
            except Exception:
                raise CsvError(f"year 非数字: {y}")

            row_values: list[float] = []
            for k in indicator_keys:
                col = col_for_key[k]
                v = r.get(col, "").strip()
                if v == "":
                    raise CsvError(f"数据集 {ds['name']} 缺失值：{e}-{yi} 的列 {col}")
                try:
                    row_values.append(float(v))
                except Exception:
                    raise CsvError(f"数据集 {ds['name']} 非数值：{e}-{yi} 的列 {col}={v}")

            entities.append(e)
            years.append(yi)
            values.append(row_values)

    x = np.array(values, dtype=float)
    return entities, years, x, directions

