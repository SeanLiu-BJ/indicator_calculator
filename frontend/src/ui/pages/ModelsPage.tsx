import React from "react";
import { api } from "../../api";
import { DatasetSummary, Indicator, WeightModel } from "../../types";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography, message } from "antd";

type Method = "entropy" | "pca" | "ahp";

export function ModelsPage() {
  const [models, setModels] = React.useState<WeightModel[]>([]);
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [indicators, setIndicators] = React.useState<Indicator[]>([]);
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState<Method>("entropy");
  const [saving, setSaving] = React.useState(false);
  const [form] = Form.useForm();
  const selectedIndicatorKeys = Form.useWatch("indicatorKeys", form) || [];

  async function refresh() {
    const [m, d, i] = await Promise.all([
      api.get<WeightModel[]>("/weight-models"),
      api.get<DatasetSummary[]>("/datasets"),
      api.get<Indicator[]>("/indicators"),
    ]);
    setModels(m);
    setDatasets(d.filter((x) => !x.isSample));
    setIndicators(i);
  }

  React.useEffect(() => {
    refresh();
  }, []);

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
            { title: "Name", dataIndex: "name", key: "name" },
            { title: "Method", dataIndex: "method", key: "method", width: 100 },
            { title: "Indicators", dataIndex: "indicatorKeys", key: "indicatorKeys", width: 110, render: (v: string[]) => v.length },
            { title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180 },
          ]}
          dataSource={models}
          pagination={{ pageSize: 8 }}
        />
      </Card>

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
              <Input placeholder="My Model" />
            </Form.Item>

            <Form.Item name="indicatorKeys" label="指标集合" rules={[{ required: true }]}>
              <Select
                mode="multiple"
                options={indicators.map((i) => ({ value: i.key, label: `${i.key} (${i.dimension2Key})` }))}
              />
            </Form.Item>

            <Form.Item name="datasetIds" label={method === "ahp" ? "标准化数据集（z-score 参数）" : "训练数据集"} rules={[{ required: true }]}>
              <Select mode="multiple" options={datasets.map((d) => ({ value: d.id, label: d.name }))} />
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
                tooltip="填写 a>b 的重要性比值（1~9），系统会自动补齐倒数。示例：production vs sales = 1"
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
            <Typography.Text style={{ width: 220 }}>{`${it.a} vs ${it.b}`}</Typography.Text>
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
