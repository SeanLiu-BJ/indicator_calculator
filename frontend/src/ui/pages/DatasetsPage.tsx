import React from "react";
import { api, uploadDataset } from "../../api";
import { DatasetDetail, DatasetSummary, Indicator, Mapping, MappingTemplate } from "../../types";
import { Button, Card, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography, message } from "antd";

export function DatasetsPage() {
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<DatasetDetail | null>(null);
  const [indicators, setIndicators] = React.useState<Indicator[]>([]);
  const [mapping, setMapping] = React.useState<Mapping | null>(null);
  const [templates, setTemplates] = React.useState<MappingTemplate[]>([]);
  const [importOpen, setImportOpen] = React.useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [list, inds, tmps] = await Promise.all([
        api.get<DatasetSummary[]>("/datasets"),
        api.get<Indicator[]>("/indicators"),
        api.get<MappingTemplate[]>("/mapping-templates"),
      ]);
      setDatasets(list);
      setIndicators(inds);
      setTemplates(tmps);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    (async () => {
      const d = await api.get<DatasetDetail>(`/datasets/${selectedId}`);
      setDetail(d);
      const m = await api.get<Mapping>(`/mappings/${selectedId}`);
      setMapping(m);
    })();
  }, [selectedId]);

  const columns = [
    { title: "Name", dataIndex: "name", key: "name" },
    { title: "Rows", dataIndex: "rowCount", key: "rowCount", width: 90 },
    { title: "Sample", dataIndex: "isSample", key: "isSample", width: 90, render: (v: boolean) => (v ? "Yes" : "") },
    { title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180 },
    {
      title: "Action",
      key: "action",
      width: 120,
      render: (_: any, r: DatasetSummary) => (
        <Button size="small" onClick={() => setSelectedId(r.id)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card
        title="数据集"
        extra={
          <Space>
            <Button onClick={() => refresh()}>刷新</Button>
            <Button type="primary" onClick={() => setImportOpen(true)}>
              导入 CSV / 粘贴
            </Button>
          </Space>
        }
      >
        <Table rowKey="id" loading={loading} columns={columns} dataSource={datasets} pagination={{ pageSize: 8 }} />
      </Card>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          refresh();
        }}
      />

      <Drawer width={980} open={!!selectedId} onClose={() => setSelectedId(null)} title={detail?.name || "Dataset"}>
        {detail ? (
          <Tabs
            items={[
              {
                key: "preview",
                label: "预览",
                children: (
                  <Table
                    rowKey={(r) => `${r.entity}-${r.year}`}
                    size="small"
                    scroll={{ x: true }}
                    columns={detail.columns.map((c) => ({ title: c, dataIndex: c, key: c }))}
                    dataSource={detail.previewRows}
                    pagination={false}
                  />
                ),
              },
              {
                key: "edit",
                label: "编辑",
                children: (
                  <DatasetEditor
                    datasetId={detail.id}
                    onSaved={async () => {
                      message.success("已保存数据集");
                      const d = await api.get<DatasetDetail>(`/datasets/${detail.id}`);
                      setDetail(d);
                    }}
                  />
                ),
              },
              {
                key: "mapping",
                label: "列映射",
                children: (
                  <MappingEditor
                    dataset={detail}
                    indicators={indicators}
                    mapping={mapping}
                    onSaved={async () => {
                      message.success("已保存映射");
                      const m = await api.get<Mapping>(`/mappings/${detail.id}`);
                      setMapping(m);
                    }}
                    setMapping={setMapping}
                    templates={templates}
                    onTemplatesChanged={async () => {
                      const tmps = await api.get<MappingTemplate[]>("/mapping-templates");
                      setTemplates(tmps);
                    }}
                  />
                ),
              },
            ]}
          />
        ) : null}
      </Drawer>
    </Space>
  );
}

