from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict


Direction = Literal["positive", "negative"]
WeightMethod = Literal["entropy", "pca", "ahp"]
DatasetSourceType = Literal["file", "paste", "manual", "sample"]


class DatasetRecord(TypedDict):
    id: str
    name: str
    createdAt: str
    sourceType: DatasetSourceType
    isSample: bool
    csvPath: str
    schemaPath: str
    rowCount: int
    columns: list[str]


class IndicatorRecord(TypedDict):
    key: str
    name: str
    dimension2Key: str
    direction: Direction
    unit: str | None


class MappingRecord(TypedDict):
    datasetId: str
    map: dict[str, str]  # indicatorKey -> columnName


class MappingTemplateRecord(TypedDict):
    name: str
    createdAt: str
    map: dict[str, str]  # indicatorKey -> columnName


class StandardizationParamsMinMax(TypedDict):
    kind: Literal["minmax"]
    min: dict[str, float]
    max: dict[str, float]


class StandardizationParamsZScore(TypedDict):
    kind: Literal["zscore"]
    mean: dict[str, float]
    std: dict[str, float]


StandardizationParams = StandardizationParamsMinMax | StandardizationParamsZScore


class ScoreScalingParams(TypedDict):
    scoreMin: float
    scoreMax: float
    subScoreMin: dict[str, float]
    subScoreMax: dict[str, float]


class WeightModelRecord(TypedDict):
    id: str
    name: str
    createdAt: str
    method: WeightMethod
    indicatorKeys: list[str]
    weights: dict[str, float]
    dimension2Weights: dict[str, float]
    standardization: StandardizationParams
    scaling: ScoreScalingParams
    trainedOnDatasetIds: list[str]
    pca: dict[str, float | int] | None
    ahp: dict[str, object] | None


class ResultSetRecord(TypedDict):
    id: str
    name: str
    createdAt: str
    datasetIds: list[str]
    weightModelId: str
    csvPath: str
    rowCount: int
    columns: list[str]


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
