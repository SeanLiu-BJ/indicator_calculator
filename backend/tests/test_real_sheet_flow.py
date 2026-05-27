from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path

from backend.app.datasets import (
    build_matrix_for_datasets,
    common_indicator_keys_for_datasets,
    normalize_imported_csv,
    prepare_imported_csv,
    resolve_indicators_for_datasets,
    sync_dataset_indicator_set,
)
from backend.app.engine import apply_weight_model, scale_0_100, train_weight_model
from backend.app.indicator_templates import parse_indicator_template_csv
from backend.app.storage import Store


REAL_SHEET_CSV = """entity,year,农副产品查验效率,货运车辆日通行能力,进出口货运量,现代物流业总收入,报关单通过单一窗口受理比例,跨境人民币便利化结算,口岸进出口贸易额,边民互市贸易规模,重大产业项目落地数,新建成标准厂房面积,新增边民互市落地加工企业数,进出口贸易加工产业产值,“一件事”集成办理业务量,承诺办结时限压缩比例,企业制度性交易成本减免规模,实有业绩外贸企业数,卡口智能识别覆盖率,智慧口岸车道数量,通关时间平均压缩幅度,已建成并投入使用的口岸指定监管场地,安全生产检查开展次数,全县充电桩总数,城市污水处理率,单位GDP碳排放量
评价指标样本,2023,100,600,911.27,10.8,98,42,494.58,54.55,12,2.5,11,95,11719,83.12,5200,150,65,4,28,1,22,180,98.06,0.2244
评价指标样本,2024,100,600,1043.97,12.42,100,54.93,550.95,58.58,19,7.5,3,120,12350,84.2,5707.38,160,78,8,42,1,97,273,100,0.2043
评价指标样本,2025,150,2000,1121.39,16.5,100,68.5,667.39,65,36,6.5,6,150,12780,84.8,5900,168,90,12,52.86,2,100,310,100,0.196
"""

REAL_TEMPLATE_CSV = """一级指标,二级指标,方向
提升通道能级和通关效率,农副产品查验效率,正向
,货运车辆日通行能力,正向
,进出口货运量,正向
,现代物流业总收入,正向
推进智慧口岸建设和制度创新,报关单通过单一窗口受理比例,正向
,跨境人民币便利化结算,正向
,卡口智能识别覆盖率,正向
,智慧口岸车道数量,正向
做大对外贸易规模和开放平台功能,口岸进出口贸易额,正向
,边民互市贸易规模,正向
,实有业绩外贸企业数,正向
,“一件事”集成办理业务量,正向
壮大临港临铁产业和边民互市落地加工,重大产业项目落地数,正向
,新建成标准厂房面积,正向
,新增边民互市落地加工企业数,正向
,进出口贸易加工产业产值,正向
优化口岸营商环境和服务体系,承诺办结时限压缩比例,正向
,企业制度性交易成本减免规模,正向
,跨境人民币便利化结算,正向
,通关时间平均压缩幅度,正向
强化安全底线和绿色发展约束,已建成并投入使用的口岸指定监管场地,正向
,安全生产检查开展次数,正向
,全县充电桩总数,正向
,城市污水处理率,正向
,单位GDP碳排放量,负向
"""

EMBEDDED_TEMPLATE_ROWS = [
    {
        "key": "农副产品查验效率",
        "name": "农副产品查验效率",
        "dimension2Key": "提升通道能级和通关效率",
        "direction": "positive",
        "unit": None,
    },
    {
        "key": "单位GDP碳排放量",
        "name": "单位GDP碳排放量",
        "dimension2Key": "强化安全底线和绿色发展约束",
        "direction": "negative",
        "unit": None,
    },
]

EMBEDDED_WIDE_CSV = (
    "# indicator-templates-base64:"
    + base64.b64encode(json.dumps(EMBEDDED_TEMPLATE_ROWS, ensure_ascii=False).encode("utf-8")).decode("ascii")
    + "\n"
    + """entity,year,农副产品查验效率,单位GDP碳排放量
评价指标样本,2023,100,0.2244
评价指标样本,2024,100,0.2043
"""
)

RAW_SHEET_CSV = """一级指标,二级指标,2023,2024,2025,目标2026,目标2030
提升通道能级和通关效率,农副产品查验效率,100,100,150,155,170
,货运车辆日通行能力,600,600,2000,2100,2300
,进出口货运量,911.27,1043.97,1121.39,1200,1500
,现代物流业总收入,10.8,12.42,16.5,35,50
做大对外贸易规模和开放平台功能,报关单通过单一窗口受理比例,98,100,100,100,100
,跨境人民币便利化结算,42,54.93,68.5,80,120
,口岸进出口贸易额,494.58,550.95,667.39,734,1000
,边民互市贸易规模,54.55,58.58,65,70,90
壮大临港临铁产业和边民互市落地加工,重大产业项目落地数,12,19,36,40,70
,新建成标准厂房面积,2.5,7.5,6.5,3,15
,新增边民互市落地加工企业数,11,3,6,3,10
,进出口贸易加工产业产值,95,120,150,160,220
推进智慧口岸建设和制度创新,“一件事”集成办理业务量,11719,12350,12780,13000,14000
,承诺办结时限压缩比例,83.12,84.2,84.8,85.5,90
,企业制度性交易成本减免规模,5200,5707.38,5900,6200,7600
,实有业绩外贸企业数,150,160,168,180,220
优化口岸营商环境和服务体系,卡口智能识别覆盖率,65,78,90,95,100
,智慧口岸车道数量,4,8,12,13,20
,通关时间平均压缩幅度,28,42,52.86,56.56,70
,已建成并投入使用的口岸指定监管场地,1,1,2,2,3
强化安全底线和绿色发展约束,安全生产检查开展次数,22,97,100,100,100
,全县充电桩总数,180,273,310,370,520
,城市污水处理率,98.06,100,100,100,100
,单位GDP碳排放量,0.2244,0.2043,0.196,0.1785,0.12
"""


class RealSheetFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.store = Store(Path(self._tmpdir.name))
        self.store.load()
        for indicator in parse_indicator_template_csv(REAL_TEMPLATE_CSV):
            self.store.upsert_indicator(indicator)

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_real_sheet_import_training_and_compute_flow(self) -> None:
        normalized, schema = normalize_imported_csv(csv_text=REAL_SHEET_CSV, year_override=None)
        dataset_id = "real-sheet"
        dataset_dir = self.store.paths.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        csv_path = dataset_dir / "data.csv"
        schema_path = dataset_dir / "schema.json"
        csv_path.write_text(normalized, encoding="utf-8")
        schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
        self.store.create_dataset(
            dataset_id=dataset_id,
            name="真实表格测试",
            source_type="file",
            csv_path=csv_path,
            schema_path=schema_path,
            row_count=3,
            columns=schema["columns"],
            is_sample=False,
        )

        indicators = sync_dataset_indicator_set(self.store, dataset_id)
        self.assertEqual(len(indicators), 24)

        groups = {}
        for indicator in indicators:
            groups[indicator["dimension2Key"]] = groups.get(indicator["dimension2Key"], 0) + 1
        self.assertEqual(len(groups), 6)
        self.assertEqual(sum(groups.values()), 24)

        by_name = {indicator["name"]: indicator for indicator in indicators}
        self.assertEqual(by_name["单位GDP碳排放量"]["direction"], "negative")
        self.assertEqual(by_name["通关时间平均压缩幅度"]["dimension2Key"], "优化口岸营商环境和服务体系")

        keys = common_indicator_keys_for_datasets(store=self.store, dataset_ids=[dataset_id])
        self.assertEqual(len(keys), 24)

        resolved = resolve_indicators_for_datasets(store=self.store, dataset_ids=[dataset_id], indicator_keys=keys)
        indicators_by_key = {indicator["key"]: indicator for indicator in resolved}
        entities, years, matrix, directions = build_matrix_for_datasets(
            store=self.store,
            dataset_ids=[dataset_id],
            indicator_keys=keys,
            indicators_by_key=indicators_by_key,
        )
        self.assertEqual(sorted(set(years)), [2023, 2024, 2025])
        self.assertEqual(len(set(entities)), 1)

        model = train_weight_model(
            method="entropy",
            name="真实表格熵权测试",
            indicator_keys=keys,
            indicators=resolved,
            x_train=matrix,
            directions=directions,
            trained_on_dataset_ids=[dataset_id],
            pca_cum_var_threshold=0.85,
        )
        self.assertEqual(len(model["weights"]), 24)

        _, score_raw, _, sub_index = apply_weight_model(
            model=model,
            indicators=resolved,
            x=matrix,
            directions=directions,
        )
        index_0_100 = scale_0_100(score_raw, float(model["scaling"]["scoreMin"]), float(model["scaling"]["scoreMax"]))

        self.assertEqual(sorted(sub_index.keys()), sorted(groups.keys()))
        self.assertEqual(len(index_0_100), 3)
        self.assertAlmostEqual(float(index_0_100.min()), 0.0, places=6)
        self.assertAlmostEqual(float(index_0_100.max()), 100.0, places=6)

    def test_raw_hierarchical_sheet_can_expand_and_generate_templates(self) -> None:
        prepared = prepare_imported_csv(csv_text=RAW_SHEET_CSV, year_override=None, default_entity="评价指标样本")

        self.assertEqual(prepared.detected_layout, "hierarchical")
        self.assertEqual(len(prepared.auto_templates), 24)
        self.assertIn("entity,year,农副产品查验效率", prepared.csv_text.splitlines()[0])

        groups = {}
        for indicator in prepared.auto_templates:
            groups[indicator["dimension2Key"]] = groups.get(indicator["dimension2Key"], 0) + 1
        self.assertEqual(len(groups), 6)
        self.assertEqual(groups["提升通道能级和通关效率"], 4)
        self.assertEqual(groups["强化安全底线和绿色发展约束"], 4)

    def test_embedded_template_metadata_can_restore_grouping_for_wide_csv(self) -> None:
        prepared = prepare_imported_csv(csv_text=EMBEDDED_WIDE_CSV, year_override=None, default_entity="评价指标样本")

        self.assertEqual(prepared.detected_layout, "wide_embedded_templates")
        self.assertEqual(len(prepared.auto_templates), 2)
        by_name = {indicator["name"]: indicator for indicator in prepared.auto_templates}
        self.assertEqual(by_name["农副产品查验效率"]["dimension2Key"], "提升通道能级和通关效率")
        self.assertEqual(by_name["单位GDP碳排放量"]["direction"], "negative")


if __name__ == "__main__":
    unittest.main()
