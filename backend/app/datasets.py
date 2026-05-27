from __future__ import annotations

import base64
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .csv_utils import CsvError, ParsedCsv, ensure_required_columns, ensure_unique_entity_year, infer_schema, parse_csv_text, to_csv_text
from .observability import log_event
from .storage import Store
from .types import DatasetIndicatorRecord, Direction, IndicatorRecord


@dataclass
class PreparedImport:
    csv_text: str
    schema: dict[str, Any]
    auto_templates: list[IndicatorRecord]
    detected_layout: str


EMBEDDED_TEMPLATE_PREFIX = "# indicator-templates-base64:"


def extract_embedded_templates_and_csv(csv_text: str) -> tuple[list[IndicatorRecord], str]:
    lines = (csv_text or "").splitlines()
    templates: list[IndicatorRecord] = []
    content_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith(EMBEDDED_TEMPLATE_PREFIX):
            payload = stripped.removeprefix(EMBEDDED_TEMPLATE_PREFIX).strip()
            if not payload:
                continue
            try:
                decoded = base64.b64decode(payload).decode("utf-8")
                parsed = json.loads(decoded)
            except Exception as exc:  # pragma: no cover - defensive
                raise CsvError("CSV 内嵌模板元数据解析失败") from exc
            if not isinstance(parsed, list):
                raise CsvError("CSV 内嵌模板元数据格式无效")
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name", "")).strip()
                if not name:
                    continue
                templates.append(
                    {
                        "key": str(item.get("key") or name).strip() or name,
                        "name": name,
                        "dimension2Key": str(item.get("dimension2Key") or "default").strip() or "default",
                        "direction": "negative" if str(item.get("direction", "")).strip().lower() in {"negative", "负向", "neg", "负"} else "positive",
                        "unit": str(item.get("unit")).strip() if item.get("unit") else None,
                    }
                )
            continue
        content_lines.append(line)

    return templates, "\n".join(content_lines)


def read_csv_file(path: Path) -> ParsedCsv:
    return parse_csv_text(path.read_text(encoding="utf-8"))


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
) -> tuple[ParsedCsv, list[IndicatorRecord]]:
    year_headers = [(column, _extract_year_from_header(column)) for column in parsed.columns]
    year_headers = [(column, year) for column, year in year_headers if year is not None]
    if not year_headers:
        raise CsvError("原始指标表缺少可识别的年份列")

    current_group = "default"
    metric_names: list[str] = []
    templates: list[IndicatorRecord] = []
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


def normalize_imported_csv(
    *,
    csv_text: str,
    year_override: int | None,
) -> tuple[str, dict[str, Any]]:
    prepared = prepare_imported_csv(csv_text=csv_text, year_override=year_override)
    return prepared.csv_text, prepared.schema


def prepare_imported_csv(
    *,
    csv_text: str,
    year_override: int | None,
    default_entity: str = "评价指标样本",
) -> PreparedImport:
    embedded_templates, stripped_csv = extract_embedded_templates_and_csv(csv_text)
    parsed = parse_csv_text(stripped_csv)
    auto_templates: list[IndicatorRecord] = list(embedded_templates)
    detected_layout = "wide"

    if _looks_like_hierarchical_indicator_sheet(parsed):
        parsed, hierarchical_templates = _transform_hierarchical_indicator_sheet(parsed, default_entity=default_entity)
        auto_templates = hierarchical_templates
        detected_layout = "hierarchical"
    elif embedded_templates:
        detected_layout = "wide_embedded_templates"

    parsed2 = ensure_required_columns(parsed, year_override=year_override)
    ensure_unique_entity_year(parsed2.rows)
    schema = infer_schema(parsed2.columns, parsed2.rows)
    normalized_text = to_csv_text(parsed2.columns, parsed2.rows)
    return PreparedImport(
        csv_text=normalized_text,
        schema=schema,
        auto_templates=auto_templates,
        detected_layout=detected_layout,
    )


def load_dataset_rows(store: Store, dataset_id: str) -> ParsedCsv:
    ds = store.get_dataset(dataset_id)
    return read_csv_file(Path(ds["csvPath"]))


def infer_indicator_direction(column_name: str) -> Direction:
    return "positive"


def normalize_indicator_token(value: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"[\s\-_./()（）]+", "", text)
    return text


def build_template_lookup(store: Store) -> tuple[dict[str, IndicatorRecord], dict[str, IndicatorRecord]]:
    by_key: dict[str, IndicatorRecord] = {}
    by_name: dict[str, IndicatorRecord] = {}
    for template in store.list_indicators():
        by_key[normalize_indicator_token(template["key"])] = template
        by_name[normalize_indicator_token(template["name"])] = template
    return by_key, by_name


def match_template_for_column(
    source_column: str,
    *,
    template_by_key: dict[str, IndicatorRecord],
    template_by_name: dict[str, IndicatorRecord],
) -> IndicatorRecord | None:
    token = normalize_indicator_token(source_column)
    return template_by_key.get(token) or template_by_name.get(token)


