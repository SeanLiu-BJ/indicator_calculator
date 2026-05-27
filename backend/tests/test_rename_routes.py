from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.app import main
from backend.app.api_models import UpdateDatasetNameRequest, UpdateResultNameRequest
from backend.app.results import write_csv
from backend.app.storage import Store


class RenameRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_store = main.store
        self.store = Store(Path(self._tmpdir.name))
        self.store.load()
        main.store = self.store

    def tearDown(self) -> None:
        main.store = self._original_store
        self._tmpdir.cleanup()

    def test_dataset_name_can_be_updated(self) -> None:
        dataset_id = "dataset-rename-test"
        dataset_dir = self.store.paths.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        csv_path = dataset_dir / "data.csv"
        schema_path = dataset_dir / "schema.json"
        csv_path.write_text("entity,year,value\nAcme,2024,1\n", encoding="utf-8")
        schema_path.write_text(
            json.dumps(
                {
                    "required": ["entity", "year"],
                    "columns": ["entity", "year", "value"],
                    "types": {"entity": "string", "year": "int", "value": "number"},
                    "rowCount": 1,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        self.store.create_dataset(
            dataset_id=dataset_id,
            name="原始名称",
            source_type="manual",
            csv_path=csv_path,
            schema_path=schema_path,
            row_count=1,
            columns=["entity", "year", "value"],
            is_sample=False,
        )

        resp = main.update_dataset_name(dataset_id, UpdateDatasetNameRequest(name="新名称"))

        self.assertEqual(resp, {"ok": True})
        self.assertEqual(self.store.get_dataset(dataset_id)["name"], "新名称")

    def test_result_name_can_be_updated(self) -> None:
        result_id = "result-rename-test"
        result_dir = self.store.paths.results_dir / result_id
        result_dir.mkdir(parents=True, exist_ok=True)
        csv_path = result_dir / "result.csv"
        write_csv(csv_path, ["entity", "year", "index_0_100"], [{"entity": "Acme", "year": 2024, "index_0_100": 88.8}])

        self.store.create_result(
            {
                "id": result_id,
                "name": "原始结果名",
                "createdAt": "2026-01-01T00:00:00Z",
                "datasetIds": ["dataset-rename-test"],
                "weightModelId": "weight-model-test",
                "csvPath": str(csv_path),
                "rowCount": 1,
                "columns": ["entity", "year", "index_0_100"],
            }
        )

        resp = main.update_result_name(result_id, UpdateResultNameRequest(name="更新后的结果名"))

        self.assertEqual(resp, {"ok": True})
        self.assertEqual(self.store.get_result(result_id)["name"], "更新后的结果名")
        results = [item.model_dump() for item in main.list_results()]
        self.assertTrue(any(item["id"] == result_id and item["name"] == "更新后的结果名" for item in results))


if __name__ == "__main__":
    unittest.main()