function ImportModal(props: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { open, onClose, onImported } = props;
  const [tab, setTab] = React.useState<"file" | "paste">("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [form] = Form.useForm();

  return (
    <Modal
      open={open}
      title="导入数据集"
      onCancel={onClose}
      okText="导入"
      confirmLoading={loading}
      onOk={async () => {
        const values = await form.validateFields();
        setLoading(true);
        try {
          if (tab === "file") {
            if (!file) throw new Error("请选择 CSV 文件");
            await uploadDataset(file, values.name, values.yearOverride);
          } else {
            await api.post<{ datasetId: string }>("/datasets/import-text", {
              name: values.name,
              csvText: values.csvText,
              yearOverride: values.yearOverride,
            });
          }
          onImported();
        } catch (e: any) {
          message.error(e?.message || String(e));
        } finally {
          setLoading(false);
        }
      }}
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as any)}
        items={[
          { key: "file", label: "CSV 文件", children: null },
          { key: "paste", label: "粘贴 CSV", children: null },
        ]}
      />

      <Form layout="vertical" form={form} initialValues={{ yearOverride: undefined }}>
        <Form.Item label="数据集名称" name="name">
          <Input placeholder="例如：我的业务数据 2023" />
        </Form.Item>
        <Form.Item label="Year（当 CSV 缺少 year 列时使用）" name="yearOverride">
          <InputNumber style={{ width: "100%" }} placeholder="例如：2023" />
        </Form.Item>

        {tab === "file" ? (
          <Form.Item label="CSV 文件">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
              }}
            />
          </Form.Item>
        ) : (
          <Form.Item label="CSV 文本" name="csvText" rules={[{ required: true, message: "请输入 CSV 文本" }]}>
            <Input.TextArea rows={10} placeholder="entity,year,..." />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function MappingEditor(props: {
  dataset: DatasetDetail;
  indicators: Indicator[];
  mapping: Mapping | null;
  setMapping: (m: Mapping | null) => void;
  onSaved: () => void;
  templates: MappingTemplate[];
  onTemplatesChanged: () => void;
}) {
  const { dataset, indicators, mapping, setMapping, onSaved, templates, onTemplatesChanged } = props;
  const [saving, setSaving] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<string | undefined>(undefined);
  const [templateName, setTemplateName] = React.useState<string>("");
  const [templateSaving, setTemplateSaving] = React.useState(false);
  const [templateDeleting, setTemplateDeleting] = React.useState(false);

  const options = dataset.columns.map((c) => ({ label: c, value: c }));

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Typography.Paragraph style={{ margin: 0 }}>
        将数据集的原始列映射到指标 key。训练/计算时会使用该映射读取数值。
      </Typography.Paragraph>

      <Space wrap>
        <Button
          onClick={() => {
            const next: Mapping = mapping ? { ...mapping, map: { ...mapping.map } } : { datasetId: dataset.id, map: {} };
            const colsLower = new Map<string, string>();
            for (const c of dataset.columns) colsLower.set(c.toLowerCase(), c);
            for (const ind of indicators) {
              if (next.map[ind.key]) continue;
              const same = colsLower.get(ind.key.toLowerCase());
              if (same) next.map[ind.key] = same;
            }
            setMapping(next);
            message.success("已自动匹配同名列（仅填充空映射）");
          }}
        >
          自动匹配同名列
        </Button>

        <Select
          style={{ width: 260 }}
          placeholder="选择映射模板…"
          value={selectedTemplate}
          onChange={setSelectedTemplate}
          allowClear
          options={templates.map((t) => ({ value: t.name, label: t.name }))}
        />
        <Button
          disabled={!selectedTemplate}
          onClick={() => {
            const t = templates.find((x) => x.name === selectedTemplate);
            if (!t) return;
            const next: Mapping = mapping ? { ...mapping, map: { ...mapping.map } } : { datasetId: dataset.id, map: {} };
            for (const [k, col] of Object.entries(t.map || {})) {
              if (dataset.columns.includes(col)) next.map[k] = col;
            }
            setMapping(next);
            message.success(`已应用模板：${t.name}`);
          }}
        >
          应用模板
        </Button>

        <Input
          style={{ width: 220 }}
          placeholder="模板名（保存）"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
        />
        <Button
          type="primary"
          loading={templateSaving}
          onClick={async () => {
            const name = templateName.trim();
            if (!name) {
              message.error("请输入模板名");
              return;
            }
            setTemplateSaving(true);
            try {
              await api.post("/mapping-templates", { name, map: mapping?.map || {} });
              message.success("已保存模板");
              setTemplateName("");
              await onTemplatesChanged();
            } catch (e: any) {
              message.error(e?.message || String(e));
            } finally {
              setTemplateSaving(false);
            }
          }}
        >
          保存为模板
        </Button>

        <Button
          danger
          loading={templateDeleting}
          disabled={!selectedTemplate}
          onClick={async () => {
            if (!selectedTemplate) return;
            setTemplateDeleting(true);
            try {
              await api.del(`/mapping-templates/${encodeURIComponent(selectedTemplate)}`);
              message.success("已删除模板");
              setSelectedTemplate(undefined);
              await onTemplatesChanged();
            } catch (e: any) {
              message.error(e?.message || String(e));
            } finally {
              setTemplateDeleting(false);
            }
          }}
        >
          删除模板
        </Button>
      </Space>

      <Table
        rowKey="key"
        size="small"
        pagination={false}
        columns={[
          { title: "Indicator Key", dataIndex: "key", key: "key", width: 200 },
          { title: "Name", dataIndex: "name", key: "name", width: 200 },
          { title: "Dimension2", dataIndex: "dimension2Key", key: "dimension2Key", width: 160 },
          { title: "Direction", dataIndex: "direction", key: "direction", width: 120 },
          {
            title: "Column",
            key: "col",
            render: (_: any, ind: Indicator) => {
              const value = mapping?.map?.[ind.key];
              return (
                <Select
                  style={{ width: 260 }}
                  value={value}
                  options={options}
                  allowClear
                  onChange={(v) => {
                    const next: Mapping = mapping ? { ...mapping, map: { ...mapping.map } } : { datasetId: dataset.id, map: {} };
                    if (!v) delete next.map[ind.key];
                    else next.map[ind.key] = v;
                    setMapping(next);
                  }}
                />
              );
            },
          },
        ]}
        dataSource={indicators}
      />
      <Button
        type="primary"
        loading={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await api.put(`/mappings/${dataset.id}`, { map: mapping?.map || {} });
            onSaved();
          } finally {
            setSaving(false);
          }
        }}
      >
        保存映射
      </Button>
    </Space>
  );
}