def sync_dataset_indicator_set(store: Store, dataset_id: str) -> list[DatasetIndicatorRecord]:
    parsed = load_dataset_rows(store, dataset_id)
    source_columns = [column for column in parsed.columns if column not in {"entity", "year"}]
    existing = {indicator["key"]: indicator for indicator in store.list_dataset_indicators(dataset_id)}
    template_by_key, template_by_name = build_template_lookup(store)
    mapping = store.get_mapping(dataset_id)["map"]

    records: list[DatasetIndicatorRecord] = []
    covered_columns: set[str] = set()
    covered_keys: set[str] = set()

    for key, indicator in existing.items():
        source_column = indicator.get("sourceColumn") or mapping.get(key) or key
        if source_column not in source_columns:
            continue
        template = match_template_for_column(source_column, template_by_key=template_by_key, template_by_name=template_by_name)
        if indicator.get("isAutoGenerated", True) and template:
            normalized_indicator = {
                "key": template["key"],
                "name": template["name"],
                "dimension2Key": template["dimension2Key"],
                "direction": template["direction"],
                "unit": template["unit"],
                "sourceColumn": source_column,
                "sourceDatasetId": dataset_id,
                "isAutoGenerated": True,
            }
        else:
            normalized_indicator = {
                **indicator,
                "sourceColumn": source_column,
                "sourceDatasetId": dataset_id,
                "isAutoGenerated": bool(indicator.get("isAutoGenerated", True)),
            }
        records.append(
            normalized_indicator
        )
        covered_columns.add(source_column)
        covered_keys.add(normalized_indicator["key"])

    for key, source_column in mapping.items():
        if key in covered_keys or source_column not in source_columns:
            continue
        template = match_template_for_column(key, template_by_key=template_by_key, template_by_name=template_by_name)
        if not template:
            continue
        records.append(
            {
                **template,
                "sourceColumn": source_column,
                "sourceDatasetId": dataset_id,
                "isAutoGenerated": False,
            }
        )
        covered_columns.add(source_column)
        covered_keys.add(key)

    for source_column in source_columns:
        if source_column in covered_columns:
            continue
        template = match_template_for_column(source_column, template_by_key=template_by_key, template_by_name=template_by_name)
        records.append(
            {
                "key": template["key"] if template else source_column,
                "name": template["name"] if template else source_column,
                "dimension2Key": template["dimension2Key"] if template else "default",
                "direction": template["direction"] if template else infer_indicator_direction(source_column),
                "unit": template["unit"] if template else None,
                "sourceColumn": source_column,
                "sourceDatasetId": dataset_id,
                "isAutoGenerated": True,
            }
        )

    store.put_dataset_indicators(dataset_id, records)
    store.put_mapping(dataset_id, {indicator["key"]: indicator["sourceColumn"] for indicator in records})
    group_counts: dict[str, int] = {}
    templateMatchedCount = 0
    for indicator in records:
        group = indicator["dimension2Key"] or "default"
        group_counts[group] = group_counts.get(group, 0) + 1
        if indicator["key"] != indicator["sourceColumn"] or indicator["dimension2Key"] != "default":
            templateMatchedCount += 1
    log_event(
        "dataset_indicator_sync",
        datasetId=dataset_id,
        columnCount=len(source_columns),
        indicatorCount=len(records),
        templateMatchedCount=templateMatchedCount,
        groups=group_counts,
    )
    return records


def sync_all_dataset_indicators(store: Store) -> None:
    for dataset in store.list_datasets():
        sync_dataset_indicator_set(store, dataset["id"])


def resolve_indicators_for_datasets(
    *,
    store: Store,
    dataset_ids: list[str],
    indicator_keys: list[str],
) -> list[DatasetIndicatorRecord]:
    dataset_indicator_maps = {
        dataset_id: {indicator["key"]: indicator for indicator in store.list_dataset_indicators(dataset_id)}
        for dataset_id in dataset_ids
    }

    resolved: list[DatasetIndicatorRecord] = []
    for key in indicator_keys:
        missing = [dataset_id for dataset_id, indicators in dataset_indicator_maps.items() if key not in indicators]
        if missing:
            raise CsvError(f"数据集缺少指标 {key}: {missing}")
        resolved.append(dataset_indicator_maps[dataset_ids[0]][key])
    return resolved


def common_indicator_keys_for_datasets(*, store: Store, dataset_ids: list[str]) -> list[str]:
    if not dataset_ids:
        return []
    shared: set[str] | None = None
    for dataset_id in dataset_ids:
        keys = {indicator["key"] for indicator in store.list_dataset_indicators(dataset_id)}
        shared = keys if shared is None else shared & keys
    return sorted(shared or set())


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
        dataset_indicators = {indicator["key"]: indicator for indicator in store.list_dataset_indicators(dataset_id)}
        mapping = store.get_mapping(dataset_id)["map"]

        col_for_key: dict[str, str] = {}
        for k in indicator_keys:
            dataset_indicator = dataset_indicators.get(k)
            col = dataset_indicator["sourceColumn"] if dataset_indicator else mapping.get(k)
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
