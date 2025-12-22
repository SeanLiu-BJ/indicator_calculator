import React from "react";
import { api } from "../../api";
import { DatasetSummary, ResultSummary, WeightModel } from "../../types";
import { Button, Card, Form, Input, Select, Space, message } from "antd";
import { useNavigate } from "react-router-dom";

export function ComputePage() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [models, setModels] = React.useState<WeightModel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [form] = Form.useForm();

  React.useEffect(() => {
    (async () => {
      const [d, m] = await Promise.all([api.get<DatasetSummary[]>("/datasets"), api.get<WeightModel[]>("/weight-models")]);
      setDatasets(d.filter((x) => !x.isSample));
      setModels(m);
    })();
  }, []);

  return (
    <Card title="计算指数">
      <Form layout="vertical" form={form}>
        <Form.Item name="name" label="结果名称（可选）">
          <Input placeholder="Result / Model X" />
        </Form.Item>
        <Form.Item name="weightModelId" label="选择权重模型" rules={[{ required: true }]}>
          <Select options={models.map((m) => ({ value: m.id, label: `${m.name} (${m.method})` }))} />
        </Form.Item>
        <Form.Item name="datasetIds" label="选择目标数据集" rules={[{ required: true }]}>
          <Select mode="multiple" options={datasets.map((d) => ({ value: d.id, label: d.name }))} />
        </Form.Item>
        <Space>
          <Button
            type="primary"
            loading={loading}
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
