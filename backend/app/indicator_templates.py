from __future__ import annotations

import csv
import io

from .csv_utils import CsvError
from .types import Direction, IndicatorRecord


def _normalize_direction(value: str) -> Direction:
    text = (value or "").strip().lower()
    if text in {"positive", "正向", "pos", "正"}:
        return "positive"
    if text in {"negative", "负向", "neg", "负"}:
        return "negative"
    return "positive"


def parse_indicator_template_csv(csv_text: str) -> list[IndicatorRecord]:
    raw = (csv_text or "").strip()
    if not raw:
        raise CsvError("模板 CSV 为空")

    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        raise CsvError("模板 CSV 缺少表头")

    headers = {header.strip(): header for header in reader.fieldnames if header}
    group_header = headers.get("一级指标") or headers.get("一级维度") or headers.get("group")
    name_header = headers.get("二级指标") or headers.get("名称") or headers.get("name")
    key_header = headers.get("key") or headers.get("指标Key")
    direction_header = headers.get("方向") or headers.get("direction")
    unit_header = headers.get("单位") or headers.get("unit")

    if not name_header:
        raise CsvError("模板 CSV 必须包含“二级指标”或“名称”列")

    current_group = "default"
    templates: list[IndicatorRecord] = []
    for row in reader:
        group_value = (row.get(group_header, "") if group_header else "").strip()
        if group_value:
            current_group = group_value

        name = (row.get(name_header, "") or "").strip()
        if not name:
            continue
        key = ((row.get(key_header, "") if key_header else "") or "").strip() or name
        direction = _normalize_direction((row.get(direction_header, "") if direction_header else "") or "")
        unit = ((row.get(unit_header, "") if unit_header else "") or "").strip() or None
        templates.append(
            {
                "key": key,
                "name": name,
                "dimension2Key": current_group or "default",
                "direction": direction,
                "unit": unit,
            }
        )

    if not templates:
        raise CsvError("模板 CSV 没有可导入的指标")
    return templates
