import React from "react";
import { api, uploadDataset } from "../../api";
import { DatasetDetail, DatasetIndicator, DatasetSummary } from "../../types";
import { Alert, Button, Card, Drawer, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Tabs, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";

export function DatasetsPage() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<DatasetDetail | null>(null);
  const [detailIndicators, setDetailIndicators] = React.useState<DatasetIndicator[]>([]);
  const [datasetIndicatorsById, setDatasetIndicatorsById] = React.useState<Record<string, DatasetIndicator[]>>({});
  const [importOpen, setImportOpen] = React.useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const list = await api.get<DatasetSummary[]>("/datasets");
      const indicatorPairs = await Promise.all(
        list.map(async (dataset) => {
          const indicators = await api.get<DatasetIndicator[]>(`/datasets/${dataset.id}/indicators`);
          return [dataset.id, indicators] as const;
        }),
      );
      setDatasets(list);
      setDatasetIndicatorsById(Object.fromEntries(indicatorPairs));
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
      const [d, indicators] = await Promise.all([
        api.get<DatasetDetail>(`/datasets/${selectedId}`),
        api.get<DatasetIndicator[]>(`/datasets/${selectedId}/indicators`),
      ]);
      setDetail(d);
      setDetailIndicators(indicators);
    })();
  }, [selectedId]);

  const detailReadiness = React.useMemo(() => {
    if (!detail) return null;
    return getDatasetReadiness(detail, detailIndicators);
  }, [detail, detailIndicators]);

  const columns = [
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "行数", dataIndex: "rowCount", key: "rowCount", width: 90 },
    { title: "示例", dataIndex: "isSample", key: "isSample", width: 90, render: (v: boolean) => (v ? "是" : "") },
    {
      title: "就绪度",
      key: "readiness",
      width: 280,
      render: (_: any, r: DatasetSummary) => {
        const readiness = getDatasetReadiness(r, datasetIndicatorsById[r.id] || []);
        return <DatasetReadinessInline readiness={readiness} />;
      },
    },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
    {
      title: "操作",
      key: "action",
      width: 180,
      render: (_: any, r: DatasetSummary) => (
        <Space>
          <Button size="small" onClick={() => setSelectedId(r.id)}>
            查看
          </Button>
          {!r.isSample ? (
            <Button
              size="small"
              danger
              onClick={() => {
                Modal.confirm({
                  title: "删除数据集？",
                  content: `将删除「${r.name}」以及它的本地文件，此操作不可恢复。`,
                  okText: "删除",
                  okButtonProps: { danger: true },
                  cancelText: "取消",
                  onOk: async () => {
                    try {
                      await api.del(`/datasets/${r.id}`);
                      if (selectedId === r.id) setSelectedId(null);
                      message.success("已删除数据集");
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

      <Drawer width={980} open={!!selectedId} onClose={() => setSelectedId(null)} title={detail?.name || "数据集"}>
        {detail ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            {detailReadiness ? (
              <DatasetReadinessCard
                readiness={detailReadiness}
                onOpenModels={() => navigate("/models")}
                onOpenCompute={() => navigate("/compute")}
              />
            ) : null}
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
                        await refresh();
                      }}
                    />
                  ),
                },
                {
                  key: "indicators",
                  label: "指标设置",
                  children: (
                    <DatasetIndicatorsEditor
                      dataset={detail}
                      indicators={detailIndicators}
                      readiness={detailReadiness}
                      onSaved={async () => {
                        message.success("已保存指标设置");
                        const indicators = await api.get<DatasetIndicator[]>(`/datasets/${detail.id}/indicators`);
                        setDetailIndicators(indicators);
                        setDatasetIndicatorsById((prev) => ({ ...prev, [detail.id]: indicators }));
                        await refresh();
                      }}
                    />
                  ),
                },
              ]}
            />
          </Space>
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
        <Form.Item label="年份（当 CSV 缺少 year 列时使用）" name="yearOverride">
          <InputNumber style={{ width: "100%" }} placeholder="例如：2023" />
        </Form.Item>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="支持两种导入格式"
          description="1) 标准宽表：entity / year / 指标列；2) 原始一级/二级指标表：含 一级指标、二级指标、年份列。第二种格式会在后台自动生成分组模板并展开成可计算数据集。"
        />

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

function DatasetIndicatorsEditor(props: {
  dataset: DatasetDetail;
  indicators: DatasetIndicator[];
  readiness: DatasetReadiness;
  onSaved: () => void;
}) {
  const { dataset, indicators, readiness, onSaved } = props;
  const [saving, setSaving] = React.useState(false);
  const [draftIndicators, setDraftIndicators] = React.useState<DatasetIndicator[]>(indicators);
  const options = dataset.columns.map((c) => ({ label: c, value: c }));

  React.useEffect(() => {
    setDraftIndicators(indicators);
  }, [indicators]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Typography.Paragraph style={{ margin: 0 }}>
        系统已经按数据集列自动生成指标。这里主要做轻量校正，比如方向、分组和显示名称。
      </Typography.Paragraph>
      <Alert
        type={readiness.status === "ready" ? "success" : readiness.status === "partial" ? "warning" : "error"}
        showIcon
        message={`可计算指标 ${readiness.mappedIndicatorCount}/${readiness.totalIndicators} 个`}
        description={readiness.nextStep}
      />

      <Table
        rowKey="key"
        size="small"
        pagination={false}
        columns={[
          { title: "指标 Key", dataIndex: "key", key: "key", width: 220 },
          {
            title: "名称",
            key: "name",
            width: 220,
            render: (_: unknown, indicator: DatasetIndicator, index: number) => (
              <Input
                value={indicator.name}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraftIndicators((prev) => prev.map((item, idx) => (idx === index ? { ...item, name: value } : item)));
                }}
              />
            ),
          },
          {
            title: "分组",
            key: "dimension2Key",
            width: 180,
            render: (_: unknown, indicator: DatasetIndicator, index: number) => (
              <Input
                value={indicator.dimension2Key}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraftIndicators((prev) => prev.map((item, idx) => (idx === index ? { ...item, dimension2Key: value || "default" } : item)));
                }}
              />
            ),
          },
          {
            title: "方向",
            key: "direction",
            width: 120,
            render: (_: unknown, indicator: DatasetIndicator, index: number) => (
              <Select
                style={{ width: 100 }}
                value={indicator.direction}
                options={[
                  { value: "positive", label: "正向" },
                  { value: "negative", label: "负向" },
                ]}
                onChange={(value) => {
                  setDraftIndicators((prev) =>
                    prev.map((item, idx) => (idx === index ? { ...item, direction: value } : item)),
                  );
                }}
              />
            ),
          },
          {
            title: "数据列",
            key: "sourceColumn",
            render: (_: unknown, indicator: DatasetIndicator, index: number) => {
              return (
                <Select
                  style={{ width: 260 }}
                  value={indicator.sourceColumn}
                  options={options}
                  onChange={(v) => {
                    setDraftIndicators((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, sourceColumn: v } : item)),
                    );
                  }}
                />
              );
            },
          },
        ]}
        dataSource={draftIndicators}
      />
      <Button
        type="primary"
        loading={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await api.put(`/datasets/${dataset.id}/indicators`, draftIndicators);
            onSaved();
          } catch (e: any) {
            message.error(e?.message || String(e));
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
  const [renaming, setRenaming] = React.useState(false);
  const [datasetName, setDatasetName] = React.useState("");
  const [columns, setColumns] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, any>[]>([]);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const detail = await api.get<DatasetDetail>(`/datasets/${datasetId}`);
        const data = await api.get<{ columns: string[]; rows: Record<string, any>[] }>(`/datasets/${datasetId}/data`);
        setDatasetName(detail.name);
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
      <Card size="small" title="数据集名称">
        <Space wrap>
          <Input
            style={{ width: 320 }}
            value={datasetName}
            onChange={(event) => setDatasetName(event.target.value)}
            placeholder="输入数据集名称"
          />
          <Button
            loading={renaming}
            onClick={async () => {
              const nextName = datasetName.trim();
              if (!nextName) {
                message.warning("数据集名称不能为空");
                return;
              }
              setRenaming(true);
              try {
                await api.put(`/datasets/${datasetId}/name`, { name: nextName });
                message.success("已更新数据集名称");
                onSaved();
              } catch (e: any) {
                message.error(e?.message || String(e));
              } finally {
                setRenaming(false);
              }
            }}
          >
            保存名称
          </Button>
        </Space>
      </Card>
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

type DatasetReadinessStatus = "not_ready" | "partial" | "ready";

type DatasetReadiness = {
  status: DatasetReadinessStatus;
  label: string;
  color: "red" | "orange" | "green";
  percent: number;
  hasEntityYear: boolean;
  entityYearText: string;
  mappedIndicatorCount: number;
  totalIndicators: number;
  mappingCoverageText: string;
  nextStep: string;
};

function getDatasetReadiness(
  dataset: Pick<DatasetSummary, "columns"> & Partial<Pick<DatasetDetail, "schema">>,
  indicators: DatasetIndicator[],
): DatasetReadiness {
  const columns = dataset.columns || [];
  const schemaTypes = (dataset.schema?.types || {}) as Record<string, string>;
  const hasEntity = columns.includes("entity");
  const hasYear = columns.includes("year");
  const hasEntityYear = hasEntity && hasYear;

  const totalIndicators = indicators.length;
  const validMappedIndicators = indicators.filter((indicator) => {
    const mappedColumn = indicator.sourceColumn;
    if (!mappedColumn || !columns.includes(mappedColumn)) return false;
    return schemaTypes[mappedColumn] ? schemaTypes[mappedColumn] === "number" : mappedColumn !== "entity" && mappedColumn !== "year";
  });
  const mappedIndicatorCount = validMappedIndicators.length;
  const coverageRatio = totalIndicators > 0 ? mappedIndicatorCount / totalIndicators : hasEntityYear ? 1 : 0;

  let status: DatasetReadinessStatus = "not_ready";
  let label = "未就绪";
  let color: DatasetReadiness["color"] = "red";

  if (hasEntityYear && (mappedIndicatorCount > 0 || totalIndicators === 0)) {
    status = coverageRatio >= 0.8 ? "ready" : "partial";
    label = status === "ready" ? "可用于训练/计算" : "部分就绪";
    color = status === "ready" ? "green" : "orange";
  }

  const percentBase = hasEntityYear ? 35 : 0;
  const percentCoverage = totalIndicators > 0 ? Math.round(coverageRatio * 65) : hasEntityYear ? 65 : 0;
  const percent = Math.max(0, Math.min(100, percentBase + percentCoverage));

  let nextStep = "先补齐 entity/year 基础列，再回到编辑页修正数据。";
  if (hasEntityYear && totalIndicators === 0) {
    nextStep = "先检查数据列是否为可计算数值列，系统会自动生成指标。";
  } else if (hasEntityYear && mappedIndicatorCount === 0) {
    nextStep = "去“指标设置”里确认方向、分组和数据列绑定，至少保留核心指标。";
  } else if (hasEntityYear && mappedIndicatorCount < totalIndicators) {
    nextStep = "已具备基础，可先用于小范围试算；若要稳定训练/计算，建议继续清理剩余不可计算列。";
  } else if (hasEntityYear) {
    nextStep = "基础列和指标都已到位，可直接进入模型训练或结果计算。";
  }

  return {
    status,
    label,
    color,
    percent,
    hasEntityYear,
    entityYearText: hasEntityYear ? "已具备 entity/year 基础" : `缺少基础列：${[!hasEntity ? "entity" : null, !hasYear ? "year" : null].filter(Boolean).join(" / ")}`,
    mappedIndicatorCount,
    totalIndicators,
    mappingCoverageText: totalIndicators > 0 ? `${mappedIndicatorCount}/${totalIndicators} 个指标可直接计算` : "当前还没有可计算的指标定义",
    nextStep,
  };
}

function DatasetReadinessInline(props: { readiness: DatasetReadiness }) {
  const { readiness } = props;
  return (
    <Space direction="vertical" size={2}>
      <Space size={8} wrap>
        <Tag color={readiness.color}>{readiness.label}</Tag>
        <Typography.Text type="secondary">{readiness.mappingCoverageText}</Typography.Text>
      </Space>
      <Typography.Text type="secondary">{readiness.nextStep}</Typography.Text>
    </Space>
  );
}

function DatasetReadinessCard(props: {
  readiness: DatasetReadiness;
  onOpenModels: () => void;
  onOpenCompute: () => void;
}) {
  const { readiness, onOpenModels, onOpenCompute } = props;
  return (
    <Card
      size="small"
      title="训练 / 计算前提"
      extra={
        <Space wrap>
          <Button size="small" onClick={onOpenModels}>
            去训练模型
          </Button>
          <Button size="small" type="primary" disabled={readiness.status === "not_ready"} onClick={onOpenCompute}>
            去计算
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Space wrap size={12}>
          <Tag color={readiness.color}>{readiness.label}</Tag>
          <Typography.Text>{readiness.entityYearText}</Typography.Text>
          <Typography.Text>{readiness.mappingCoverageText}</Typography.Text>
        </Space>
        <Progress
          percent={readiness.percent}
          status={readiness.status === "not_ready" ? "exception" : "active"}
          strokeColor={readiness.status === "ready" ? "#389e0d" : readiness.status === "partial" ? "#d48806" : "#cf1322"}
        />
        <Alert
          showIcon
          type={readiness.status === "ready" ? "success" : readiness.status === "partial" ? "warning" : "error"}
          message="下一步建议"
          description={readiness.nextStep}
        />
      </Space>
    </Card>
  );
}
