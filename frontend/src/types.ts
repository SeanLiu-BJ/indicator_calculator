export type DatasetSummary = {
  id: string;
  name: string;
  createdAt: string;
  sourceType: string;
  isSample: boolean;
  rowCount: number;
  columns: string[];
};

export type DatasetDetail = DatasetSummary & {
  schema: any;
  previewRows: Record<string, any>[];
};

export type Indicator = {
  key: string;
  name: string;
  dimension2Key: string;
  direction: "positive" | "negative";
  unit?: string | null;
};

export type Mapping = {
  datasetId: string;
  map: Record<string, string>;
};

export type MappingTemplate = {
  name: string;
  createdAt: string;
  map: Record<string, string>;
};

export type WeightModel = {
  id: string;
  name: string;
  createdAt: string;
  method: "entropy" | "pca" | "ahp";
  indicatorKeys: string[];
  weights: Record<string, number>;
  dimension2Weights: Record<string, number>;
  standardization: any;
  scaling: any;
  trainedOnDatasetIds: string[];
  pca?: any | null;
  ahp?: any | null;
};

export type ResultSummary = {
  id: string;
  name: string;
  createdAt: string;
  datasetIds: string[];
  weightModelId: string;
  rowCount: number;
  columns: string[];
};

export type ResultDetail = ResultSummary & {
  previewRows: Record<string, any>[];
};

export type Onboarding = {
  sampleDatasetId: string;
  weightModelIds: Record<string, string>;
  resultSetIds: Record<string, string>;
};
