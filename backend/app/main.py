from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api_models import (
    AhpWeightModelRequest,
    BulkImportIndicatorsRequest,
    ComputeRequest,
    ComputeResponse,
    DatasetDetail,
    DatasetIndicator,
    DatasetRowsResponse,
    DatasetSummary,
    ImportResponse,
    ImportTextRequest,
    Indicator,
    MappingResponse,
    MappingTemplate,
    OnboardingResponse,
    PutDatasetRowsRequest,
    PutMappingRequest,
    ResultDetail,
    ResultSummary,
    TrainWeightModelRequest,
    UpdateResultNameRequest,
    UpsertMappingTemplateRequest,
    UpdateDatasetNameRequest,
    WeightModel,
)
from .config import get_settings
from .csv_utils import CsvError, parse_csv_text, to_csv_text
from .datasets import (
    build_matrix_for_datasets,
    common_indicator_keys_for_datasets,
    normalize_imported_csv,
    prepare_imported_csv,
    resolve_indicators_for_datasets,
    sync_all_dataset_indicators,
    sync_dataset_indicator_set,
)
from .engine import ComputeError, apply_weight_model, train_weight_model
from .indicator_templates import parse_indicator_template_csv
from .observability import (
    log_error,
    log_event,
    request_logging_middleware,
    setup_logging,
    tail_log,
    unhandled_exception_handler,
)
from .results import read_csv_rows, write_csv
from .sample import seed_sample
from .storage import Store
from .types import IndicatorRecord, ResultSetRecord, WeightModelRecord, now_iso


settings = get_settings()
setup_logging(settings.log_dir)
store = Store(settings.data_dir)
store.load()

if store.is_empty():
    try:
        seed_sample(store)
    except Exception as e:  # pragma: no cover
        # keep app usable even if sample init fails
        print(f"[seed_sample] failed: {e}")

sync_all_dataset_indicators(store)


def require_auth(request: Request) -> None:
    if not settings.token:
        return
    auth = request.headers.get("authorization", "")
    expected = f"Bearer {settings.token}"
    if auth != expected:
        raise HTTPException(status_code=401, detail="未授权")


api = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


