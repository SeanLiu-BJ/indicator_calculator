from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.app import main
from backend.app.api_models import TrainWeightModelRequest
from backend.app.datasets import sync_dataset_indicator_set
from backend.app.indicator_templates import parse_indicator_template_csv
from backend.app.storage import Store


class DatasetIndicatorDiscoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_store = main.store
        self.store = Store(Path(self._tmpdir.name))
        self.store.load()
        main.store = self.store

    def tearDown(self) -> None:
        main.store = self._original_store
        self._tmpdir.cleanup()

    def _create_dataset(self, dataset_id: str, csv_text: str) -> None:
        dataset_dir = self.store.paths.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        csv_path = dataset_dir / "data.csv"
        schema_path = dataset_dir / "schema.json"
        csv_path.write_text(csv_text, encoding="utf-8")
        schema_path.write_text(
            json.dumps(
                {
                    "required": ["entity", "year"],
                    "columns": csv_text.splitlines()[0].split(","),
                    "types": {},
                    "rowCount": len(csv_text.splitlines()) - 1,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.store.create_dataset(
            dataset_id=dataset_id,
            name="测试数据集",
            source_type="manual",
            csv_path=csv_path,
            schema_path=schema_path,
            row_count=len(csv_text.splitlines()) - 1,
            columns=csv_text.splitlines()[0].split(","),
            is_sample=False,
        )

    def test_sync_creates_dataset_indicators_from_columns(self) -> None:
        self._create_dataset(
            "dataset-auto",
            "entity,year,营收,单位GDP碳排放量\nA,2024,100,0.4\nB,2024,80,0.6\n",
        )

        indicators = sync_dataset_indicator_set(self.store, "dataset-auto")

        self.assertEqual(sorted(item["key"] for item in indicators), ["单位GDP碳排放量", "营收"])
        by_key = {item["key"]: item for item in indicators}
        self.assertEqual(by_key["营收"]["direction"], "positive")
        self.assertEqual(by_key["单位GDP碳排放量"]["direction"], "positive")
        self.assertEqual(self.store.get_mapping("dataset-auto")["map"]["营收"], "营收")

    def test_training_works_without_global_indicator_library(self) -> None:
        self._create_dataset(
            "dataset-train",
            "entity,year,营收,利润率\nA,2023,10,0.1\nA,2024,12,0.12\nB,2023,8,0.08\nB,2024,11,0.11\n",
        )
        sync_dataset_indicator_set(self.store, "dataset-train")

        model = main.train_model(
            TrainWeightModelRequest(
                name="自动识别模型",
                method="entropy",
                indicatorKeys=["营收", "利润率"],
                trainingDatasetIds=["dataset-train"],
                pcaCumVarThreshold=0.85,
            )
        )

        self.assertEqual(model.indicatorKeys, ["营收", "利润率"])
        self.assertAlmostEqual(sum(model.weights.values()), 1.0, places=6)

    def test_training_defaults_to_all_shared_dataset_indicators(self) -> None:
        self._create_dataset(
            "dataset-auto-keys",
            "entity,year,营收,利润率\nA,2023,10,0.1\nA,2024,12,0.12\nB,2023,8,0.08\nB,2024,11,0.11\n",
        )
        sync_dataset_indicator_set(self.store, "dataset-auto-keys")

        model = main.train_model(
            TrainWeightModelRequest(
                name="自动全选模型",
                method="entropy",
                indicatorKeys=[],
                trainingDatasetIds=["dataset-auto-keys"],
                pcaCumVarThreshold=0.85,
            )
        )

        self.assertEqual(sorted(model.indicatorKeys), ["利润率", "营收"])

    def test_template_library_enriches_dataset_indicator_metadata(self) -> None:
        self.store.upsert_indicator(
            {
                "key": "carbon_emission_per_gdp",
                "name": "单位GDP碳排放量",
                "dimension2Key": "绿色发展",
                "direction": "negative",
                "unit": "吨/万元",
            }
        )
        self._create_dataset(
            "dataset-template",
            "entity,year,单位GDP碳排放量,营收\nA,2024,0.4,100\nB,2024,0.6,80\n",
        )

        indicators = sync_dataset_indicator_set(self.store, "dataset-template")
        by_source = {item["sourceColumn"]: item for item in indicators}

        self.assertEqual(by_source["单位GDP碳排放量"]["key"], "carbon_emission_per_gdp")
        self.assertEqual(by_source["单位GDP碳排放量"]["name"], "单位GDP碳排放量")
        self.assertEqual(by_source["单位GDP碳排放量"]["dimension2Key"], "绿色发展")
        self.assertEqual(by_source["单位GDP碳排放量"]["direction"], "negative")
        self.assertEqual(by_source["营收"]["key"], "营收")

    def test_sync_backfills_existing_auto_generated_indicators_from_templates(self) -> None:
        self.store.upsert_indicator(
            {
                "key": "carbon_emission_per_gdp",
                "name": "单位GDP碳排放量",
                "dimension2Key": "绿色发展",
                "direction": "negative",
                "unit": "吨/万元",
            }
        )
        self._create_dataset(
            "dataset-backfill",
            "entity,year,单位GDP碳排放量\nA,2024,0.4\nB,2024,0.6\n",
        )
        self.store.put_dataset_indicators(
            "dataset-backfill",
            [
                {
                    "key": "单位GDP碳排放量",
                    "name": "单位GDP碳排放量",
                    "dimension2Key": "default",
                    "direction": "positive",
                    "unit": None,
                    "sourceColumn": "单位GDP碳排放量",
                    "sourceDatasetId": "dataset-backfill",
                    "isAutoGenerated": True,
                }
            ],
        )

        indicators = sync_dataset_indicator_set(self.store, "dataset-backfill")
        indicator = indicators[0]

        self.assertEqual(indicator["key"], "carbon_emission_per_gdp")
        self.assertEqual(indicator["dimension2Key"], "绿色发展")
        self.assertEqual(indicator["direction"], "negative")

    def test_indicator_template_parser_uses_level1_as_group(self) -> None:
        indicators = parse_indicator_template_csv(
            "一级指标,二级指标,方向\n提升通道能级和通关效率,农副产品查验效率,正向\n,单位GDP碳排放量,负向\n"
        )

        self.assertEqual(indicators[0]["dimension2Key"], "提升通道能级和通关效率")
        self.assertEqual(indicators[1]["dimension2Key"], "提升通道能级和通关效率")
        self.assertEqual(indicators[1]["direction"], "negative")


if __name__ == "__main__":
    unittest.main()
