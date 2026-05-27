import React from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { api } from "../../api";
import { Onboarding } from "../../types";
import { ChartPanel } from "../components/ChartPanel";
import { CompactValueText } from "../components/CompactValueText";
import { useNavigate } from "react-router-dom";

type AlgoKey = "entropy" | "pca" | "ahp";

type MethodProfile = {
  key: AlgoKey;
  title: string;
  lens: string;
  bestFor: string;
  watchOut: string;
  readingCue: string;
};

const METHOD_PROFILES: MethodProfile[] = [
  {
    key: "entropy",
    title: "熵权法",
    lens: "让数据自己暴露差异",
    bestFor: "当你想先发现谁波动更大、谁更能拉开样本差距时。",
    watchOut: "它更敏感于样本离散度，适合做“客观差异”观察，不适合直接替代业务判断。",
    readingCue: "先看领先者，再看分项强弱，最后看差距是不是来自少数指标。",
  },
  {
    key: "pca",
    title: "PCA",
    lens: "把相关指标压缩成更少的主方向",
    bestFor: "当指标很多、彼此相关，想解释“为什么整体排序变了”时。",
    watchOut: "主成分不一定能直接对应业务语言，需要把结果翻译回具体指标变化。",
    readingCue: "先看综合指数的方向，再看主成分是否解释了原始指标的共同变化。",
  },
  {
    key: "ahp",
    title: "AHP",
    lens: "把业务偏好显式写进权重",
    bestFor: "当你已经知道哪些维度更重要，想把判断规则显性化时。",
    watchOut: "它最依赖前提假设，适合解释“为什么按这套偏好排”，不适合假装完全客观。",
    readingCue: "先看权重假设，再看一致性，最后看结果是否符合你的业务常识。",
  },
];

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
      render: (value: unknown) => <CompactValueText value={value} column={c} />,
    }));
  }, [columns]);

  const algoLabel = React.useMemo(() => {
    if (algo === "entropy") return "熵权法";
    if (algo === "pca") return "PCA";
    return "AHP";
  }, [algo]);

  const latestRows = React.useMemo(() => {
    if (rows.length === 0) return [];
    const latestYear = Math.max(...rows.map((row) => Number(row.year)));
    return rows
      .filter((row) => Number(row.year) === latestYear)
      .sort((left, right) => Number(right.index_0_100 ?? 0) - Number(left.index_0_100 ?? 0));
  }, [rows]);

  const dimensionColumns = React.useMemo(
    () => columns.filter((column) => column.startsWith("subindex.")),
    [columns],
  );

  const demoSummary = React.useMemo(() => {
    if (latestRows.length === 0) return null;

    const latestYear = Math.max(...latestRows.map((row) => Number(row.year)));
    const scores = latestRows.map((row) => Number(row.index_0_100 ?? 0));
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const leader = latestRows[0];
    const tail = latestRows[latestRows.length - 1];
    const spread = Number(leader.index_0_100 ?? 0) - Number(tail.index_0_100 ?? 0);

    const highlightedDimensions = dimensionColumns
      .map((column) => ({
        key: column.replace("subindex.", "").replace("_0_100", ""),
        value: Number(leader[column] ?? 0),
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 2);

    return {
      latestYear,
      entityCount: latestRows.length,
      leader,
      tail,
      averageScore,
      spread,
      highlightedDimensions,
    };
  }, [dimensionColumns, latestRows]);

  const algoNarrative = React.useMemo(() => {
    if (algo === "entropy") {
      return {
        positioning: "更适合先从数据差异本身开始读。",
        summary: "权重由样本离散度自动生成，适合先让数据自己说话，快速发现谁拉开了差距。",
        nextAction: "先看样本里的领先者和分项强项，再切到 PCA / AHP 对比稳定性。",
      };
    }
    if (algo === "pca") {
      return {
        positioning: "更适合解释指标很多、彼此相关时怎么整理结构。",
        summary: "PCA 会把相关指标压缩成主成分，适合在指标重叠较高时解释整体排序为什么变化。",
        nextAction: "重点看综合指数是否和熵权法接近，以及变化是否来自少数主方向。",
      };
    }
    return {
      positioning: "更适合把业务判断显式写进数据解释里。",
      summary: "AHP 把主观判断显式写进权重，更适合你已经知道“哪些维度更重要”的场景。",
      nextAction: "先检查权重假设是否合理，再进入正式数据导入和模型配置。",
    };
  }, [algo]);

  const methodProfileRows = React.useMemo(() => {
    return METHOD_PROFILES.map((profile) => ({
      ...profile,
      active: profile.key === algo,
    }));
  }, [algo]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            快速开始：用示例数据对比三种算法
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            切换算法（熵权 / PCA / AHP）观察综合指数与二级分项指数的差异，然后再导入你的业务数据。系统会按数据列自动生成指标，你只需要确认方向和分组。
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            这页现在更适合作为 stakeholder-facing demo：先讲样例结论，再讲算法差异，最后引导进入真实数据导入。
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

      {demoSummary ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title={`最新年份（${demoSummary.latestYear}）领先实体`} value={String(demoSummary.leader.entity)} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                综合指数 {Number(demoSummary.leader.index_0_100 ?? 0).toFixed(1)}，适合先用它开场讲“谁领先、领先多少”。
              </Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="样本平均综合指数" value={Number(demoSummary.averageScore.toFixed(1))} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                当前算法下共覆盖 {demoSummary.entityCount} 个实体，可快速感知整体分布水平。
              </Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="领先与末位差距" value={Number(demoSummary.spread.toFixed(1))} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                末位是 {String(demoSummary.tail.entity)}，适合继续追问差距来自哪些分项维度。
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>
      ) : null}

      <Card title="三种默认方法怎么读数据">
        <Row gutter={[16, 16]}>
          {methodProfileRows.map((profile) => (
            <Col xs={24} md={8} key={profile.key}>
              <Card
                size="small"
                hoverable
                onClick={() => setAlgo(profile.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setAlgo(profile.key);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={profile.active}
                style={{
                  cursor: "pointer",
                  borderWidth: profile.active ? 2 : 1,
                  borderColor: profile.active ? "#1677ff" : "#f0f0f0",
                  background: profile.active ? "linear-gradient(180deg, rgba(22,119,255,0.08), rgba(22,119,255,0.02))" : "#fff",
                  boxShadow: profile.active ? "0 0 0 2px rgba(22,119,255,0.18), 0 10px 24px rgba(22,119,255,0.08)" : undefined,
                  transform: profile.active ? "translateY(-2px)" : undefined,
                }}
                title={
                  <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
                    <span>{profile.title}</span>
                    {profile.active ? <Tag color="blue">当前方法</Tag> : <Tag>点击切换</Tag>}
                  </Space>
                }
              >
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Tag color={profile.active ? "blue" : "default"}>{profile.lens}</Tag>
                  <Typography.Text strong>{profile.bestFor}</Typography.Text>
                  <Divider style={{ margin: "4px 0 0" }} />
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    {profile.watchOut}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {profile.readingCue}
                  </Typography.Paragraph>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title={`当前算法：${algoLabel}`}>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                message={algoNarrative.positioning}
                description={algoNarrative.summary}
              />
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="先看什么">
                  从样例企业排名切入，再落到分项指数和方法假设。
                </Descriptions.Item>
                <Descriptions.Item label="建议下一步">{algoNarrative.nextAction}</Descriptions.Item>
                <Descriptions.Item label="导入真实数据后">
                  进入“数据集”页上传业务数据，再训练/选择适合的方法模型。
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="解释数据时的顺序">
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Typography.Text strong>1. 先看差异从哪里来</Typography.Text>
              <Typography.Paragraph style={{ margin: 0 }}>
                用上面的摘要卡快速说明“谁领先、差距多大、当前算法更像什么数据透镜”。
              </Typography.Paragraph>
              <Typography.Text strong>2. 再看方法会放大什么</Typography.Text>
              <Typography.Paragraph style={{ margin: 0 }}>
                结合图表和下方表格，解释综合指数和二级分项指数如何一起支撑排序。
              </Typography.Paragraph>
              <Typography.Text strong>3. 最后决定怎么用它</Typography.Text>
              <Typography.Paragraph style={{ margin: 0 }}>
                切换算法对比，再进入真实数据导入，决定后续采用哪种计算方法。
              </Typography.Paragraph>
              {demoSummary?.highlightedDimensions?.length ? (
                <Space wrap>
                  <Typography.Text strong>领先实体更像什么：</Typography.Text>
                  {demoSummary.highlightedDimensions.map((item) => (
                    <Tag key={item.key} color="blue">
                      {item.key}: {item.value.toFixed(1)}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Space>
          </Card>
        </Col>
      </Row>

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
        <ChartPanel rows={rows} title={`示例 / ${algoLabel}`} />
      </Card>
    </Space>
  );
}