function DatasetEditor(props: { datasetId: string; onSaved: () => void }) {
  const { datasetId, onSaved } = props;
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [columns, setColumns] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, any>[]>([]);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<{ columns: string[]; rows: Record<string, any>[] }>(`/datasets/${datasetId}/data`);
        setColumns(data.columns);
        setRows(data.rows);
      } finally {
        setLoading(false);
      }
    })();
  }, [datasetId]);

  const tableColumns = React.useMemo(() => {
    return columns.map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      render: (_: any, r: any, idx: number) => (
        <Input
          value={r[c]}
          onChange={(e) => {
            const v = e.target.value;
            setRows((prev) => {
              const next = prev.slice();
              next[idx] = { ...next[idx], [c]: v };
              return next;
            });
          }}
        />
      ),
    }));
  }, [columns]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Space>
        <Button
          onClick={() => {
            const blank: Record<string, any> = {};
            for (const c of columns) blank[c] = "";
            setRows((prev) => [...prev, blank]);
          }}
        >
          新增行
        </Button>
        <Button
          type="primary"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api.put(`/datasets/${datasetId}/data`, { columns, rows });
              onSaved();
            } catch (e: any) {
              message.error(e?.message || String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          保存
        </Button>
      </Space>
      <Table
        loading={loading}
        rowKey={(_, idx) => String(idx)}
        size="small"
        scroll={{ x: true }}
        columns={tableColumns}
        dataSource={rows}
        pagination={{ pageSize: 8 }}
      />
      <Typography.Text type="secondary">
        提示：保存时会校验 `entity+year` 唯一性以及数值字段格式（缺失值会阻断计算）。
      </Typography.Text>
    </Space>
  );
}
