import React from "react";
import { api } from "../../api";
import { Indicator } from "../../types";
import { Button, Card, Form, Input, Modal, Select, Space, Table, Typography, message } from "antd";

export function IndicatorsPage() {
  const [data, setData] = React.useState<Indicator[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
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
        title="指标模板（高级）"
        extra={
          <Space>
            <Button onClick={() => refresh()}>刷新</Button>
            <Button onClick={() => setImportOpen(true)}>导入一级/二级表</Button>
            <Button
              type="primary"
              onClick={() => {
                setEditingKey(null);
                form.resetFields();
                form.setFieldsValue({ direction: "positive", dimension2Key: "default" });
                setOpen(true);
              }}
            >
              新增 / 更新
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">
          常规流程不需要先来这里建指标。导入数据集后，系统会按数据列自动生成可计算指标；如果这里的模板命中列名或名称，系统会自动补全方向、分组和单位。
        </Typography.Paragraph>
        <Table
          rowKey="key"
          loading={loading}
          columns={[
            { title: "指标 Key", dataIndex: "key", key: "key", width: 200 },
            { title: "名称", dataIndex: "name", key: "name", width: 220 },
            { title: "二级维度", dataIndex: "dimension2Key", key: "dimension2Key", width: 200 },
            {
              title: "方向",
              dataIndex: "direction",
              key: "direction",
              width: 120,
              render: (v: Indicator["direction"]) => (v === "positive" ? "正向" : "负向"),
            },
            {
              title: "操作",
              key: "action",
              width: 180,
              render: (_: any, r: Indicator) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingKey(r.key);
                      form.setFieldsValue(r);
                      setOpen(true);
                    }}
                  >
                    编辑
                  </Button>
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
                </Space>
              ),
            },
          ]}
          dataSource={data}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        open={importOpen}
        title="导入指标模板"
        onCancel={() => setImportOpen(false)}
        okText="导入"
        onOk={async () => {
          await api.post("/indicators/import-templates", { csvText: importText });
          message.success("已导入指标模板，并同步更新现有数据集指标");
          setImportOpen(false);
          setImportText("");
          refresh();
        }}
      >
        <Typography.Paragraph type="secondary">
          支持直接粘贴包含 `一级指标 / 二级指标` 的表。系统会自动前向填充空的一级指标，并把一级指标作为分组写入模板库。
        </Typography.Paragraph>
        <Input.TextArea
          rows={12}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={"一级指标,二级指标,方向\n提升通道能级和通关效率,农副产品查验效率,正向\n,单位GDP碳排放量,负向"}
        />
      </Modal>

      <Modal
        open={open}
        title={editingKey ? "编辑指标模板" : "新增指标模板"}
        onCancel={() => {
          setOpen(false);
          setEditingKey(null);
          form.resetFields();
        }}
        okText={editingKey ? "保存修改" : "保存"}
        onOk={async () => {
          const v = await form.validateFields();
          await api.post("/indicators", v);
          message.success(editingKey ? "已更新模板，并同步现有数据集指标" : "已保存模板，并同步现有数据集指标");
          setOpen(false);
          setEditingKey(null);
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
            <Input placeholder="profit_margin" disabled={!!editingKey} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="例如：利润率" />
          </Form.Item>
          <Form.Item name="dimension2Key" label="二级维度" rules={[{ required: true }]}>
            <Input placeholder="例如：盈利能力" />
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
