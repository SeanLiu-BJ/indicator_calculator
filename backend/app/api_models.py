from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .types import Direction, WeightMethod


class ErrorResponse(BaseModel):
    detail: str


class ImportTextRequest(BaseModel):
    name: str | None = None
    csvText: str
    yearOverride: int | None = None


class ImportResponse(BaseModel):
    datasetId: str


class DatasetSummary(BaseModel):
    id: str
    name: str
    createdAt: str
    sourceType: str
    isSample: bool
    rowCount: int
    columns: list[str]


class DatasetDetail(DatasetSummary):
    schema: dict[str, Any]
    previewRows: list[dict[str, Any]]


class UpdateDatasetNameRequest(BaseModel):
    name: str


class DatasetRowsResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]


class PutDatasetRowsRequest(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]


class Indicator(BaseModel):
    key: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$")
    name: str
    dimension2Key: str = Field(default="default")
    direction: Direction = Field(default="positive")
    unit: str | None = None


class PutMappingRequest(BaseModel):
    map: dict[str, str]


class MappingResponse(BaseModel):
    datasetId: str
    map: dict[str, str]


class UpsertMappingTemplateRequest(BaseModel):
    name: str
    map: dict[str, str]


class MappingTemplate(BaseModel):
    name: str
    createdAt: str
    map: dict[str, str]


class TrainWeightModelRequest(BaseModel):
    name: str
    method: Literal["entropy", "pca"]  # AHP uses separate endpoint
    indicatorKeys: list[str]
    trainingDatasetIds: list[str]
    pcaCumVarThreshold: float = 0.85


class AhpWeightModelRequest(BaseModel):
    name: str
    indicatorKeys: list[str]
    standardizationDatasetIds: list[str]
    matrix: list[list[float]]


class WeightModel(BaseModel):
    id: str
    name: str
    createdAt: str
    method: WeightMethod
    indicatorKeys: list[str]
    weights: dict[str, float]
    dimension2Weights: dict[str, float]
    standardization: dict[str, Any]
    scaling: dict[str, Any]
    trainedOnDatasetIds: list[str]
    pca: dict[str, Any] | None = None
    ahp: dict[str, Any] | None = None


class ComputeRequest(BaseModel):
    name: str | None = None
    weightModelId: str
    datasetIds: list[str]


class ComputeResponse(BaseModel):
    resultSetId: str


class ResultSummary(BaseModel):
    id: str
    name: str
    createdAt: str
    datasetIds: list[str]
    weightModelId: str
    rowCount: int
    columns: list[str]


class ResultDetail(ResultSummary):
    previewRows: list[dict[str, Any]]


class OnboardingResponse(BaseModel):
    sampleDatasetId: str
    weightModelIds: dict[str, str]
    resultSetIds: dict[str, str]
