import React from "react";
import { api } from "../../api";
import { DatasetIndicator, DatasetSummary, WeightModel } from "../../types";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";

type Method = "entropy" | "pca" | "ahp";

export function ModelsPage() {
  const [models, setModels] = React.useState<WeightModel[]>([]);
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [datasetIndicatorsById, setDatasetIndicatorsById] = React.useState<Record<string, DatasetIndicator[]>>({});
  const [open, setOpen] = React.useState(false);
  const [selectedModel, setSelectedModel] = React.useState<WeightModel | null>(null);
  const [method, setMethod] = React.useState<Method>("entropy");
  const [saving, setSaving] = React.useState(false);
  const [form] = Form.useForm();
  const selectedIndicatorKeys = Form.useWatch("indicatorKeys", form) || [];
  const selectedDatasetIds = Form.useWatch("datasetIds", form) || [];

  async function refresh() {
    const [m, d] = await Promise.all([
      api.get<WeightModel[]>("/weight-models"),
      api.get<DatasetSummary[]>("/datasets"),
    ]);
    const indicatorPairs = await Promise.all(
      d.map(async (dataset) => {
        const indicators = await api.get<DatasetIndicator[]>(`/datasets/${dataset.id}/indicators`);
        return [dataset.id, indicators] as const;
      }),
    );
    setModels(m);
    setDatasets(d);
    setDatasetIndicatorsById(Object.fromEntries(indicatorPairs));
  }

  React.useEffect(() => {
    refresh();
  }, []);

  const methodLabel = React.useCallback((m: Method) => {
    if (m === "entropy") return "熵权法";
    if (m === "pca") return "PCA";
    return "AHP";
  }, []);

  const indicatorMeta = React.useMemo(
    () =>
      new Map(
        Object.values(datasetIndicatorsById)
          .flat()
          .map((indicator) => [
          indicator.key,
          {
            name: indicator.name,
            dimension2Key: indicator.dimension2Key,
            direction: indicator.direction,
          },
        ]),
      ),
    [datasetIndicatorsById],
  );

  const datasetMeta = React.useMemo(
    () =>
      new Map(
        datasets.map((dataset) => [
          dataset.id,
          {
            name: dataset.name,
            isSample: dataset.isSample,
          },
        ]),
      ),
    [datasets],
  );

  const indicatorWeightRows = React.useMemo(() => {
    if (!selectedModel) return [];
    return selectedModel.indicatorKeys
      .map((key) => ({
        key,
        indicatorKey: key,
        indicatorName: indicatorMeta.get(key)?.name || key,
        dimension2Key: indicatorMeta.get(key)?.dimension2Key || "-",
        direction: indicatorMeta.get(key)?.direction || "-",
        weight: Number(selectedModel.weights[key] ?? 0),
      }))
      .sort((left, right) => right.weight - left.weight);
  }, [indicatorMeta, selectedModel]);

  const dimensionWeightRows = React.useMemo(() => {
    if (!selectedModel) return [];
    return Object.entries(selectedModel.dimension2Weights || {})
      .map(([dimension2Key, weight]) => ({
        key: dimension2Key,
        dimension2Key,
        weight: Number(weight ?? 0),
      }))
      .sort((left, right) => right.weight - left.weight);
  }, [selectedModel]);

  const selectedDatasetNames = React.useMemo(() => {
    if (!selectedModel) return [];
    return selectedModel.trainedOnDatasetIds.map((datasetId) => {
      const dataset = datasetMeta.get(datasetId);
      if (!dataset) return datasetId;
      return dataset.isSample ? `${dataset.name} (Sample)` : dataset.name;
    });
  }, [datasetMeta, selectedModel]);

  const availableIndicators = React.useMemo(() => {
    if (!selectedDatasetIds.length) return [];
    const perDataset = selectedDatasetIds.map((datasetId: string) => datasetIndicatorsById[datasetId] || []);
    const counts = new Map<string, number>();
    const sample = new Map<string, DatasetIndicator>();
    for (const indicators of perDataset) {
      const keys = new Set(indicators.map((indicator) => indicator.key));
      for (const indicator of indicators) sample.set(indicator.key, indicator);
      for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count === perDataset.length)
      .map(([key]) => sample.get(key)!)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [datasetIndicatorsById, selectedDatasetIds]);

  React.useEffect(() => {
    const nextKeys = selectedIndicatorKeys.filter((key: string) => availableIndicators.some((indicator) => indicator.key === key));
    if (method !== "ahp" && selectedDatasetIds.length > 0 && nextKeys.length === 0 && availableIndicators.length > 0) {
      form.setFieldsValue({ indicatorKeys: availableIndicators.map((indicator) => indicator.key) });
      return;
    }
    if (nextKeys.length !== selectedIndicatorKeys.length) {
      form.setFieldsValue({ indicatorKeys: nextKeys });
    }
  }, [availableIndicators, form, method, selectedDatasetIds, selectedIndicatorKeys]);

  const modelDetailTitle = selectedModel
    ? `${selectedModel.name} · ${methodLabel(selectedModel.method as Method)}`
    : "模型详情";

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card
        title="权重模型"
        extra={
          <Space>
            <Button onClick={() => refresh()}>刷新</Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              新建模型
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={[
            { title: "名称", dataIndex: "name", key: "name" },
            { title: "算法", dataIndex: "method", key: "method", width: 110, render: (v: Method) => methodLabel(v) },
            { title: "指标数", dataIndex: "indicatorKeys", key: "indicatorKeys", width: 110, render: (v: string[]) => v.length },
            { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
            {
              title: "操作",
              key: "action",
              width: 180,
              render: (_: unknown, model: WeightModel) => (
                <Space>
                  <Button size="small" onClick={() => setSelectedModel(model)}>
                    查看详情
                  </Button>
                  {!model.id.startsWith("sample_model_") ? (
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        Modal.confirm({
                          title: "删除权重模型？",
                          content: `将删除「${model.name}」，此操作不可恢复。`,
                          okText: "删除",
                          okButtonProps: { danger: true },
                          cancelText: "取消",
                          onOk: async () => {
                            try {
                              await api.del(`/weight-models/${model.id}`);
                              if (selectedModel?.id === model.id) setSelectedModel(null);
                              message.success("已删除权重模型");
                              await refresh();
                            } catch (e: any) {
                              message.error(e?.message || String(e));
                            }
                          },
                        });
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
          dataSource={models}
          pagination={{ pageSize: 8 }}
        />
      </Card>

      <Drawer
        width={860}
        open={!!selectedModel}
        title={modelDetailTitle}
        onClose={() => setSelectedModel(null)}
      >
        {selectedModel ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card size="small">
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="算法">
                  {methodLabel(selectedModel.method as Method)}
                </Descriptions.Item>
                <Descriptions.Item label="训练数据集数量">
                  {selectedModel.trainedOnDatasetIds.length}
                </Descriptions.Item>
                <Descriptions.Item label="指标数量">
                  {selectedModel.indicatorKeys.length}
                </Descriptions.Item>
                <Descriptions.Item label="标准化方式">
                  {selectedModel.standardization?.kind === "minmax" ? "min-max" : "z-score"}
                </Descriptions.Item>
              </Descriptions>
              <Space wrap style={{ marginTop: 12 }}>
                {selectedDatasetNames.map((datasetName) => (
                  <Tag key={datasetName}>{datasetName}</Tag>
                ))}
              </Space>
            </Card>

            {selectedModel.method === "pca" && selectedModel.pca ? (
              <Card size="small" title="PCA 方法信息">
                <Descriptions column={3} size="small" bordered>
                  <Descriptions.Item label="主成分个数">
                    {selectedModel.pca.k ?? "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="累计贡献率">
                    {selectedModel.pca.cumulative != null
                      ? `${(Number(selectedModel.pca.cumulative) * 100).toFixed(1)}%`
                      : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="阈值">
                    {selectedModel.pca.threshold != null
                      ? `${(Number(selectedModel.pca.threshold) * 100).toFixed(0)}%`
                      : "-"}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ) : null}

            {selectedModel.method === "ahp" && selectedModel.ahp ? (
              <Card size="small" title="AHP 方法信息">
                <Descriptions column={3} size="small" bordered>
                  <Descriptions.Item label="lambda max">
                    {selectedModel.ahp.lambdaMax != null
                      ? Number(selectedModel.ahp.lambdaMax).toFixed(3)
                      : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="CI">
                    {selectedModel.ahp.CI != null ? Number(selectedModel.ahp.CI).toFixed(3) : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="CR">
                    {selectedModel.ahp.CR != null ? Number(selectedModel.ahp.CR).toFixed(3) : "-"}
                  </Descriptions.Item>
                </Descriptions>
                <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                  一致性通常建议 CR &lt; 0.1。这里保留最小可行展示，不展开完整判断矩阵编辑。
                </Typography.Paragraph>
              </Card>
            ) : null}

            <Card size="small" title="指标权重">
              <Table
                rowKey="indicatorKey"
                size="small"
                pagination={false}
                dataSource={indicatorWeightRows}
                columns={[
                  { title: "指标", dataIndex: "indicatorName", key: "indicatorName" },
                  { title: "Key", dataIndex: "indicatorKey", key: "indicatorKey", width: 160 },
                  { title: "二级维度", dataIndex: "dimension2Key", key: "dimension2Key", width: 140 },
                  {
                    title: "方向",
                    dataIndex: "direction",
                    key: "direction",
                    width: 100,
                    render: (value: string) => (value === "negative" ? "负向" : "正向"),
                  },
                  {
                    title: "权重",
                    dataIndex: "weight",
                    key: "weight",
                    width: 120,
                    render: (value: number) => value.toFixed(4),
                  },
                ]}
              />
            </Card>

            <Card size="small" title="二级维度权重">
              <Table
                rowKey="dimension2Key"
                size="small"
                pagination={false}
                dataSource={dimensionWeightRows}
                columns={[
                  { title: "二级维度", dataIndex: "dimension2Key", key: "dimension2Key" },
                  {
                    title: "权重",
                    dataIndex: "weight",
                    key: "weight",
                    width: 140,
                    render: (value: number) => value.toFixed(4),
                  },
                ]}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        open={open}
        title="新建权重模型"
        onCancel={() => setOpen(false)}
        okText="创建"
        confirmLoading={saving}
        onOk={async () => {
          const v = await form.validateFields();
          setSaving(true);
          try {
            if (method === "ahp") {
              const matrix = buildAhpMatrix(v.indicatorKeys, v.ahpPairs || {});
              const resp = await api.post<WeightModel>("/weight-models/ahp", {
                name: v.name,
                indicatorKeys: v.indicatorKeys,
                standardizationDatasetIds: v.datasetIds,
                matrix,
              });
              if (resp.ahp?.CR != null && Number(resp.ahp.CR) >= 0.1) {
                message.warning(`AHP 一致性 CR=${Number(resp.ahp.CR).toFixed(3)}（建议 < 0.1）`);
              } else {
                message.success("已创建 AHP 模型");
              }
            } else {
              await api.post("/weight-models/train", {
                name: v.name,
                method,
                indicatorKeys: v.indicatorKeys,
                trainingDatasetIds: v.datasetIds,
                pcaCumVarThreshold: v.pcaCumVarThreshold ?? 0.85,
              });
              message.success("已创建模型");
            }
            setOpen(false);
            form.resetFields();
            await refresh();
          } catch (e: any) {
            message.error(e?.message || String(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Paragraph style={{ margin: 0 }}>
            熵权法默认 min-max；PCA/AHP 默认 z-score。AHP 需要录入两两比较矩阵（下方可按“重要性比值”填写）。
          </Typography.Paragraph>

          <Tabs
            activeKey={method}
            onChange={(k) => setMethod(k as Method)}
            items={[
              { key: "entropy", label: "熵权法" },
              { key: "pca", label: "PCA" },
              { key: "ahp", label: "AHP" },
            ]}
          />

          <Form layout="vertical" form={form} initialValues={{ pcaCumVarThreshold: 0.85 }}>
            <Form.Item name="name" label="模型名称" rules={[{ required: true }]}>
              <Input placeholder="例如：我的模型" />
            </Form.Item>

            <Form.Item name="datasetIds" label={method === "ahp" ? "标准化数据集（z-score 参数）" : "训练数据集"} rules={[{ required: true }]}>
              <Select
                mode="multiple"
                options={datasets.map((d) => ({
                  value: d.id,
                  label: d.isSample ? `${d.name} (Sample)` : d.name,
                }))}
              />
            </Form.Item>

            <Form.Item
              name="indicatorKeys"
              label="指标集合"
              rules={[{ required: true }]}
              extra={
                !selectedDatasetIds.length
                  ? "先选择数据集，系统会自动给出这批数据都具备的指标。"
                  : method === "ahp"
                    ? "AHP 需要你明确挑选要比较的指标。"
                    : `默认已选中这批数据共同具备的 ${availableIndicators.length} 个指标。`
              }
            >
              <Select
                mode="multiple"
                placeholder={selectedDatasetIds.length ? "选择要用于建模的指标" : "先选择训练数据集"}
                options={availableIndicators.map((indicator) => ({
                  value: indicator.key,
                  label: `${indicator.name}（${indicator.dimension2Key} / ${indicator.direction === "negative" ? "负向" : "正向"}）`,
                }))}
              />
            </Form.Item>

            {method === "pca" ? (
              <Form.Item name="pcaCumVarThreshold" label="累计贡献率阈值">
                <InputNumber min={0.5} max={0.99} step={0.01} style={{ width: "100%" }} />
              </Form.Item>
            ) : null}

            {method === "ahp" ? (
              <Form.Item
                name="ahpPairs"
                label="AHP 两两比较（可选，留空默认全 1）"
                tooltip="填写 a>b 的重要性比值（1~9），系统会自动补齐倒数。示例：production 对 sales = 1"
              >
                <AhpPairsEditor indicators={selectedIndicatorKeys} />
              </Form.Item>
            ) : null}
          </Form>
        </Space>
      </Modal>
    </Space>
  );
}

function AhpPairsEditor(props: {
  indicators: string[];
  value?: Record<string, number>;
  onChange?: (v: Record<string, number>) => void;
}) {
  const { indicators, value, onChange } = props;
  const pairs = value || {};

  React.useEffect(() => {
    onChange?.({});
  }, [indicators.join(","), onChange]);

  if (indicators.length < 2) {
    return <Typography.Text type="secondary">请选择至少 2 个指标</Typography.Text>;
  }

  const items: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < indicators.length; i++) {
    for (let j = i + 1; j < indicators.length; j++) items.push({ a: indicators[i], b: indicators[j] });
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {items.map((it) => {
        const key = `${it.a}__${it.b}`;
        return (
          <Space key={key} wrap>
            <Typography.Text style={{ width: 220 }}>{`${it.a} 对 ${it.b}`}</Typography.Text>
            <InputNumber
              min={1}
              max={9}
              step={1}
              value={pairs[key]}
              placeholder="1"
              onChange={(v) => onChange?.({ ...pairs, [key]: Number(v || 1) })}
            />
          </Space>
        );
      })}
    </Space>
  );
}

function buildAhpMatrix(indicatorKeys: string[], pairs: Record<string, number>): number[][] {
  const n = indicatorKeys.length;
  const m: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = indicatorKeys[i];
      const b = indicatorKeys[j];
      const key = `${a}__${b}`;
      const v = pairs[key] ?? 1;
      m[i][j] = v;
      m[j][i] = 1 / v;
    }
  }
  return m;
}
