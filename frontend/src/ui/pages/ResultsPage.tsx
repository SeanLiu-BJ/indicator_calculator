import React from "react";
import { api } from "../../api";
import { DatasetDetail, DatasetIndicator, ResultDetail, ResultSummary, WeightModel } from "../../types";
import { Button, Card, Drawer, Input, Modal, Select, Space, Table, Typography, message } from "antd";
import { ChartPanel, ChartPanelHandle } from "../components/ChartPanel";
import { CompactValueText } from "../components/CompactValueText";
import {
  ResultExplanationDashboard,
  ResultExplanationDashboardHandle,
} from "../components/ResultExplanationDashboard";
import { useLocation } from "react-router-dom";

type DatasetRowsResponse = {
  columns: string[];
  rows: Record<string, any>[];
};

type SourceDatasetContext = {
  id: string;
  name: string;
  rows: Record<string, any>[];
  indicators: DatasetIndicator[];
};

export function ResultsPage() {
  const location = useLocation();
  const [results, setResults] = React.useState<ResultSummary[]>([]);
  const [weightModels, setWeightModels] = React.useState<WeightModel[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ResultDetail | null>(null);
  const [rows, setRows] = React.useState<Record<string, any>[]>([]);
  const [columns, setColumns] = React.useState<string[]>([]);
  const [sourceDatasets, setSourceDatasets] = React.useState<SourceDatasetContext[]>([]);
  const [entityQuery, setEntityQuery] = React.useState("");
  const [selectedYears, setSelectedYears] = React.useState<number[]>([]);
  const [selectedColumns, setSelectedColumns] = React.useState<string[]>([]);
  const [resultName, setResultName] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);
  const [drawerWidth, setDrawerWidth] = React.useState(1120);
  const chartPanelRef = React.useRef<ChartPanelHandle>(null);
  const explanationDashboardRef = React.useRef<ResultExplanationDashboardHandle>(null);

  async function refresh() {
    const [list, models] = await Promise.all([
      api.get<ResultSummary[]>("/results"),
      api.get<WeightModel[]>("/weight-models"),
    ]);
    setResults(list.filter((r) => !r.id.startsWith("sample_result_")));
    setWeightModels(models);
  }

  React.useEffect(() => {
    refresh();
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    (async () => {
      const d = await api.get<ResultDetail>(`/results/${selectedId}`);
      setDetail(d);
      setResultName(d.name);
      const all = await api.get<{ columns: string[]; rows: Record<string, any>[] }>(`/results/${selectedId}/rows`);
      setColumns(all.columns);
      setRows(all.rows);
      const datasetContexts = await Promise.all(
        d.datasetIds.map(async (datasetId) => {
          const [dataset, data, indicators] = await Promise.all([
            api.get<DatasetDetail>(`/datasets/${datasetId}`),
            api.get<DatasetRowsResponse>(`/datasets/${datasetId}/data`),
            api.get<DatasetIndicator[]>(`/datasets/${datasetId}/indicators`),
          ]);
          return {
            id: dataset.id,
            name: dataset.name,
            rows: data.rows,
            indicators,
          };
        }),
      );
      setSourceDatasets(datasetContexts);
    })();
  }, [selectedId]);

  React.useEffect(() => {
    if (selectedId) return;
    setDetail(null);
    setRows([]);
    setColumns([]);
    setSourceDatasets([]);
  }, [selectedId]);

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openId = params.get("open");
    if (openId) setSelectedId(openId);
  }, [location.search]);

  React.useEffect(() => {
    const updateDrawerWidth = () => {
      if (typeof window === "undefined") return;
      const viewportWidth = window.innerWidth;
      const nextWidth = Math.max(980, Math.min(1480, Math.round(viewportWidth * 0.82)));
      setDrawerWidth(nextWidth);
    };

    updateDrawerWidth();
    window.addEventListener("resize", updateDrawerWidth);
    return () => window.removeEventListener("resize", updateDrawerWidth);
  }, []);

  React.useEffect(() => {
    if (columns.length === 0) return;
    setSelectedColumns((current) => {
      if (current.length > 0) {
        return current.filter((column) => columns.includes(column));
      }

      const preferred = columns.filter(
        (column) =>
          column === "entity" ||
          column === "year" ||
          column === "index_0_100" ||
          column.startsWith("subindex."),
      );
      return preferred.length > 0 ? preferred : columns.slice(0, 8);
    });
  }, [columns]);

  const yearOptions = React.useMemo(() => {
    const years = Array.from(
      new Set(
        rows
          .map((row) => Number(row.year))
          .filter((year) => Number.isFinite(year)),
      ),
    ).sort((left, right) => right - left);
    return years;
  }, [rows]);

  const filteredRows = React.useMemo(() => {
    const query = entityQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const entity = String(row.entity ?? "");
      const year = Number(row.year);
      const entityMatched = !query || entity.toLowerCase().includes(query);
      const yearMatched = selectedYears.length === 0 || selectedYears.includes(year);
      return entityMatched && yearMatched;
    });
  }, [entityQuery, rows, selectedYears]);

  const visibleColumns = selectedColumns.length > 0 ? selectedColumns : columns;
  const tableColumns = visibleColumns.map((column) => ({
    title: column,
    dataIndex: column,
    key: column,
    render: (value: unknown) => <CompactValueText value={value} column={column} />,
  }));
  const currentModel = React.useMemo(
    () => weightModels.find((model) => model.id === detail?.weightModelId) || null,
    [detail?.weightModelId, weightModels],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card
        title="结果集"
        extra={
          <Space>
            <Button onClick={() => refresh()}>刷新</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={[
            { title: "名称", dataIndex: "name", key: "name" },
            { title: "行数", dataIndex: "rowCount", key: "rowCount", width: 90 },
            { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
            {
              title: "操作",
              key: "action",
              width: 110,
              render: (_: unknown, record: ResultSummary) => (
                <Button
                  size="small"
                  danger
                  onClick={(event) => {
                    event.stopPropagation();
                    Modal.confirm({
                      title: "删除结果集？",
                      content: `将删除「${record.name}」以及对应导出文件，此操作不可恢复。`,
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await api.del(`/results/${record.id}`);
                          if (selectedId === record.id) setSelectedId(null);
                          message.success("已删除结果集");
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
              ),
            }
          ]}
          dataSource={results}
          pagination={{ pageSize: 8 }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id),
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      <Drawer
        width={drawerWidth}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail?.name || "结果"}
        extra={
          selectedId ? (
            <Space>
              <Button
                onClick={async () => {
                  const entries = [
                    chartPanelRef.current?.getCurrentChartPng(),
                    ...(explanationDashboardRef.current?.collectAllChartsPng() || []),
                  ].filter((item): item is { filename: string; dataUrl: string } => Boolean(item));
                  if (!entries.length) {
                    message.warning("当前没有可导出的图表");
                    return;
                  }
                  const { default: JSZip } = await import("jszip");
                  const zip = new JSZip();
                  for (const entry of entries) {
                    const base64 = entry.dataUrl.split(",")[1];
                    zip.file(entry.filename, base64, { base64: true });
                  }
                  const zipBlob = await zip.generateAsync({ type: "blob" });
                  const link = document.createElement("a");
                  const currentDate = new Date().toISOString().slice(0, 10);
                  const safeName = (detail.name || "结果")
                    .replace(/[\\/:*?"<>|]/g, "-")
                    .replace(/\s+/g, "_");
                  link.href = URL.createObjectURL(zipBlob);
                  link.download = `${safeName}-图表导出-${currentDate}.zip`;
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                  message.success(`已导出 ${entries.length} 张图表到 zip`);
                }}
              >
                导出图表 PNG
              </Button>
              <Button href={`/api/results/${selectedId}/download`} target="_blank">
                下载 CSV
              </Button>
            </Space>
          ) : null
        }
      >
        {detail ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Typography.Text type="secondary">{`行数：${detail.rowCount}`}</Typography.Text>
            <Card size="small" title="结果集名称">
              <Space wrap>
                <Input
                  style={{ width: 320 }}
                  value={resultName}
                  onChange={(event) => setResultName(event.target.value)}
                  placeholder="输入结果集名称"
                />
                <Button
                  loading={renaming}
                  onClick={async () => {
                    const nextName = resultName.trim();
                    if (!selectedId) return;
                    if (!nextName) {
                      message.warning("结果集名称不能为空");
                      return;
                    }
                    setRenaming(true);
                    try {
                      await api.put(`/results/${selectedId}/name`, { name: nextName });
                      setDetail((current) => (current ? { ...current, name: nextName } : current));
                      setResults((current) =>
                        current.map((item) => (item.id === selectedId ? { ...item, name: nextName } : item)),
                      );
                      message.success("已更新结果集名称");
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
            <Card size="small" title="筛选">
              <Space wrap size={12}>
                <Input
                  style={{ width: 220 }}
                  value={entityQuery}
                  onChange={(event) => setEntityQuery(event.target.value)}
                  placeholder="按实体名称筛选"
                  allowClear
                />
                <Select
                  mode="multiple"
                  style={{ minWidth: 220 }}
                  value={selectedYears}
                  onChange={setSelectedYears}
                  placeholder="年份筛选"
                  allowClear
                  options={yearOptions.map((year) => ({ value: year, label: `${year}` }))}
                />
                <Select
                  mode="multiple"
                  style={{ minWidth: 320 }}
                  value={selectedColumns}
                  onChange={setSelectedColumns}
                  placeholder="选择表格字段"
                  options={columns.map((column) => ({ value: column, label: column }))}
                  optionFilterProp="label"
                  showSearch
                />
                <Typography.Text type="secondary">
                  当前显示 {filteredRows.length} / {rows.length} 行
                </Typography.Text>
              </Space>
            </Card>
            <Card size="small" title="指数表格">
              <Table
                rowKey={(r) => `${r.entity}-${r.year}`}
                size="small"
                scroll={{ x: true }}
                columns={tableColumns}
                dataSource={filteredRows}
                pagination={{ pageSize: 10 }}
              />
            </Card>
            <Card size="small" title="图表（可选）">
              <ChartPanel ref={chartPanelRef} rows={filteredRows} title={detail.name} />
            </Card>
            <Card size="small" title="解释型分析看板">
              <ResultExplanationDashboard
                ref={explanationDashboardRef}
                result={detail}
                rows={filteredRows}
                model={currentModel}
                sourceDatasets={sourceDatasets}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
