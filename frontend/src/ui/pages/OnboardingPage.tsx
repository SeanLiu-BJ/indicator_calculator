import React from "react";
import { Alert, Card, Segmented, Space, Table, Typography, Button } from "antd";
import { api } from "../../api";
import { Onboarding } from "../../types";
import { ChartPanel } from "../components/ChartPanel";
import { useNavigate } from "react-router-dom";

type AlgoKey = "entropy" | "pca" | "ahp";

export function OnboardingPage() {
  const navigate = useNavigate();
  const [onboarding, setOnboarding] = React.useState<Onboarding | null>(null);
  const [algo, setAlgo] = React.useState<AlgoKey>("entropy");
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<Record<string, any>[]>([]);
  const [columns, setColumns] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const data = await api.get<Onboarding>("/onboarding");
        setOnboarding(data);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!onboarding) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resultId = onboarding.resultSetIds[algo];
        const data = await api.get<{ columns: string[]; rows: Record<string, any>[] }>(`/results/${resultId}/rows`);
        setColumns(data.columns);
        setRows(data.rows);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [onboarding, algo]);

  const tableColumns = React.useMemo(() => {
    return columns.map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
    }));
  }, [columns]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            快速开始：用示例数据对比三种算法
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            切换算法（熵权 / PCA / AHP）观察综合指数与二级分项指数的差异，然后再导入你的业务数据选择合适方法。
          </Typography.Paragraph>
          <Space wrap>
            <Segmented
              value={algo}
              onChange={(v) => setAlgo(v as AlgoKey)}
              options={[
                { label: "熵权法", value: "entropy" },
                { label: "PCA", value: "pca" },
                { label: "AHP", value: "ahp" },
              ]}
            />
            <Button type="primary" onClick={() => navigate("/datasets")}>
              开始导入我的数据
            </Button>
          </Space>
          {error ? <Alert type="error" message={error} /> : null}
        </Space>
      </Card>

      <Card title="指数表格（主产物）" loading={loading}>
        <Table
          rowKey={(r) => `${r.entity}-${r.year}`}
          size="small"
          scroll={{ x: true }}
          columns={tableColumns}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Card title="图表（可选）" loading={loading}>
        <ChartPanel rows={rows} title={`Sample / ${algo.toUpperCase()}`} />
      </Card>
    </Space>
  );
}

