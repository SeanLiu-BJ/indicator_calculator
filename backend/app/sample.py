from __future__ import annotations

import json
from pathlib import Path

from .datasets import normalize_imported_csv
from .engine import train_weight_model
from .results import write_csv
from .storage import Store
from .types import IndicatorRecord, ResultSetRecord, WeightModelRecord, now_iso


def seed_sample(store: Store) -> dict[str, str]:
    """
    Initializes:
    - one sample dataset
    - indicator library
    - mapping for sample dataset
    - 3 weight models (entropy/pca/ahp)
    - 3 result sets (computed on sample dataset)

    Returns a dict of important IDs for onboarding.
    """
    sample_dir = Path(__file__).resolve().parents[1] / "sample"
    sample_csv = sample_dir / "sample_dataset.csv"
    indicators_json = sample_dir / "sample_indicators.json"

    dataset_id = "sample_dataset"
    entropy_model_id = "sample_model_entropy"
    pca_model_id = "sample_model_pca"
    ahp_model_id = "sample_model_ahp"
    entropy_result_id = "sample_result_entropy"
    pca_result_id = "sample_result_pca"
    ahp_result_id = "sample_result_ahp"

    # dataset
    dataset_dir = store.paths.datasets_dir / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)
    csv_path = dataset_dir / "data.csv"
    schema_path = dataset_dir / "schema.json"

    normalized_csv, schema = normalize_imported_csv(
        csv_text=sample_csv.read_text(encoding="utf-8"), year_override=None
    )
    csv_path.write_text(normalized_csv, encoding="utf-8")
    schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")

    store.create_dataset(
        dataset_id=dataset_id,
        name="Sample Data",
        source_type="sample",
        csv_path=csv_path,
        schema_path=schema_path,
        row_count=int(schema["rowCount"]),
        columns=list(schema["columns"]),
        is_sample=True,
    )

    # indicators
    indicators: list[IndicatorRecord] = json.loads(indicators_json.read_text(encoding="utf-8"))
    for ind in indicators:
        store.upsert_indicator(ind)

    indicator_keys = [i["key"] for i in indicators]
    store.put_mapping(dataset_id, {k: k for k in indicator_keys})

    # train models
    from .datasets import build_matrix_for_datasets

    indicators_by_key = {i["key"]: i for i in indicators}
    entities, years, x_train, directions = build_matrix_for_datasets(
        store=store,
        dataset_ids=[dataset_id],
        indicator_keys=indicator_keys,
        indicators_by_key=indicators_by_key,
    )
    _ = entities, years

    # AHP matrix (simple example, scale > profitability > solvency > innovation)
    # order: production, sales, profit_margin, debt_ratio, rd_ratio
    ahp_matrix = [
        [1, 1, 3, 5, 3],
        [1, 1, 3, 5, 3],
        [1 / 3, 1 / 3, 1, 3, 2],
        [1 / 5, 1 / 5, 1 / 3, 1, 1 / 2],
        [1 / 3, 1 / 3, 1 / 2, 2, 1],
    ]

    entropy_model: WeightModelRecord = train_weight_model(
        method="entropy",
        name="Sample / Entropy",
        indicator_keys=indicator_keys,
        indicators=indicators,
        x_train=x_train,
        directions=directions,
        trained_on_dataset_ids=[dataset_id],
    )
    entropy_model["id"] = entropy_model_id
    store.create_weight_model(entropy_model)

    pca_model: WeightModelRecord = train_weight_model(
        method="pca",
        name="Sample / PCA",
        indicator_keys=indicator_keys,
        indicators=indicators,
        x_train=x_train,
        directions=directions,
        trained_on_dataset_ids=[dataset_id],
        pca_cum_var_threshold=0.85,
    )
    pca_model["id"] = pca_model_id
    store.create_weight_model(pca_model)

    ahp_model: WeightModelRecord = train_weight_model(
        method="ahp",
        name="Sample / AHP",
        indicator_keys=indicator_keys,
        indicators=indicators,
        x_train=x_train,
        directions=directions,
        trained_on_dataset_ids=[dataset_id],
        ahp_matrix=ahp_matrix,
    )
    ahp_model["id"] = ahp_model_id
    store.create_weight_model(ahp_model)

    # compute results
    from .engine import apply_weight_model

    def compute_result(model: WeightModelRecord, result_id: str, name: str) -> None:
        _, score_raw, sub_scores, sub_index = apply_weight_model(
            model=model,
            indicators=indicators,
            x=x_train,
            directions=directions,
        )

        from .engine import scale_0_100

        score_min = float(model["scaling"]["scoreMin"])
        score_max = float(model["scaling"]["scoreMax"])
        idx0 = scale_0_100(score_raw, score_min, score_max)

        columns = ["entity", "year", "score_raw", "index_0_100"]
        dim_keys = sorted(sub_scores.keys())
        for g in dim_keys:
            columns.append(f"sub_score_raw.{g}")
            columns.append(f"subindex.{g}_0_100")

        rows = []
        for i in range(x_train.shape[0]):
            r = {
                "entity": entities[i],
                "year": years[i],
                "score_raw": float(score_raw[i]),
                "index_0_100": float(idx0[i]),
            }
            for g in dim_keys:
                r[f"sub_score_raw.{g}"] = float(sub_scores[g][i])
                r[f"subindex.{g}_0_100"] = float(sub_index[g][i])
            rows.append(r)

        result_dir = store.paths.results_dir / result_id
        csv_path = result_dir / "result.csv"
        write_csv(csv_path, columns, rows)
        rec: ResultSetRecord = {
            "id": result_id,
            "name": name,
            "createdAt": now_iso(),
            "datasetIds": [dataset_id],
            "weightModelId": model["id"],
            "csvPath": str(csv_path),
            "rowCount": len(rows),
            "columns": columns,
        }
        store.create_result(rec)

    compute_result(entropy_model, entropy_result_id, "Sample Result / Entropy")
    compute_result(pca_model, pca_result_id, "Sample Result / PCA")
    compute_result(ahp_model, ahp_result_id, "Sample Result / AHP")

    return {
        "sampleDatasetId": dataset_id,
        "entropyModelId": entropy_model_id,
        "pcaModelId": pca_model_id,
        "ahpModelId": ahp_model_id,
        "entropyResultId": entropy_result_id,
        "pcaResultId": pca_result_id,
        "ahpResultId": ahp_result_id,
    }
