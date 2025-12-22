import React from "react";
import { api } from "../../api";
import { Indicator } from "../../types";
import { Button, Card, Form, Input, Modal, Select, Space, Table, message } from "antd";

export function IndicatorsPage() {
  const [data, setData] = React.useState<Indicator[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [form] = Form.useForm();

  async function refresh() {
    setLoading(true);
    try {
      const list = await api.get<Indicator[]>("/indicators");
      setData(list);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card
        title="指标库"
        extra={
          <Space>
            <Button onClick={() => refresh()}>刷新</Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              新增 / 更新
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="key"
          loading={loading}
          columns={[
            { title: "Key", dataIndex: "key", key: "key", width: 200 },
            { title: "Name", dataIndex: "name", key: "name", width: 220 },
            { title: "Dimension2", dataIndex: "dimension2Key", key: "dimension2Key", width: 200 },
            { title: "Direction", dataIndex: "direction", key: "direction", width: 120 },
            {
              title: "Action",
              key: "action",
              width: 120,
              render: (_: any, r: Indicator) => (
                <Button
                  danger
                  size="small"
                  onClick={async () => {
                    await api.del(`/indicators/${r.key}`);
                    message.success("已删除");
                    refresh();
                  }}
                >
                  删除
                </Button>
              ),
            },
          ]}
          dataSource={data}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        open={open}
        title="新增 / 更新指标"
        onCancel={() => setOpen(false)}
        okText="保存"
        onOk={async () => {
          const v = await form.validateFields();
          await api.post("/indicators", v);
          message.success("已保存");
          setOpen(false);
          form.resetFields();
          refresh();
        }}
      >
        <Form
          layout="vertical"
          form={form}
          initialValues={{ direction: "positive", dimension2Key: "default" }}
        >
          <Form.Item name="key" label="key（唯一）" rules={[{ required: true }]}>
            <Input placeholder="profit_margin" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="Profit Margin" />
          </Form.Item>
          <Form.Item name="dimension2Key" label="二级维度" rules={[{ required: true }]}>
            <Input placeholder="profitability" />
          </Form.Item>
          <Form.Item name="direction" label="方向" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "positive", label: "正向" },
                { value: "negative", label: "负向" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

