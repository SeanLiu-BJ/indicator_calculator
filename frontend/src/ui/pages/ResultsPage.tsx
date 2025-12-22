import React from "react";
import { api } from "../../api";
import { ResultDetail, ResultSummary } from "../../types";
import { Button, Card, Drawer, Space, Table, Typography } from "antd";
import { ChartPanel } from "../components/ChartPanel";
import { useLocation } from "react-router-dom";

export function ResultsPage() {
  const location = useLocation();
  const [results, setResults] = React.useState<ResultSummary[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ResultDetail | null>(null);
  const [rows, setRows] = React.useState<Record<string, any>[]>([]);
  const [columns, setColumns] = React.useState<string[]>([]);

  async function refresh() {
    const list = await api.get<ResultSummary[]>("/results");
    setResults(list.filter((r) => !r.name.startsWith("Sample Result")));
  }

  React.useEffect(() => {
    refresh();
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    (async () => {
      const d = await api.get<ResultDetail>(`/results/${selectedId}`);
      setDetail(d);
      const all = await api.get<{ columns: string[]; rows: Record<string, any>[] }>(`/results/${selectedId}/rows`);
      setColumns(all.columns);
      setRows(all.rows);
    })();
  }, [selectedId]);

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openId = params.get("open");
    if (openId) setSelectedId(openId);
  }, [location.search]);

  const tableColumns = columns.map((c) => ({ title: c, dataIndex: c, key: c }));

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
            { title: "Name", dataIndex: "name", key: "name" },
            { title: "Rows", dataIndex: "rowCount", key: "rowCount", width: 90 },
            { title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180 },
            {
              title: "Action",
              key: "action",
              width: 140,
              render: (_: any, r: ResultSummary) => (
                <Button size="small" onClick={() => setSelectedId(r.id)}>
                  查看
                </Button>
              ),
            },
          ]}
          dataSource={results}
          pagination={{ pageSize: 8 }}
        />
      </Card>

      <Drawer
        width={1000}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail?.name || "Result"}
        extra={
          selectedId ? (
            <Button href={`/api/results/${selectedId}/download`} target="_blank">
              下载 CSV
            </Button>
          ) : null
        }
      >
        {detail ? (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Typography.Text type="secondary">{`Rows: ${detail.rowCount}`}</Typography.Text>
            <Card size="small" title="指数表格">
              <Table
                rowKey={(r) => `${r.entity}-${r.year}`}
                size="small"
                scroll={{ x: true }}
                columns={tableColumns}
                dataSource={rows}
                pagination={{ pageSize: 10 }}
              />
            </Card>
            <Card size="small" title="图表（可选）">
              <ChartPanel rows={rows} title={detail.name} />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
