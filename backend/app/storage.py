from __future__ import annotations

import json
import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .types import (
    DatasetRecord,
    DatasetSourceType,
    IndicatorRecord,
    MappingRecord,
    MappingTemplateRecord,
    ResultSetRecord,
    WeightModelRecord,
    now_iso,
)


@dataclass
class StorePaths:
    root: Path
    db_json: Path
    datasets_dir: Path
    models_dir: Path
    results_dir: Path


class Store:
    def __init__(self, root: Path):
        self.paths = StorePaths(
            root=root,
            db_json=root / "db.json",
            datasets_dir=root / "datasets",
            models_dir=root / "models",
            results_dir=root / "results",
        )
        self._lock = threading.Lock()
        self._db: dict[str, Any] = {}

    def ensure_dirs(self) -> None:
        self.paths.root.mkdir(parents=True, exist_ok=True)
        self.paths.datasets_dir.mkdir(parents=True, exist_ok=True)
        self.paths.models_dir.mkdir(parents=True, exist_ok=True)
        self.paths.results_dir.mkdir(parents=True, exist_ok=True)

    def load(self) -> None:
        self.ensure_dirs()
        if self.paths.db_json.exists():
            self._db = json.loads(self.paths.db_json.read_text(encoding="utf-8"))
            changed = False
            for k, default in {
                "datasets": {},
                "indicators": {},
                "mappings": {},
                "mappingTemplates": {},
                "weightModels": {},
                "results": {},
            }.items():
                if k not in self._db:
                    self._db[k] = default
                    changed = True
            if changed:
                self._save()
            return
        self._db = {
            "datasets": {},
            "indicators": {},
            "mappings": {},
            "mappingTemplates": {},
            "weightModels": {},
            "results": {},
        }
        self._save()

    def _save(self) -> None:
        self.paths.db_json.write_text(
            json.dumps(self._db, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._db))

    # ---- dataset ----
    def create_dataset(
        self,
        *,
        name: str,
        source_type: DatasetSourceType,
        csv_path: Path,
        schema_path: Path,
        row_count: int,
        columns: list[str],
        is_sample: bool = False,
        dataset_id: str | None = None,
    ) -> DatasetRecord:
        with self._lock:
            dataset_id = dataset_id or uuid.uuid4().hex
            rec: DatasetRecord = {
                "id": dataset_id,
                "name": name,
                "createdAt": now_iso(),
                "sourceType": source_type,
                "isSample": is_sample,
                "csvPath": str(csv_path),
                "schemaPath": str(schema_path),
                "rowCount": row_count,
                "columns": columns,
            }
            self._db["datasets"][dataset_id] = rec
            self._save()
            return rec

    def list_datasets(self) -> list[DatasetRecord]:
        with self._lock:
            values = list(self._db["datasets"].values())
        values.sort(key=lambda d: d["createdAt"], reverse=True)
        return values

    def get_dataset(self, dataset_id: str) -> DatasetRecord:
        with self._lock:
            rec = self._db["datasets"].get(dataset_id)
        if not rec:
            raise KeyError(f"dataset not found: {dataset_id}")
        return rec

    def update_dataset_name(self, dataset_id: str, name: str) -> None:
        with self._lock:
            if dataset_id not in self._db["datasets"]:
                raise KeyError(f"dataset not found: {dataset_id}")
            self._db["datasets"][dataset_id]["name"] = name
            self._save()

    def put_dataset_files(self, dataset_id: str, csv_text: str, schema: dict[str, Any]) -> None:
        dataset_dir = self.paths.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        csv_path = dataset_dir / "data.csv"
        schema_path = dataset_dir / "schema.json"
        csv_path.write_text(csv_text, encoding="utf-8")
        schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
        with self._lock:
            if dataset_id not in self._db["datasets"]:
                raise KeyError(f"dataset not found: {dataset_id}")
            self._db["datasets"][dataset_id]["csvPath"] = str(csv_path)
            self._db["datasets"][dataset_id]["schemaPath"] = str(schema_path)
            self._db["datasets"][dataset_id]["rowCount"] = int(schema.get("rowCount", 0))
            self._db["datasets"][dataset_id]["columns"] = list(schema.get("columns", []))
            self._save()

    # ---- indicators ----
    def list_indicators(self) -> list[IndicatorRecord]:
        with self._lock:
            values = list(self._db["indicators"].values())
        values.sort(key=lambda i: i["key"])
        return values

    def upsert_indicator(self, indicator: IndicatorRecord) -> None:
        with self._lock:
            self._db["indicators"][indicator["key"]] = indicator
            self._save()

    def delete_indicator(self, key: str) -> None:
        with self._lock:
            self._db["indicators"].pop(key, None)
            # also remove from mappings
            for m in self._db["mappings"].values():
                if key in m["map"]:
                    del m["map"][key]
            self._save()

    def get_indicator(self, key: str) -> IndicatorRecord:
        with self._lock:
            rec = self._db["indicators"].get(key)
        if not rec:
            raise KeyError(f"indicator not found: {key}")
        return rec

    # ---- mappings ----
    def get_mapping(self, dataset_id: str) -> MappingRecord:
        with self._lock:
            rec = self._db["mappings"].get(dataset_id)
        if not rec:
            return {"datasetId": dataset_id, "map": {}}
        return rec

    def put_mapping(self, dataset_id: str, mapping: dict[str, str]) -> MappingRecord:
        rec: MappingRecord = {"datasetId": dataset_id, "map": dict(mapping)}
        with self._lock:
            self._db["mappings"][dataset_id] = rec
            self._save()
        return rec

    # ---- mapping templates ----
    def list_mapping_templates(self) -> list[MappingTemplateRecord]:
        with self._lock:
            values = list(self._db["mappingTemplates"].values())
        values.sort(key=lambda t: t["createdAt"], reverse=True)
        return values

    def get_mapping_template(self, name: str) -> MappingTemplateRecord:
        with self._lock:
            rec = self._db["mappingTemplates"].get(name)
        if not rec:
            raise KeyError(f"mapping template not found: {name}")
        return rec

    def upsert_mapping_template(self, name: str, mapping: dict[str, str]) -> MappingTemplateRecord:
        with self._lock:
            existing = self._db["mappingTemplates"].get(name)
            created_at = existing["createdAt"] if existing else now_iso()
            rec: MappingTemplateRecord = {"name": name, "createdAt": created_at, "map": dict(mapping)}
            self._db["mappingTemplates"][name] = rec
            self._save()
        return rec

    def delete_mapping_template(self, name: str) -> None:
        with self._lock:
            self._db["mappingTemplates"].pop(name, None)
            self._save()

    # ---- weight models ----
    def create_weight_model(self, model: WeightModelRecord) -> WeightModelRecord:
        with self._lock:
            self._db["weightModels"][model["id"]] = model
            self._save()
        return model

    def list_weight_models(self) -> list[WeightModelRecord]:
        with self._lock:
            values = list(self._db["weightModels"].values())
        values.sort(key=lambda m: m["createdAt"], reverse=True)
        return values

    def get_weight_model(self, model_id: str) -> WeightModelRecord:
        with self._lock:
            rec = self._db["weightModels"].get(model_id)
        if not rec:
            raise KeyError(f"weight model not found: {model_id}")
        return rec

    # ---- results ----
    def create_result(self, result: ResultSetRecord) -> ResultSetRecord:
        with self._lock:
            self._db["results"][result["id"]] = result
            self._save()
        return result

    def list_results(self) -> list[ResultSetRecord]:
        with self._lock:
            values = list(self._db["results"].values())
        values.sort(key=lambda r: r["createdAt"], reverse=True)
        return values

    def get_result(self, result_id: str) -> ResultSetRecord:
        with self._lock:
            rec = self._db["results"].get(result_id)
        if not rec:
            raise KeyError(f"result not found: {result_id}")
        return rec

    # ---- sample init ----
    def is_empty(self) -> bool:
        with self._lock:
            datasets = self._db.get("datasets", {})
            indicators = self._db.get("indicators", {})
        return len(datasets) == 0 and len(indicators) == 0

    def copy_sample_dataset(self, *, sample_csv: Path, dataset_id: str, name: str) -> Path:
        dataset_dir = self.paths.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        csv_path = dataset_dir / "data.csv"
        shutil.copyfile(sample_csv, csv_path)
        return csv_path
