from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from backend.app import main
from backend.app.results import write_csv
from backend.app.storage import Store


class DeleteRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_store = main.store
        self.store = Store(Path(self._tmpdir.name))
        self.store.load()
        main.store = self.store

    def tearDown(self) -> None:
        main.store = self._original_store
        self._tmpdir.cleanup()

    def _seed_dataset(self, dataset_id: str, *, is_sample: bool = False) -> None:
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
            name="示例" if is_sample else "用户数据",
            source_type="sample" if is_sample else "manual",
            csv_path=csv_path,
            schema_path=schema_path,
            row_count=1,
            columns=["entity", "year", "value"],
            is_sample=is_sample,
        )

    def _seed_model_and_result(self, dataset_id: str, model_id: str, result_id: str) -> None:
        self.store.create_weight_model(
            {
                "id": model_id,
                "name": "用户模型",
                "createdAt": "2026-01-01T00:00:00Z",
                "method": "entropy",
                "indicatorKeys": ["value"],
                "weights": {"value": 1.0},
                "dimension2Weights": {"default": 1.0},
                "standardization": {
                    "kind": "minmax",
                    "min": {"value": 0.0},
                    "max": {"value": 1.0},
                },
                "scaling": {
                    "scoreMin": 0.0,
                    "scoreMax": 1.0,
                    "subScoreMin": {"default": 0.0},
                    "subScoreMax": {"default": 1.0},
                },
                "trainedOnDatasetIds": [dataset_id],
                "pca": None,
                "ahp": None,
            }
        )

        result_dir = self.store.paths.results_dir / result_id
        result_dir.mkdir(parents=True, exist_ok=True)
        csv_path = result_dir / "result.csv"
        write_csv(csv_path, ["entity", "year", "index_0_100"], [{"entity": "Acme", "year": 2024, "index_0_100": 88.8}])
        self.store.create_result(
            {
                "id": result_id,
                "name": "用户结果",
                "createdAt": "2026-01-01T00:00:00Z",
                "datasetIds": [dataset_id],
                "weightModelId": model_id,
                "csvPath": str(csv_path),
                "rowCount": 1,
                "columns": ["entity", "year", "index_0_100"],
            }
        )

    def test_dataset_delete_cascades_to_models_and_results(self) -> None:
        dataset_id = "dataset-delete-test"
        model_id = "model-delete-test"
        result_id = "result-delete-test"
        self._seed_dataset(dataset_id)
        self._seed_model_and_result(dataset_id, model_id, result_id)

        resp = main.delete_dataset(dataset_id)

        self.assertEqual(resp["ok"], True)
        self.assertEqual(resp["deletedModelIds"], [model_id])
        self.assertEqual(resp["deletedResultIds"], [result_id])
        with self.assertRaises(KeyError):
            self.store.get_dataset(dataset_id)
        with self.assertRaises(KeyError):
            self.store.get_weight_model(model_id)
        with self.assertRaises(KeyError):
            self.store.get_result(result_id)
        self.assertFalse((self.store.paths.datasets_dir / dataset_id).exists())
        self.assertFalse((self.store.paths.results_dir / result_id).exists())

    def test_sample_objects_cannot_be_deleted(self) -> None:
        sample_dataset_id = "sample-dataset-test"
        self._seed_dataset(sample_dataset_id, is_sample=True)
        with self.assertRaises(HTTPException) as ctx:
            main.delete_dataset(sample_dataset_id)
        self.assertEqual(ctx.exception.status_code, 400)

        sample_model_id = "sample_model_test"
        self.store.create_weight_model(
            {
                "id": sample_model_id,
                "name": "示例模型",
                "createdAt": "2026-01-01T00:00:00Z",
                "method": "entropy",
                "indicatorKeys": ["value"],
                "weights": {"value": 1.0},
                "dimension2Weights": {"default": 1.0},
                "standardization": {
                    "kind": "minmax",
                    "min": {"value": 0.0},
                    "max": {"value": 1.0},
                },
                "scaling": {
                    "scoreMin": 0.0,
                    "scoreMax": 1.0,
                    "subScoreMin": {"default": 0.0},
                    "subScoreMax": {"default": 1.0},
                },
                "trainedOnDatasetIds": [sample_dataset_id],
                "pca": None,
                "ahp": None,
            }
        )
        with self.assertRaises(HTTPException) as ctx2:
            main.delete_weight_model(sample_model_id)
        self.assertEqual(ctx2.exception.status_code, 400)

        sample_result_id = "sample_result_test"
        result_dir = self.store.paths.results_dir / sample_result_id
        result_dir.mkdir(parents=True, exist_ok=True)
        csv_path = result_dir / "result.csv"
        write_csv(csv_path, ["entity", "year", "index_0_100"], [{"entity": "Acme", "year": 2024, "index_0_100": 88.8}])
        self.store.create_result(
            {
                "id": sample_result_id,
                "name": "示例结果",
                "createdAt": "2026-01-01T00:00:00Z",
                "datasetIds": [sample_dataset_id],
                "weightModelId": sample_model_id,
                "csvPath": str(csv_path),
                "rowCount": 1,
                "columns": ["entity", "year", "index_0_100"],
            }
        )
        with self.assertRaises(HTTPException) as ctx3:
            main.delete_result(sample_result_id)
        self.assertEqual(ctx3.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