def _read_schema(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _dataset_preview_rows(dataset_id: str, limit: int = 50) -> list[dict[str, Any]]:
    ds = store.get_dataset(dataset_id)
    parsed = parse_csv_text(Path(ds["csvPath"]).read_text(encoding="utf-8"))
    return parsed.rows[:limit]


@api.get("/onboarding", response_model=OnboardingResponse)
def onboarding() -> OnboardingResponse:
    sample_dataset_id = None
    for ds in store.list_datasets():
        if ds.get("isSample"):
            sample_dataset_id = ds["id"]
            break
    if not sample_dataset_id:
        raise HTTPException(404, "未找到示例数据集")

    # deterministic ids if seeded, fallback to latest by method
    def pick_model(method: str) -> str:
        models = [m for m in store.list_weight_models() if m["method"] == method and sample_dataset_id in m.get("trainedOnDatasetIds", [])]
        if not models:
            raise HTTPException(404, f"未找到示例权重模型：{method}")
        return models[0]["id"]

    def pick_result(model_id: str) -> str:
        results = [r for r in store.list_results() if r["weightModelId"] == model_id and sample_dataset_id in r["datasetIds"]]
        if not results:
            raise HTTPException(404, f"未找到示例结果集（模型）：{model_id}")
        return results[0]["id"]

    entropy_model_id = pick_model("entropy")
    pca_model_id = pick_model("pca")
    ahp_model_id = pick_model("ahp")

    return OnboardingResponse(
        sampleDatasetId=sample_dataset_id,
        weightModelIds={"entropy": entropy_model_id, "pca": pca_model_id, "ahp": ahp_model_id},
        resultSetIds={
            "entropy": pick_result(entropy_model_id),
            "pca": pick_result(pca_model_id),
            "ahp": pick_result(ahp_model_id),
        },
    )


@api.get("/datasets", response_model=list[DatasetSummary])
def list_datasets() -> list[DatasetSummary]:
    return [DatasetSummary(**d) for d in store.list_datasets()]


@api.get("/datasets/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: str) -> DatasetDetail:
    ds = store.get_dataset(dataset_id)
    schema = _read_schema(ds["schemaPath"])
    preview_rows = _dataset_preview_rows(dataset_id, limit=50)
    return DatasetDetail(**ds, schema=schema, previewRows=preview_rows)


@api.get("/datasets/{dataset_id}/data", response_model=DatasetRowsResponse)
def get_dataset_data(dataset_id: str) -> DatasetRowsResponse:
    ds = store.get_dataset(dataset_id)
    parsed = parse_csv_text(Path(ds["csvPath"]).read_text(encoding="utf-8"))
    return DatasetRowsResponse(columns=parsed.columns, rows=parsed.rows)


@api.get("/datasets/{dataset_id}/indicators", response_model=list[DatasetIndicator])
def get_dataset_indicators(dataset_id: str) -> list[DatasetIndicator]:
    return [DatasetIndicator(**indicator) for indicator in store.list_dataset_indicators(dataset_id)]


@api.put("/datasets/{dataset_id}/indicators", response_model=list[DatasetIndicator])
def put_dataset_indicators(dataset_id: str, indicators: list[DatasetIndicator]) -> list[DatasetIndicator]:
    store.put_dataset_indicators(dataset_id, [indicator.model_dump() for indicator in indicators])
    store.put_mapping(dataset_id, {indicator.key: indicator.sourceColumn for indicator in indicators})
    log_event("dataset_indicators_updated", datasetId=dataset_id, indicatorCount=len(indicators))
    return [DatasetIndicator(**indicator) for indicator in store.list_dataset_indicators(dataset_id)]


@api.put("/datasets/{dataset_id}/data")
def put_dataset_data(dataset_id: str, req: PutDatasetRowsRequest) -> dict[str, Any]:
    # validate by reusing csv normalization rules
    csv_text = to_csv_text(req.columns, [{k: str(v) for k, v in r.items()} for r in req.rows])
    normalized, schema = normalize_imported_csv(csv_text=csv_text, year_override=None)
    store.put_dataset_files(dataset_id, normalized, schema)
    indicators = sync_dataset_indicator_set(store, dataset_id)
    log_event("dataset_data_updated", datasetId=dataset_id, rowCount=len(req.rows), indicatorCount=len(indicators))
    return {"ok": True}


@api.put("/datasets/{dataset_id}/name")
def update_dataset_name(dataset_id: str, req: UpdateDatasetNameRequest) -> dict[str, Any]:
    store.update_dataset_name(dataset_id, req.name)
    log_event("dataset_name_updated", datasetId=dataset_id, name=req.name)
    return {"ok": True}


@api.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str) -> dict[str, Any]:
    try:
        deleted = store.delete_dataset(dataset_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    log_event("dataset_deleted", datasetId=dataset_id, deleted=deleted)
    return {"ok": True, **deleted}


@api.post("/datasets/import", response_model=ImportResponse)
async def import_dataset(
    file: UploadFile = File(...),
    name: Optional[str] = None,
    yearOverride: Optional[int] = None,
) -> ImportResponse:
    raw = (await file.read()).decode("utf-8", errors="ignore")
    try:
        prepared = prepare_imported_csv(
            csv_text=raw,
            year_override=yearOverride,
            default_entity=(name or Path(file.filename or "").stem or "评价指标样本"),
        )
    except CsvError as e:
        raise HTTPException(400, str(e))
    normalized, schema = prepared.csv_text, prepared.schema
    for indicator in prepared.auto_templates:
        store.upsert_indicator(indicator)

    dataset_id = uuid.uuid4().hex
    dataset_dir = store.paths.datasets_dir / dataset_id
    csv_path = dataset_dir / "data.csv"
    schema_path = dataset_dir / "schema.json"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    csv_path.write_text(normalized, encoding="utf-8")
    schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")

    parsed = parse_csv_text(normalized)
    store.create_dataset(
        dataset_id=dataset_id,
        name=name or file.filename or "导入的数据集",
        source_type="file",
        csv_path=csv_path,
        schema_path=schema_path,
        row_count=len(parsed.rows),
        columns=parsed.columns,
        is_sample=False,
    )
    indicators = sync_dataset_indicator_set(store, dataset_id)
    log_event(
        "dataset_imported_file",
        datasetId=dataset_id,
        datasetName=name or file.filename or "导入的数据集",
        rowCount=len(parsed.rows),
        columnCount=len(parsed.columns),
        indicatorCount=len(indicators),
        detectedLayout=prepared.detected_layout,
        autoTemplateCount=len(prepared.auto_templates),
    )
    return ImportResponse(datasetId=dataset_id)


@api.post("/datasets/import-text", response_model=ImportResponse)
def import_dataset_text(req: ImportTextRequest) -> ImportResponse:
    try:
        prepared = prepare_imported_csv(
            csv_text=req.csvText,
            year_override=req.yearOverride,
            default_entity=(req.name or "评价指标样本"),
        )
    except CsvError as e:
        raise HTTPException(400, str(e))
    normalized, schema = prepared.csv_text, prepared.schema
    for indicator in prepared.auto_templates:
        store.upsert_indicator(indicator)

    dataset_id = uuid.uuid4().hex
    dataset_dir = store.paths.datasets_dir / dataset_id
    csv_path = dataset_dir / "data.csv"
    schema_path = dataset_dir / "schema.json"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    csv_path.write_text(normalized, encoding="utf-8")
    schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")

    parsed = parse_csv_text(normalized)
    store.create_dataset(
        dataset_id=dataset_id,
        name=req.name or "粘贴的数据集",
        source_type="paste",
        csv_path=csv_path,
        schema_path=schema_path,
        row_count=len(parsed.rows),
        columns=parsed.columns,
        is_sample=False,
    )
    indicators = sync_dataset_indicator_set(store, dataset_id)
    log_event(
        "dataset_imported_text",
        datasetId=dataset_id,
        datasetName=req.name or "粘贴的数据集",
        rowCount=len(parsed.rows),
        columnCount=len(parsed.columns),
        indicatorCount=len(indicators),
        detectedLayout=prepared.detected_layout,
        autoTemplateCount=len(prepared.auto_templates),
    )
    return ImportResponse(datasetId=dataset_id)


@api.get("/indicators", response_model=list[Indicator])
def list_indicators() -> list[Indicator]:
    return [Indicator(**i) for i in store.list_indicators()]


@api.post("/indicators", response_model=Indicator)
def upsert_indicator(ind: Indicator) -> Indicator:
    store.upsert_indicator(ind.model_dump())
    sync_all_dataset_indicators(store)
    log_event("indicator_template_upserted", key=ind.key, name=ind.name, group=ind.dimension2Key)
    return ind


@api.post("/indicators/import-templates", response_model=list[Indicator])
def bulk_import_indicators(req: BulkImportIndicatorsRequest) -> list[Indicator]:
    try:
        indicators = parse_indicator_template_csv(req.csvText)
    except CsvError as e:
        raise HTTPException(400, str(e))
    for indicator in indicators:
        store.upsert_indicator(indicator)
    sync_all_dataset_indicators(store)
    log_event("indicator_templates_imported", templateCount=len(indicators))
    return [Indicator(**indicator) for indicator in indicators]


@api.delete("/indicators/{key}")
def delete_indicator(key: str) -> dict[str, Any]:
    store.delete_indicator(key)
    sync_all_dataset_indicators(store)
    log_event("indicator_template_deleted", key=key)
    return {"ok": True}


@api.get("/mappings/{dataset_id}", response_model=MappingResponse)
def get_mapping(dataset_id: str) -> MappingResponse:
    rec = store.get_mapping(dataset_id)
    return MappingResponse(**rec)


@api.put("/mappings/{dataset_id}", response_model=MappingResponse)
def put_mapping(dataset_id: str, req: PutMappingRequest) -> MappingResponse:
    rec = store.put_mapping(dataset_id, req.map)
    log_event("dataset_mapping_updated", datasetId=dataset_id, mappingCount=len(req.map))
    return MappingResponse(**rec)


@api.get("/mapping-templates", response_model=list[MappingTemplate])
def list_mapping_templates() -> list[MappingTemplate]:
    return [MappingTemplate(**t) for t in store.list_mapping_templates()]


@api.post("/mapping-templates", response_model=MappingTemplate)
def upsert_mapping_template(req: UpsertMappingTemplateRequest) -> MappingTemplate:
    rec = store.upsert_mapping_template(req.name, req.map)
    log_event("mapping_template_upserted", name=req.name, mappingCount=len(req.map))
    return MappingTemplate(**rec)


@api.delete("/mapping-templates/{name}")
def delete_mapping_template(name: str) -> dict[str, Any]:
    store.delete_mapping_template(name)
    log_event("mapping_template_deleted", name=name)
    return {"ok": True}


@api.get("/weight-models", response_model=list[WeightModel])
def list_weight_models() -> list[WeightModel]:
    return [WeightModel(**m) for m in store.list_weight_models()]


@api.delete("/weight-models/{model_id}")
def delete_weight_model(model_id: str) -> dict[str, Any]:
    try:
        store.delete_weight_model(model_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    log_event("weight_model_deleted", modelId=model_id)
    return {"ok": True}


@api.post("/weight-models/train", response_model=WeightModel)
def train_model(req: TrainWeightModelRequest) -> WeightModel:
    keys = list(req.indicatorKeys) or common_indicator_keys_for_datasets(store=store, dataset_ids=req.trainingDatasetIds)
    if not keys:
        log_error("model_training_failed", method=req.method, trainingDatasetIds=req.trainingDatasetIds, indicatorKeys=[], error="所选数据集没有可共用的可计算指标")
        raise HTTPException(400, "所选数据集没有可共用的可计算指标")

    try:
        selected = resolve_indicators_for_datasets(store=store, dataset_ids=req.trainingDatasetIds, indicator_keys=keys)
        indicators_by_key: dict[str, IndicatorRecord] = {i["key"]: i for i in selected}
        _, _, x_train, directions = build_matrix_for_datasets(
            store=store,
            dataset_ids=req.trainingDatasetIds,
            indicator_keys=keys,
            indicators_by_key=indicators_by_key,
        )
        model: WeightModelRecord = train_weight_model(
            method=req.method,
            name=req.name,
            indicator_keys=keys,
            indicators=selected,
            x_train=x_train,
            directions=directions,
            trained_on_dataset_ids=req.trainingDatasetIds,
            pca_cum_var_threshold=req.pcaCumVarThreshold,
        )
    except (CsvError, ComputeError) as e:
        log_error(
            "model_training_failed",
            method=req.method,
            trainingDatasetIds=req.trainingDatasetIds,
            indicatorKeys=keys,
            error=str(e),
        )
        raise HTTPException(400, str(e))

    store.create_weight_model(model)
    log_event(
        "model_trained",
        modelId=model["id"],
        modelName=model["name"],
        method=model["method"],
        trainingDatasetIds=req.trainingDatasetIds,
        indicatorKeys=keys,
    )
    return WeightModel(**model)


@api.post("/weight-models/ahp", response_model=WeightModel)
def create_ahp_model(req: AhpWeightModelRequest) -> WeightModel:
    keys = list(req.indicatorKeys) or common_indicator_keys_for_datasets(store=store, dataset_ids=req.standardizationDatasetIds)
    if not keys:
        log_error("ahp_model_creation_failed", standardizationDatasetIds=req.standardizationDatasetIds, indicatorKeys=[], error="所选数据集没有可共用的可计算指标")
        raise HTTPException(400, "所选数据集没有可共用的可计算指标")
    if len(keys) < 2:
        log_error("ahp_model_creation_failed", standardizationDatasetIds=req.standardizationDatasetIds, indicatorKeys=keys, error="AHP 至少需要 2 个指标")
        raise HTTPException(400, "AHP 至少需要 2 个指标")

    try:
        selected = resolve_indicators_for_datasets(store=store, dataset_ids=req.standardizationDatasetIds, indicator_keys=keys)
        indicators_by_key: dict[str, IndicatorRecord] = {i["key"]: i for i in selected}
        _, _, x_train, directions = build_matrix_for_datasets(
            store=store,
            dataset_ids=req.standardizationDatasetIds,
            indicator_keys=keys,
            indicators_by_key=indicators_by_key,
        )
        model: WeightModelRecord = train_weight_model(
            method="ahp",
            name=req.name,
            indicator_keys=keys,
            indicators=selected,
            x_train=x_train,
            directions=directions,
            trained_on_dataset_ids=req.standardizationDatasetIds,
            ahp_matrix=req.matrix,
        )
    except (CsvError, ComputeError) as e:
        log_error(
            "ahp_model_creation_failed",
            standardizationDatasetIds=req.standardizationDatasetIds,
            indicatorKeys=keys,
            error=str(e),
        )
        raise HTTPException(400, str(e))

    store.create_weight_model(model)
    log_event(
        "ahp_model_created",
        modelId=model["id"],
        modelName=model["name"],
        standardizationDatasetIds=req.standardizationDatasetIds,
        indicatorKeys=keys,
    )
    return WeightModel(**model)


@api.post("/compute", response_model=ComputeResponse)
def compute(req: ComputeRequest) -> ComputeResponse:
    try:
        model = store.get_weight_model(req.weightModelId)
    except KeyError as e:
        log_error("compute_failed", resultName=req.name, datasetIds=req.datasetIds, weightModelId=req.weightModelId, error=str(e))
        raise HTTPException(404, str(e))

    keys = list(model["indicatorKeys"])

    try:
        selected = resolve_indicators_for_datasets(store=store, dataset_ids=req.datasetIds, indicator_keys=keys)
        indicators_by_key: dict[str, IndicatorRecord] = {i["key"]: i for i in selected}
        entities, years, x, directions = build_matrix_for_datasets(
            store=store,
            dataset_ids=req.datasetIds,
            indicator_keys=keys,
            indicators_by_key=indicators_by_key,
        )
        _, score_raw, sub_scores, sub_index = apply_weight_model(
            model=model,
            indicators=selected,
            x=x,
            directions=directions,
        )
    except (CsvError, ComputeError) as e:
        log_error(
            "compute_failed",
            resultName=req.name,
            datasetIds=req.datasetIds,
            weightModelId=req.weightModelId,
            indicatorKeys=keys,
            error=str(e),
        )
        raise HTTPException(400, str(e))

    from .engine import scale_0_100

    score_min = float(model["scaling"]["scoreMin"])
    score_max = float(model["scaling"]["scoreMax"])
    index_0_100 = scale_0_100(score_raw, score_min, score_max)

    dim_keys = sorted(sub_scores.keys())
    columns = ["entity", "year", "score_raw", "index_0_100"]
    for g in dim_keys:
        columns.append(f"sub_score_raw.{g}")
        columns.append(f"subindex.{g}_0_100")

    rows: list[dict[str, Any]] = []
    for i in range(x.shape[0]):
        r: dict[str, Any] = {
            "entity": entities[i],
            "year": years[i],
            "score_raw": float(score_raw[i]),
            "index_0_100": float(index_0_100[i]),
        }
        for g in dim_keys:
            r[f"sub_score_raw.{g}"] = float(sub_scores[g][i])
            r[f"subindex.{g}_0_100"] = float(sub_index[g][i])
        rows.append(r)

    result_id = uuid.uuid4().hex
    result_dir = store.paths.results_dir / result_id
    csv_path = result_dir / "result.csv"
    write_csv(csv_path, columns, rows)

    rec: ResultSetRecord = {
        "id": result_id,
        "name": req.name or f"结果 / {model['name']}",
        "createdAt": now_iso(),
        "datasetIds": req.datasetIds,
        "weightModelId": model["id"],
        "csvPath": str(csv_path),
        "rowCount": len(rows),
        "columns": columns,
    }
    store.create_result(rec)
    log_event(
        "result_computed",
        resultSetId=result_id,
        resultName=rec["name"],
        datasetIds=req.datasetIds,
        weightModelId=req.weightModelId,
        rowCount=len(rows),
        subIndexGroupCount=len(dim_keys),
    )
    return ComputeResponse(resultSetId=result_id)


@api.get("/results", response_model=list[ResultSummary])
def list_results() -> list[ResultSummary]:
    return [ResultSummary(**r) for r in store.list_results()]


@api.get("/results/{result_id}", response_model=ResultDetail)
def get_result(result_id: str) -> ResultDetail:
    rec = store.get_result(result_id)
    cols, rows = read_csv_rows(Path(rec["csvPath"]), limit=50)
    return ResultDetail(**rec, previewRows=rows)


@api.put("/results/{result_id}/name")
def update_result_name(result_id: str, req: UpdateResultNameRequest) -> dict[str, Any]:
    store.update_result_name(result_id, req.name)
    log_event("result_name_updated", resultId=result_id, name=req.name)
    return {"ok": True}


@api.delete("/results/{result_id}")
def delete_result(result_id: str) -> dict[str, Any]:
    try:
        store.delete_result(result_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    log_event("result_deleted", resultId=result_id)
    return {"ok": True}


@api.get("/results/{result_id}/rows")
def get_result_rows(result_id: str) -> dict[str, Any]:
    rec = store.get_result(result_id)
    cols, rows = read_csv_rows(Path(rec["csvPath"]), limit=None)
    return {"columns": cols, "rows": rows}


@api.get("/results/{result_id}/download")
def download_result(result_id: str) -> FileResponse:
    rec = store.get_result(result_id)
    return FileResponse(path=rec["csvPath"], filename=f"{rec['name']}.csv")


@api.get("/debug/logs")
def get_debug_logs(limit: int = 200) -> dict[str, Any]:
    return {
        "logDir": str(settings.log_dir),
        "requestLog": tail_log(settings.log_dir / "requests.log", limit=limit),
        "eventLog": tail_log(settings.log_dir / "events.log", limit=limit),
        "errorLog": tail_log(settings.log_dir / "errors.log", limit=limit),
    }


@api.get("/health")
def api_health() -> dict[str, Any]:
    return {"ok": True}


app = FastAPI()
app.middleware("http")(request_logging_middleware)
app.add_exception_handler(Exception, unhandled_exception_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True}


dist_dir_env = (os.environ.get("INDICATOR_FRONTEND_DIST") or "").strip()
dist_dir = Path(dist_dir_env) if dist_dir_env else Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")
else:
    @app.get("/")
    def no_frontend() -> dict[str, Any]:
        return {"ok": True, "message": "frontend not built; run `npm --prefix frontend run build`"}
