from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api_models import (
    AhpWeightModelRequest,
    ComputeRequest,
    ComputeResponse,
    DatasetDetail,
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
    UpsertMappingTemplateRequest,
    UpdateDatasetNameRequest,
    WeightModel,
)
from .config import get_settings
from .csv_utils import CsvError, parse_csv_text, to_csv_text
from .datasets import build_matrix_for_datasets, normalize_imported_csv
from .engine import ComputeError, apply_weight_model, train_weight_model
from .results import read_csv_rows, write_csv
from .sample import seed_sample
from .storage import Store
from .types import IndicatorRecord, ResultSetRecord, WeightModelRecord, now_iso


settings = get_settings()
store = Store(settings.data_dir)
store.load()

if store.is_empty():
    try:
        seed_sample(store)
    except Exception as e:  # pragma: no cover
        # keep app usable even if sample init fails
        print(f"[seed_sample] failed: {e}")


def require_auth(request: Request) -> None:
    if not settings.token:
        return
    auth = request.headers.get("authorization", "")
    expected = f"Bearer {settings.token}"
    if auth != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


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
        raise HTTPException(404, "sample dataset not found")

    # deterministic ids if seeded, fallback to latest by method
    def pick_model(method: str) -> str:
        models = [m for m in store.list_weight_models() if m["method"] == method and sample_dataset_id in m.get("trainedOnDatasetIds", [])]
        if not models:
            raise HTTPException(404, f"sample weight model not found: {method}")
        return models[0]["id"]

    def pick_result(model_id: str) -> str:
        results = [r for r in store.list_results() if r["weightModelId"] == model_id and sample_dataset_id in r["datasetIds"]]
        if not results:
            raise HTTPException(404, f"sample result not found for model: {model_id}")
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


@api.put("/datasets/{dataset_id}/data")
def put_dataset_data(dataset_id: str, req: PutDatasetRowsRequest) -> dict[str, Any]:
    # validate by reusing csv normalization rules
    csv_text = to_csv_text(req.columns, [{k: str(v) for k, v in r.items()} for r in req.rows])
    normalized, schema = normalize_imported_csv(csv_text=csv_text, year_override=None)
    store.put_dataset_files(dataset_id, normalized, schema)
    return {"ok": True}


@api.put("/datasets/{dataset_id}/name")
def update_dataset_name(dataset_id: str, req: UpdateDatasetNameRequest) -> dict[str, Any]:
    store.update_dataset_name(dataset_id, req.name)
    return {"ok": True}


@api.post("/datasets/import", response_model=ImportResponse)
async def import_dataset(file: UploadFile = File(...), name: str | None = None, yearOverride: int | None = None) -> ImportResponse:
    raw = (await file.read()).decode("utf-8", errors="ignore")
    try:
        normalized, schema = normalize_imported_csv(csv_text=raw, year_override=yearOverride)
    except CsvError as e:
        raise HTTPException(400, str(e))

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
        name=name or file.filename or "Imported Dataset",
        source_type="file",
        csv_path=csv_path,
        schema_path=schema_path,
        row_count=len(parsed.rows),
        columns=parsed.columns,
        is_sample=False,
    )
    return ImportResponse(datasetId=dataset_id)


@api.post("/datasets/import-text", response_model=ImportResponse)
def import_dataset_text(req: ImportTextRequest) -> ImportResponse:
    try:
        normalized, schema = normalize_imported_csv(csv_text=req.csvText, year_override=req.yearOverride)
    except CsvError as e:
        raise HTTPException(400, str(e))

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
        name=req.name or "Pasted Dataset",
        source_type="paste",
        csv_path=csv_path,
        schema_path=schema_path,
        row_count=len(parsed.rows),
        columns=parsed.columns,
        is_sample=False,
    )
    return ImportResponse(datasetId=dataset_id)


@api.get("/indicators", response_model=list[Indicator])
def list_indicators() -> list[Indicator]:
    return [Indicator(**i) for i in store.list_indicators()]


@api.post("/indicators", response_model=Indicator)
def upsert_indicator(ind: Indicator) -> Indicator:
    store.upsert_indicator(ind.model_dump())
    return ind


@api.delete("/indicators/{key}")
def delete_indicator(key: str) -> dict[str, Any]:
    store.delete_indicator(key)
    return {"ok": True}


@api.get("/mappings/{dataset_id}", response_model=MappingResponse)
def get_mapping(dataset_id: str) -> MappingResponse:
    rec = store.get_mapping(dataset_id)
    return MappingResponse(**rec)


