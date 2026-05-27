import React from "react";
import { api } from "../../api";
import { DatasetIndicator, DatasetSummary, WeightModel } from "../../types";
import { Alert, Button, Card, Form, Input, Select, Space, message } from "antd";
import { useNavigate } from "react-router-dom";

export function ComputePage() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [models, setModels] = React.useState<WeightModel[]>([]);
  const [datasetIndicatorsById, setDatasetIndicatorsById] = React.useState<Record<string, DatasetIndicator[]>>({});
  const [loading, setLoading] = React.useState(false);
  const [form] = Form.useForm();
  const selectedDatasetIds = Form.useWatch("datasetIds", form) || [];

  React.useEffect(() => {
    (async () => {
      const [d, m] = await Promise.all([api.get<DatasetSummary[]>("/datasets"), api.get<WeightModel[]>("/weight-models")]);
      const indicatorPairs = await Promise.all(
        d.map(async (dataset) => {
          const indicators = await api.get<DatasetIndicator[]>(`/datasets/${dataset.id}/indicators`);
          return [dataset.id, indicators] as const;
        }),
      );
      setDatasets(d);
      setModels(m);
      setDatasetIndicatorsById(Object.fromEntries(indicatorPairs));
    })();
  }, []);

  const sharedIndicatorKeys = React.useMemo(() => {
    if (!selectedDatasetIds.length) return [];
    let shared: Set<string> | null = null;
    for (const datasetId of selectedDatasetIds) {
      const keys = new Set((datasetIndicatorsById[datasetId] || []).map((indicator) => indicator.key));
      shared = shared ? new Set(Array.from(shared).filter((key) => keys.has(key))) : keys;
    }
    return Array.from(shared || []).sort();
  }, [datasetIndicatorsById, selectedDatasetIds]);

  const compatibleModels = React.useMemo(() => {
    if (!selectedDatasetIds.length) return models;
    const shared = new Set(sharedIndicatorKeys);
    return models.filter((model) => model.indicatorKeys.every((key) => shared.has(key)));
  }, [models, selectedDatasetIds, sharedIndicatorKeys]);

  const selectedDatasets = React.useMemo(
    () => datasets.filter((dataset) => selectedDatasetIds.includes(dataset.id)),
    [datasets, selectedDatasetIds],
  );

  const emptyReason = React.useMemo(() => {
    if (!selectedDatasetIds.length) return null;
    if (!sharedIndicatorKeys.length) {
      return "当前所选数据集没有共同可计算指标。请先回到数据集页检查 entity/year、数值列识别和指标分组。";
    }
    if (!compatibleModels.length) {
      return `当前数据集共同具备 ${sharedIndicatorKeys.length} 个指标，但还没有覆盖这批指标的权重模型。先去训练模型，再回来计算会更顺。`;
    }
    return null;
  }, [compatibleModels.length, selectedDatasetIds.length, sharedIndicatorKeys.length]);

  return (
    <Card title="计算指数">
      <Form layout="vertical" form={form}>
        <Form.Item name="name" label="结果名称（可选）">
          <Input placeholder="例如：结果 / 模型 X" />
        </Form.Item>
        <Form.Item name="weightModelId" label="选择权重模型" rules={[{ required: true }]}>
          <Select
            options={compatibleModels.map((m) => ({
              value: m.id,
              label: `${m.name}（${m.method === "entropy" ? "熵权法" : m.method === "pca" ? "PCA" : "AHP"}）`,
            }))}
          />
        </Form.Item>
        <Form.Item name="datasetIds" label="选择目标数据集" rules={[{ required: true }]}>
          <Select
            mode="multiple"
            options={datasets.map((d) => ({
              value: d.id,
              label: d.isSample ? `${d.name} (Sample)` : d.name,
            }))}
          />
        </Form.Item>
        {selectedDatasetIds.length ? (
          <Alert
            type={compatibleModels.length ? "info" : "warning"}
            showIcon
            message={
              compatibleModels.length
                ? `当前数据集共同具备 ${sharedIndicatorKeys.length} 个指标，可直接用于 ${compatibleModels.length} 个模型`
                : "当前所选数据集没有可直接复用的模型"
            }
            description={
              emptyReason ? (
                <Space direction="vertical" size={8}>
                  <span>{emptyReason}</span>
                  <Space wrap>
                    <Button size="small" onClick={() => navigate("/models")}>
                      去训练模型
                    </Button>
                    <Button size="small" onClick={() => navigate("/datasets")}>
                      回到数据集
                    </Button>
                    {selectedDatasets.length ? (
                      <span style={{ color: "rgba(0,0,0,0.45)" }}>
                        当前数据集：{selectedDatasets.map((dataset) => dataset.name).join(" / ")}
                      </span>
                    ) : null}
                  </Space>
                </Space>
              ) : undefined
            }
          />
        ) : null}
        <Space>
          <Button
            type="primary"
            loading={loading}
            disabled={selectedDatasetIds.length > 0 && !compatibleModels.length}
            onClick={async () => {
              const v = await form.validateFields();
              setLoading(true);
              try {
                const resp = await api.post<{ resultSetId: string }>("/compute", v);
                message.success("计算完成");
                navigate(`/results?open=${encodeURIComponent(resp.resultSetId)}`);
              } catch (e: any) {
                message.error(e?.message || String(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            计算
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
