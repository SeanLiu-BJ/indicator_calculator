import React, { useMemo, useRef } from "react";
import { Alert, Button, Input, Segmented, Select, Space, Typography } from "antd";
import ReactECharts from "echarts-for-react";

type Row = Record<string, any>;

export type ChartPanelHandle = {
  exportCurrentChartPng: () => string | null;
  getCurrentChartPng: () => { filename: string; dataUrl: string } | null;
};

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatMetricLabel(metricName: string) {
  if (!metricName) return "";
  return metricName
    .replace(/^subindex\./, "")
    .replace(/_0_100$/, "")
    .replace(/_/g, " ");
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_").replace(/_+/g, "_").trim();
}

const BASE_TITLE = {
  left: "center" as const,
  top: 10,
  textStyle: {
    fontSize: 16,
    fontWeight: 600,
  },
};

const BASE_LEGEND = {
  top: 40,
  left: "center" as const,
};

const BASE_GRID = {
  top: 96,
  left: 56,
  right: 28,
  bottom: 44,
  containLabel: true,
};

export const ChartPanel = React.forwardRef<ChartPanelHandle, { rows: Row[]; title: string }>(function ChartPanel(props, ref) {
  const { rows, title } = props;
  const chartRef = useRef<ReactECharts>(null);
  const [entityQuery, setEntityQuery] = React.useState("");
  const [viewMode, setViewMode] = React.useState<
    "trend" | "latest" | "delta" | "radar" | "heatmap" | "scatter"
  >("trend");
  const [latestTopN, setLatestTopN] = React.useState<number>(8);

  const entities = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(String(r.entity));
    return Array.from(set).sort();
  }, [rows]);

  const entityMode = entities.length <= 1 ? "single" : "multi";

  const visibleEntityOptions = useMemo(() => {
    const query = entityQuery.trim().toLowerCase();
    if (!query) return entities;
    return entities.filter((entity) => entity.toLowerCase().includes(query));
  }, [entities, entityQuery]);

  const metricOptions = useMemo(() => {
    if (rows.length === 0) return [];
    const cols = Object.keys(rows[0]);
    const metrics = cols.filter((c) => c === "index_0_100" || c.startsWith("subindex."));
    return metrics;
  }, [rows]);

  const radarMetrics = useMemo(() => {
    return metricOptions.filter((metricName) => metricName.startsWith("subindex."));
  }, [metricOptions]);

  const availableYears = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((row) => Number(row.year))
          .filter((year) => Number.isFinite(year))
      )
    ).sort((left, right) => left - right);
  }, [rows]);

  const [selectedEntities, setSelectedEntities] = React.useState<string[]>(() => (entities[0] ? [entities[0]] : []));
  const [metric, setMetric] = React.useState<string>(() => metricOptions[0] || "index_0_100");
  const [scatterXMetric, setScatterXMetric] = React.useState<string>("");
  const [scatterYMetric, setScatterYMetric] = React.useState<string>("");
  const [activeYear, setActiveYear] = React.useState<number | null>(null);
  const [comparisonYear, setComparisonYear] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (selectedEntities.length === 0 && entities.length > 0) setSelectedEntities([entities[0]]);
  }, [entities, selectedEntities.length]);

  React.useEffect(() => {
    if (entityMode === "single" && (viewMode === "latest" || viewMode === "scatter")) {
      setViewMode("trend");
    }
  }, [entityMode, viewMode]);

  React.useEffect(() => {
    setSelectedEntities((current) => current.filter((entity) => entities.includes(entity)));
  }, [entities]);

  React.useEffect(() => {
    if (!metricOptions.includes(metric) && metricOptions.length > 0) setMetric(metricOptions[0]);
  }, [metricOptions, metric]);

  React.useEffect(() => {
    if (availableYears.length === 0) {
      setActiveYear(null);
      setComparisonYear(null);
      return;
    }

    setActiveYear((current) => (current && availableYears.includes(current) ? current : availableYears.at(-1) ?? null));
    setComparisonYear((current) => {
      if (current && availableYears.includes(current)) return current;
      return availableYears.length > 1 ? availableYears.at(-2) ?? availableYears[0] : availableYears[0];
    });
  }, [availableYears]);

  React.useEffect(() => {
    if (metricOptions.length === 0) return;
    setScatterXMetric((current) => (metricOptions.includes(current) ? current : metricOptions[0]));
    setScatterYMetric((current) => {
      if (metricOptions.includes(current) && current !== (scatterXMetric || metricOptions[0])) {
        return current;
      }
      return metricOptions.find((item) => item !== (scatterXMetric || metricOptions[0])) || metricOptions[0];
    });
  }, [metricOptions, scatterXMetric]);

  const trendSeriesData = useMemo(() => {
    if (selectedEntities.length === 0) {
      return { years: [] as number[], series: [] as Array<{ name: string; data: Array<number | null> }> };
    }

    const yearSet = new Set<number>();
    const byEntityYear: Record<string, Record<number, number>> = {};
    for (const r of rows) {
      const e = String(r.entity);
      if (!selectedEntities.includes(e)) continue;
      const y = Number(r.year);
      yearSet.add(y);
      const v = Number(r[metric]);
      if (!byEntityYear[e]) byEntityYear[e] = {};
      byEntityYear[e][y] = v;
    }
    const years = Array.from(yearSet).sort((a, b) => a - b);

    const series = selectedEntities.map((e) => {
      const m = byEntityYear[e] || {};
      return { name: e, data: years.map((y) => (y in m ? m[y] : null)) };
    });

    return { years, series };
  }, [rows, selectedEntities, metric]);

  const latestSnapshot = useMemo(() => {
    if (rows.length === 0 || activeYear == null) {
      return {
        year: null as number | null,
        labels: [] as string[],
        values: [] as number[],
      };
    }
    const scopedRows = rows
      .filter((row) => Number(row.year) === activeYear)
      .filter((row) => selectedEntities.length === 0 || selectedEntities.includes(String(row.entity)))
      .map((row) => ({
        entity: String(row.entity),
        value: Number(row[metric] ?? 0),
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, latestTopN);

    return {
      year: activeYear,
      labels: scopedRows.map((row) => row.entity),
      values: scopedRows.map((row) => row.value),
    };
  }, [activeYear, rows, selectedEntities, metric, latestTopN]);

  const deltaSnapshot = useMemo(() => {
    if (rows.length === 0 || activeYear == null || comparisonYear == null) {
      return {
        activeYear: null as number | null,
        comparisonYear: null as number | null,
        labels: [] as string[],
        values: [] as number[],
      };
    }

    const entityPool =
      selectedEntities.length > 0 ? selectedEntities : Array.from(new Set(rows.map((row) => String(row.entity))));
    const byKey = new Map<string, number>();
    for (const row of rows) {
      byKey.set(`${String(row.entity)}::${Number(row.year)}`, Number(row[metric] ?? 0));
    }

    const items = entityPool
      .map((entity) => {
        const current = Number(byKey.get(`${entity}::${activeYear}`));
        const previous = Number(byKey.get(`${entity}::${comparisonYear}`));
        if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
        return {
          entity,
          value: Number((current - previous).toFixed(2)),
        };
      })
      .filter((item): item is { entity: string; value: number } => item !== null)
      .sort((left, right) => right.value - left.value);

    return {
      activeYear,
      comparisonYear,
      labels: items.map((item) => item.entity),
      values: items.map((item) => item.value),
    };
  }, [activeYear, comparisonYear, metric, rows, selectedEntities]);

  const radarSnapshot = useMemo(() => {
    if (rows.length === 0 || radarMetrics.length === 0 || activeYear == null) {
      return {
        year: null as number | null,
        indicators: [] as Array<{ name: string; max: number }>,
        series: [] as Array<{ name: string; value: number[] }>,
      };
    }
    const latestRows = rows
      .filter((row) => Number(row.year) === activeYear)
      .filter((row) => selectedEntities.length === 0 || selectedEntities.includes(String(row.entity)));

    const indicators = radarMetrics.map((metricName) => {
      const values = latestRows.map((row) => Number(row[metricName] ?? 0));
      const maxValue = Math.max(100, ...values);
      return {
        name: metricName.replace("subindex.", "").replace("_0_100", ""),
        max: Number.isFinite(maxValue) ? Math.ceil(maxValue / 10) * 10 : 100,
      };
    });

    const series = latestRows.slice(0, 5).map((row) => ({
      name: String(row.entity),
      value: radarMetrics.map((metricName) => Number(row[metricName] ?? 0)),
    }));

    return { year: activeYear, indicators, series };
  }, [activeYear, radarMetrics, rows, selectedEntities]);

  const heatmapSnapshot = useMemo(() => {
    if (rows.length === 0) {
      return {
        entities: [] as string[],
        years: [] as number[],
        values: [] as Array<[number, number, number]>,
      };
    }

    const entitySet = new Set<string>();
    const yearSet = new Set<number>();
    const byKey = new Map<string, number>();

    for (const row of rows) {
      const entity = String(row.entity);
      const year = Number(row.year);
      if (!Number.isFinite(year)) continue;
      if (selectedEntities.length > 0 && !selectedEntities.includes(entity)) continue;
      entitySet.add(entity);
      yearSet.add(year);
      byKey.set(`${entity}::${year}`, Number(row[metric] ?? 0));
    }

    const entitiesForHeatmap = Array.from(entitySet).sort();
    const years = Array.from(yearSet).sort((left, right) => left - right);
    const values: Array<[number, number, number]> = [];

    entitiesForHeatmap.forEach((entity, entityIndex) => {
      years.forEach((year, yearIndex) => {
        values.push([yearIndex, entityIndex, Number(byKey.get(`${entity}::${year}`) ?? 0)]);
      });
    });

    return {
      entities: entitiesForHeatmap,
      years,
      values,
    };
  }, [metric, rows, selectedEntities]);

  const scatterSnapshot = useMemo(() => {
    if (rows.length === 0 || !scatterXMetric || !scatterYMetric || activeYear == null) {
      return {
        year: null as number | null,
        points: [] as Array<{ name: string; value: [number, number, number] }>
      };
    }
    const scopedRows = rows
      .filter((row) => Number(row.year) === activeYear)
      .filter((row) => selectedEntities.length === 0 || selectedEntities.includes(String(row.entity)));

    return {
      year: activeYear,
      points: scopedRows.map((row) => ({
        name: String(row.entity),
        value: [
          Number(row[scatterXMetric] ?? 0),
          Number(row[scatterYMetric] ?? 0),
          Number(row.index_0_100 ?? 0)
        ]
      }))
    };
  }, [activeYear, rows, scatterXMetric, scatterYMetric, selectedEntities]);

  const option = useMemo(() => {
    if (viewMode === "latest") {
      return {
        title: {
          ...BASE_TITLE,
          text: latestSnapshot.year ? `${title} · ${latestSnapshot.year} 年度截面对比` : `${title} · 暂无数据`,
        },
        legend: BASE_LEGEND,
        grid: BASE_GRID,
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: latestSnapshot.labels,
          axisLabel: { interval: 0, rotate: latestSnapshot.labels.length > 6 ? 20 : 0 },
        },
        yAxis: { type: "value" },
        series: [
          {
            name: metric,
            type: "bar",
            data: latestSnapshot.values,
            itemStyle: { color: "#1677ff" },
          },
        ],
      };
    }

    if (viewMode === "delta") {
      return {
        title: {
          ...BASE_TITLE,
          text:
            deltaSnapshot.activeYear && deltaSnapshot.comparisonYear
              ? `${title} · ${deltaSnapshot.activeYear} vs ${deltaSnapshot.comparisonYear} 同比变化`
              : `${title} · 暂无同比数据`,
        },
        legend: BASE_LEGEND,
        grid: BASE_GRID,
        tooltip: {
          trigger: "axis",
          formatter: (params: Array<{ axisValue: string; data: number }>) => {
            const first = params[0];
            if (!first) return "";
            return `${first.axisValue}<br/>变化值: ${Number(first.data).toFixed(2)}`;
          },
        },
        xAxis: {
          type: "category",
          data: deltaSnapshot.labels,
          axisLabel: { interval: 0, rotate: deltaSnapshot.labels.length > 6 ? 20 : 0 },
        },
        yAxis: { type: "value" },
        series: [
          {
            type: "bar",
            data: deltaSnapshot.values,
            itemStyle: {
              color: (params: { value: number }) => (params.value >= 0 ? "#52c41a" : "#ff4d4f"),
            },
          },
        ],
      };
    }

    if (viewMode === "radar") {
      return {
        title: {
          ...BASE_TITLE,
          text: radarSnapshot.year ? `${title} · ${radarSnapshot.year} 分项结构雷达` : `${title} · 暂无雷达数据`,
        },
        tooltip: {},
        legend: BASE_LEGEND,
        radar: {
          indicator: radarSnapshot.indicators,
          radius: "54%",
          center: ["50%", "60%"],
        },
        series: [
          {
            type: "radar",
            data: radarSnapshot.series,
          },
        ],
      };
    }

    if (viewMode === "heatmap") {
      return {
        title: {
          ...BASE_TITLE,
          text: `${title} · 实体/年份热力图`,
        },
        legend: BASE_LEGEND,
        tooltip: {
          position: "top",
        },
        grid: {
          ...BASE_GRID,
          top: 108,
          left: 100,
        },
        xAxis: {
          type: "category",
          data: heatmapSnapshot.years,
        },
        yAxis: {
          type: "category",
          data: heatmapSnapshot.entities,
        },
        visualMap: {
          min: 0,
          max: 100,
          calculable: true,
          orient: "horizontal",
          left: "center",
          bottom: 0,
        },
        series: [
          {
            name: metric,
            type: "heatmap",
            data: heatmapSnapshot.values,
            label: { show: true, formatter: ({ value }: { value: [number, number, number] }) => value[2].toFixed(1) },
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowColor: "rgba(0, 0, 0, 0.35)",
              },
            },
          },
        ],
      };
    }

    if (viewMode === "scatter") {
      const xAxisLabel = formatMetricLabel(scatterXMetric);
      const yAxisLabel = formatMetricLabel(scatterYMetric);
      return {
        title: {
          ...BASE_TITLE,
          text: scatterSnapshot.year
            ? `${title} · ${scatterSnapshot.year} 指标关系散点`
            : `${title} · 暂无散点数据`,
        },
        legend: BASE_LEGEND,
        grid: BASE_GRID,
        tooltip: {
          formatter: (params: { data: { name: string; value: [number, number, number] } }) =>
            `${params.data.name}<br/>${xAxisLabel}: ${params.data.value[0].toFixed(2)}<br/>${yAxisLabel}: ${params.data.value[1].toFixed(2)}<br/>综合指数: ${params.data.value[2].toFixed(2)}`
        },
        xAxis: {
          type: "value",
          name: xAxisLabel,
          nameLocation: "middle",
          nameGap: 34,
        },
        yAxis: {
          type: "value",
          name: yAxisLabel,
          nameLocation: "middle",
          nameGap: 48,
        },
        series: [
          {
            type: "scatter",
            data: scatterSnapshot.points,
            symbolSize: (value: [number, number, number]) => Math.max(12, value[2] / 4),
            label: {
              show: true,
              formatter: (params: { data: { name: string } }) => params.data.name,
              position: "top"
            },
            itemStyle: {
              color: "#fa8c16"
            }
          }
        ]
      };
    }

    return {
      title: { ...BASE_TITLE, text: title },
      tooltip: { trigger: "axis" },
      legend: BASE_LEGEND,
      grid: BASE_GRID,
      xAxis: { type: "category", data: trendSeriesData.years },
      yAxis: { type: "value" },
      series: trendSeriesData.series.map((s) => ({ name: s.name, type: "line", data: s.data, smooth: true })),
    };
  }, [
    heatmapSnapshot.entities,
    heatmapSnapshot.values,
    heatmapSnapshot.years,
    deltaSnapshot.activeYear,
    deltaSnapshot.comparisonYear,
    deltaSnapshot.labels,
    deltaSnapshot.values,
    latestSnapshot.labels,
    latestSnapshot.values,
    latestSnapshot.year,
    metric,
    radarSnapshot.indicators,
    radarSnapshot.series,
    radarSnapshot.year,
    scatterSnapshot.points,
    scatterSnapshot.year,
    scatterXMetric,
    scatterYMetric,
    title,
    trendSeriesData.series,
    trendSeriesData.years,
    viewMode,
  ]);

  const exportFilename = useMemo(() => {
    const titleParts = [title];
    if (viewMode === "trend") titleParts.push("时间趋势");
    if (viewMode === "latest") titleParts.push(activeYear != null ? `${activeYear}年度截面` : "年度截面");
    if (viewMode === "delta") titleParts.push(activeYear != null && comparisonYear != null ? `${comparisonYear}-${activeYear}同比变化` : "同比变化");
    if (viewMode === "radar") titleParts.push(activeYear != null ? `${activeYear}结构雷达` : "结构雷达");
    if (viewMode === "heatmap") titleParts.push("时间热力图");
    if (viewMode === "scatter") titleParts.push(activeYear != null ? `${activeYear}散点关系` : "散点关系");
    return `${sanitizeFilenamePart(titleParts.join("-"))}.png`;
  }, [activeYear, comparisonYear, title, viewMode]);

  const getCurrentChartPng = React.useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return null;
    const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    return { filename: exportFilename, dataUrl: url };
  }, [exportFilename]);

  const exportCurrentChartPng = React.useCallback(() => {
    const exported = getCurrentChartPng();
    if (!exported) return null;
    downloadDataUrl(exported.dataUrl, exported.filename);
    return exported.filename;
  }, [getCurrentChartPng]);

  React.useImperativeHandle(ref, () => ({
    exportCurrentChartPng,
    getCurrentChartPng,
  }), [exportCurrentChartPng, getCurrentChartPng]);

  return (
    <div>
      <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 12 }}>
        <Alert
          showIcon
          type={entityMode === "single" ? "info" : "success"}
          message={entityMode === "single" ? "当前为单实体时序模式" : "当前为多实体对比模式"}
          description={
            entityMode === "single"
              ? "这份结果更适合看时间趋势、同比变化、结构雷达和热力图。年度截面与散点图在单实体场景下信息量会明显变少。"
              : "这份结果适合看同年横向比较、Top N 排名和实体之间的关系散点。"
          }
        />
        <Space wrap>
          <Typography.Text strong>图表模式</Typography.Text>
          <Segmented
            value={viewMode}
            onChange={(value) =>
              setViewMode(value as "trend" | "latest" | "delta" | "radar" | "heatmap" | "scatter")
            }
            options={[
              { label: "时间趋势", value: "trend" },
              { label: "年度截面", value: "latest", disabled: entityMode === "single" },
              { label: "同比变化", value: "delta" },
              { label: "结构雷达", value: "radar" },
              { label: "热力图", value: "heatmap" },
              { label: "散点关系", value: "scatter", disabled: entityMode === "single" },
            ]}
          />
          <Typography.Text strong>{viewMode === "radar" ? "主指标参考" : "指标"}</Typography.Text>
          <Select
            style={{ width: 260 }}
            value={metric}
            onChange={setMetric}
            options={metricOptions.map((m) => ({ value: m, label: m }))}
          />
          {viewMode !== "heatmap" && availableYears.length > 0 ? (
            <>
              <Typography.Text strong>分析年份</Typography.Text>
              <Select
                style={{ width: 140 }}
                value={activeYear ?? undefined}
                onChange={setActiveYear}
                options={[...availableYears].reverse().map((year) => ({ value: year, label: `${year}` }))}
              />
            </>
          ) : null}
          {viewMode === "delta" && availableYears.length > 1 ? (
            <>
              <Typography.Text strong>对比年份</Typography.Text>
              <Select
                style={{ width: 140 }}
                value={comparisonYear ?? undefined}
                onChange={setComparisonYear}
                options={[...availableYears]
                  .reverse()
                  .filter((year) => year !== activeYear)
                  .map((year) => ({ value: year, label: `${year}` }))}
              />
            </>
          ) : null}
          {viewMode === "latest" ? (
            <>
              <Typography.Text strong>Top N</Typography.Text>
              <Select
                style={{ width: 120 }}
                value={latestTopN}
                onChange={setLatestTopN}
                options={[5, 8, 10, 15, 20].map((value) => ({ value, label: `前 ${value}` }))}
              />
            </>
          ) : null}
          {viewMode === "scatter" ? (
            <>
              <Typography.Text strong>X 轴</Typography.Text>
              <Select
                style={{ width: 220 }}
                value={scatterXMetric}
                onChange={setScatterXMetric}
                options={metricOptions.map((item) => ({ value: item, label: item }))}
              />
              <Typography.Text strong>Y 轴</Typography.Text>
              <Select
                style={{ width: 220 }}
                value={scatterYMetric}
                onChange={setScatterYMetric}
                options={metricOptions
                  .filter((item) => item !== scatterXMetric)
                  .map((item) => ({ value: item, label: item }))}
              />
            </>
          ) : null}
          <Button
            onClick={() => {
              exportCurrentChartPng();
            }}
          >
            导出 PNG
          </Button>
        </Space>

        <Space wrap align="start">
          <Typography.Text strong>实体检索</Typography.Text>
          <Input
            value={entityQuery}
            onChange={(event) => setEntityQuery(event.target.value)}
            placeholder="按实体名称筛选可选项"
            style={{ width: 260 }}
            allowClear
          />
          <Typography.Text strong>实体（可多选）</Typography.Text>
          <Select
            mode="multiple"
            style={{ width: 460 }}
            value={selectedEntities}
            onChange={setSelectedEntities}
            options={visibleEntityOptions.map((e) => ({ value: e, label: e }))}
            showSearch
            optionFilterProp="label"
            allowClear
          />
        </Space>

        {viewMode === "radar" ? (
          <Typography.Text type="secondary">雷达图会使用当前分析年份的所有 `subindex.*` 分项列做结构对比。</Typography.Text>
        ) : null}
        {viewMode === "trend" ? (
          <Typography.Text type="secondary">趋势图默认保留完整时间轴，实体越少越容易看出拐点。</Typography.Text>
        ) : null}
        {viewMode === "delta" ? (
          <Typography.Text type="secondary">同比变化直接看出本期相对上一期的提升和回落。</Typography.Text>
        ) : null}
        {entityMode === "single" && viewMode === "latest" ? (
          <Typography.Text type="secondary">当前年度只有一个实体，所以这张图主要用于观察该年份绝对值，不适合做横向比较。</Typography.Text>
        ) : null}
        {entityMode === "single" && viewMode === "scatter" ? (
          <Typography.Text type="secondary">单实体场景下散点图只会显示一个点，更推荐切回趋势或热力图看时间变化。</Typography.Text>
        ) : null}
      </Space>
      <ReactECharts ref={chartRef} option={option} notMerge style={{ height: 360 }} />
    </div>
  );
});