@api.put("/mappings/{dataset_id}", response_model=MappingResponse)
def put_mapping(dataset_id: str, req: PutMappingRequest) -> MappingResponse:
    rec = store.put_mapping(dataset_id, req.map)
    return MappingResponse(**rec)


@api.get("/mapping-templates", response_model=list[MappingTemplate])
def list_mapping_templates() -> list[MappingTemplate]:
    return [MappingTemplate(**t) for t in store.list_mapping_templates()]


@api.post("/mapping-templates", response_model=MappingTemplate)
def upsert_mapping_template(req: UpsertMappingTemplateRequest) -> MappingTemplate:
    rec = store.upsert_mapping_template(req.name, req.map)
    return MappingTemplate(**rec)


@api.delete("/mapping-templates/{name}")
def delete_mapping_template(name: str) -> dict[str, Any]:
    store.delete_mapping_template(name)
    return {"ok": True}


@api.get("/weight-models", response_model=list[WeightModel])
def list_weight_models() -> list[WeightModel]:
    return [WeightModel(**m) for m in store.list_weight_models()]


@api.post("/weight-models/train", response_model=WeightModel)
def train_model(req: TrainWeightModelRequest) -> WeightModel:
    indicators = store.list_indicators()
    indicators_by_key: dict[str, IndicatorRecord] = {i["key"]: i for i in indicators}
    keys = list(req.indicatorKeys)
    selected = [indicators_by_key[k] for k in keys if k in indicators_by_key]
    if len(selected) != len(keys):
        missing = [k for k in keys if k not in indicators_by_key]
        raise HTTPException(400, f"指标不存在: {missing}")

    try:
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
        raise HTTPException(400, str(e))

    store.create_weight_model(model)
    return WeightModel(**model)


@api.post("/weight-models/ahp", response_model=WeightModel)
def create_ahp_model(req: AhpWeightModelRequest) -> WeightModel:
    indicators = store.list_indicators()
    indicators_by_key: dict[str, IndicatorRecord] = {i["key"]: i for i in indicators}
    keys = list(req.indicatorKeys)
    selected = [indicators_by_key[k] for k in keys if k in indicators_by_key]
    if len(selected) != len(keys):
        missing = [k for k in keys if k not in indicators_by_key]
        raise HTTPException(400, f"指标不存在: {missing}")

    try:
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
        raise HTTPException(400, str(e))

    store.create_weight_model(model)
    return WeightModel(**model)


@api.post("/compute", response_model=ComputeResponse)
def compute(req: ComputeRequest) -> ComputeResponse:
    try:
        model = store.get_weight_model(req.weightModelId)
    except KeyError as e:
        raise HTTPException(404, str(e))

    indicators = store.list_indicators()
    indicators_by_key: dict[str, IndicatorRecord] = {i["key"]: i for i in indicators}
    keys = list(model["indicatorKeys"])
    selected = [indicators_by_key[k] for k in keys if k in indicators_by_key]
    if len(selected) != len(keys):
        raise HTTPException(400, "权重模型引用了不存在的指标")

    try:
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
        "name": req.name or f"Result / {model['name']}",
        "createdAt": now_iso(),
        "datasetIds": req.datasetIds,
        "weightModelId": model["id"],
        "csvPath": str(csv_path),
        "rowCount": len(rows),
        "columns": columns,
    }
    store.create_result(rec)
    return ComputeResponse(resultSetId=result_id)


@api.get("/results", response_model=list[ResultSummary])
def list_results() -> list[ResultSummary]:
    return [ResultSummary(**r) for r in store.list_results()]


@api.get("/results/{result_id}", response_model=ResultDetail)
def get_result(result_id: str) -> ResultDetail:
    rec = store.get_result(result_id)
    cols, rows = read_csv_rows(Path(rec["csvPath"]), limit=50)
    return ResultDetail(**rec, previewRows=rows)


@api.get("/results/{result_id}/rows")
def get_result_rows(result_id: str) -> dict[str, Any]:
    rec = store.get_result(result_id)
    cols, rows = read_csv_rows(Path(rec["csvPath"]), limit=None)
    return {"columns": cols, "rows": rows}


@api.get("/results/{result_id}/download")
def download_result(result_id: str) -> FileResponse:
    rec = store.get_result(result_id)
    return FileResponse(path=rec["csvPath"], filename=f"{rec['name']}.csv")


@api.get("/health")
def api_health() -> dict[str, Any]:
    return {"ok": True}


app = FastAPI()

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


dist_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")
else:
    @app.get("/")
    def no_frontend() -> dict[str, Any]:
        return {"ok": True, "message": "frontend not built; run `npm --prefix frontend run build`"}
