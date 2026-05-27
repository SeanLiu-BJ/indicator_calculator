import React from "react";
import { Alert, Button, Card, Col, Empty, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import { DatasetIndicator, ResultDetail, WeightModel } from "../../types";
import { CompactValueText } from "./CompactValueText";

type RowRecord = Record<string, any>;

type SourceDatasetContext = {
  id: string;
  name: string;
  rows: RowRecord[];
  indicators: DatasetIndicator[];
};

type IndicatorContribution = {
  key: string;
  name: string;
  group: string;
  direction: "positive" | "negative";
  rawValue: number;
  standardizedValue: number;
  weight: number;
  contribution: number;
};

const CHART_HEIGHT = 320;
const EXPANDED_CHART_HEIGHT = 620;

type ExpandableChartCardHandle = {
  exportPng: () => string | null;
  getPng: () => { filename: string; dataUrl: string } | null;
};

export type ResultExplanationDashboardHandle = {
  exportAllChartsPng: () => string[];
  collectAllChartsPng: () => Array<{ filename: string; dataUrl: string }>;
};

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_").replace(/_+/g, "_").trim();
}

const ExpandableChartCard = React.forwardRef<ExpandableChartCardHandle, {
  title: string;
  option: Record<string, any> | null;
  emptyText: string;
  height?: number;
  subtitle?: React.ReactNode;
  filenamePrefix?: string;
}>(function ExpandableChartCard(props, ref) {
  const { title, option, emptyText, height = CHART_HEIGHT, subtitle } = props;
  const [open, setOpen] = React.useState(false);
  const chartRef = React.useRef<ReactECharts>(null);
  const filename = React.useMemo(
    () => `${sanitizeFilenamePart([props.filenamePrefix, title].filter(Boolean).join("-"))}.png`,
    [props.filenamePrefix, title],
  );

  const getPng = React.useCallback(() => {
    if (!option) return null;
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart) return null;
    const dataUrl = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    return { filename, dataUrl };
  }, [filename, option]);

  const exportPng = React.useCallback(() => {
    const exported = getPng();
    if (!exported) return null;
    downloadDataUrl(exported.dataUrl, exported.filename);
    return exported.filename;
  }, [getPng]);

  React.useImperativeHandle(ref, () => ({
    exportPng,
    getPng,
  }), [exportPng, getPng]);

  return (
    <>
      <Card
        title={title}
        size="small"
        extra={
          option ? (
            <Space size={8}>
              <Button size="small" onClick={() => exportPng()}>
                导出 PNG
              </Button>
              <Button size="small" onClick={() => setOpen(true)}>
                展开大图
              </Button>
            </Space>
          ) : null
        }
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {subtitle}
          {option ? <ReactECharts ref={chartRef} option={option} style={{ height }} /> : <Empty description={emptyText} />}
        </Space>
      </Card>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="88vw"
        style={{ top: 24 }}
        title={title}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {subtitle}
          {option ? <ReactECharts option={option} style={{ height: EXPANDED_CHART_HEIGHT }} /> : <Empty description={emptyText} />}
        </Space>
      </Modal>
    </>
  );
});

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatGroupName(group: string) {
  return group.replace(/^subindex\./, "").replace(/_0_100$/, "");
}

function buildGroupColumnName(group: string) {
  return `subindex.${group}_0_100`;
}

function normalizeMetricLabel(metric: string) {
  return metric
    .replace(/^subindex\./, "")
    .replace(/_0_100$/, "")
    .replace(/_/g, " ");
}

function applyDirection(value: number, direction: "positive" | "negative") {
  return direction === "negative" ? -value : value;
}

function standardizeValue(
  model: WeightModel,
  indicatorKey: string,
  rawValue: number,
  direction: "positive" | "negative",
) {
  const directedValue = applyDirection(rawValue, direction);
  const standardization = model.standardization || {};
  if (standardization.kind === "minmax") {
    const min = Number(standardization.min?.[indicatorKey]);
    const max = Number(standardization.max?.[indicatorKey]);
    const denom = max - min;
    if (!Number.isFinite(min) || !Number.isFinite(max) || denom === 0) return 0;
    return (directedValue - min) / denom;
  }
  if (standardization.kind === "zscore") {
    const mean = Number(standardization.mean?.[indicatorKey]);
    const std = Number(standardization.std?.[indicatorKey]);
    if (!Number.isFinite(mean) || !Number.isFinite(std) || std === 0) return 0;
    return (directedValue - mean) / std;
  }
  return directedValue;
}

function buildSummaryCards(rows: RowRecord[], groupColumns: string[], selectedYear: number | null) {
  const years = Array.from(new Set(rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year)))).sort((a, b) => a - b);
  const activeYear = selectedYear ?? years.at(-1) ?? null;
  const previousYear = activeYear != null ? years.filter((year) => year < activeYear).at(-1) ?? null : null;

  const latestRows = activeYear == null ? [] : rows.filter((row) => Number(row.year) === activeYear);
  const previousRows = previousYear == null ? [] : rows.filter((row) => Number(row.year) === previousYear);

  const latestIndex = average(latestRows.map((row) => Number(row.index_0_100 ?? 0)));
  const previousIndex = average(previousRows.map((row) => Number(row.index_0_100 ?? 0)));
  const yearChange = activeYear != null && previousYear != null ? latestIndex - previousIndex : 0;

  const groupStats = groupColumns.map((column) => ({
    name: formatGroupName(column),
    value: average(latestRows.map((row) => Number(row[column] ?? 0))),
  }));
  const sortedGroups = [...groupStats].sort((left, right) => right.value - left.value);

  return {
    years,
    activeYear,
    previousYear,
    latestRows,
    latestIndex,
    previousIndex,
    yearChange,
    strongestGroup: sortedGroups[0] ?? null,
    weakestGroup: sortedGroups.at(-1) ?? null,
  };
}

function buildGroupTrend(rows: RowRecord[], groupColumns: string[]) {
  const years = Array.from(new Set(rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year)))).sort((a, b) => a - b);
  const groups = groupColumns.map((column) => ({
    column,
    label: formatGroupName(column),
    values: years.map((year) => {
      const scoped = rows.filter((row) => Number(row.year) === year);
      return average(scoped.map((row) => Number(row[column] ?? 0)));
    }),
  }));

  return { years, groups };
}

function buildGroupDelta(
  rows: RowRecord[],
  groupColumns: string[],
  activeYear: number | null,
  previousYear: number | null,
) {
  if (activeYear == null || previousYear == null) {
    return {
      labels: [] as string[],
      currentValues: [] as number[],
      previousValues: [] as number[],
      deltaValues: [] as number[],
      activeYear,
      previousYear,
    };
  }

  const currentRows = rows.filter((row) => Number(row.year) === activeYear);
  const previousRows = rows.filter((row) => Number(row.year) === previousYear);
  const labels = groupColumns.map((column) => formatGroupName(column));
  const currentValues = groupColumns.map((column) => average(currentRows.map((row) => Number(row[column] ?? 0))));
  const previousValues = groupColumns.map((column) => average(previousRows.map((row) => Number(row[column] ?? 0))));
  const deltaValues = currentValues.map((value, index) => value - previousValues[index]);

  return {
    labels,
    currentValues,
    previousValues,
    deltaValues,
    activeYear,
    previousYear,
  };
}

function buildOverallTrend(rows: RowRecord[]) {
  const years = Array.from(new Set(rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year)))).sort((a, b) => a - b);
  return {
    years,
    values: years.map((year) => {
      const scoped = rows.filter((row) => Number(row.year) === year);
      return average(scoped.map((row) => Number(row.index_0_100 ?? 0)));
    }),
  };
}

function buildGroupHeatmap(rows: RowRecord[], groupColumns: string[]) {
  const years = Array.from(new Set(rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year)))).sort((a, b) => a - b);
  const groups = groupColumns.map((column) => formatGroupName(column));
  const values: Array<[number, number, number]> = [];

  groupColumns.forEach((column, rowIndex) => {
    years.forEach((year, colIndex) => {
      const scoped = rows.filter((row) => Number(row.year) === year);
      values.push([colIndex, rowIndex, average(scoped.map((row) => Number(row[column] ?? 0)))]);
    });
  });

  return { years, groups, values };
}

function findSourceMatch(
  datasets: SourceDatasetContext[],
  entity: string,
  year: number,
) {
  const matches = datasets.flatMap((dataset) => {
    const row = dataset.rows.find((item) => String(item.entity) === entity && Number(item.year) === year);
    return row ? [{ dataset, row }] : [];
  });
  return matches;
}

export const ResultExplanationDashboard = React.forwardRef<ResultExplanationDashboardHandle, {
  result: ResultDetail;
  rows: RowRecord[];
  model: WeightModel | null;
  sourceDatasets: SourceDatasetContext[];
}>(function ResultExplanationDashboard(props, ref) {
  const { result, rows, model, sourceDatasets } = props;
  const availableYears = React.useMemo(
    () => Array.from(new Set(rows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year)))).sort((a, b) => a - b),
    [rows],
  );
  const groupColumns = React.useMemo(
    () => Object.keys(rows[0] || {}).filter((column) => column.startsWith("subindex.")),
    [rows],
  );
  const entityMode = React.useMemo(() => {
    const entities = new Set(rows.map((row) => String(row.entity ?? "")).filter(Boolean));
    return entities.size <= 1 ? "single" : "multi";
  }, [rows]);
  const [selectedYear, setSelectedYear] = React.useState<number | null>(availableYears.at(-1) ?? null);
  const [selectedEntity, setSelectedEntity] = React.useState<string>("");
  const [selectedGroup, setSelectedGroup] = React.useState<string>("all");
  const overviewPrimaryChartRef = React.useRef<ExpandableChartCardHandle>(null);
  const overviewTrendChartRef = React.useRef<ExpandableChartCardHandle>(null);
  const groupHeatmapChartRef = React.useRef<ExpandableChartCardHandle>(null);
  const contributionChartRef = React.useRef<ExpandableChartCardHandle>(null);
  const indicatorHeatmapChartRef = React.useRef<ExpandableChartCardHandle>(null);
  const weightChartRef = React.useRef<ExpandableChartCardHandle>(null);
  const exportPrefix = React.useMemo(
    () =>
      sanitizeFilenamePart(
        [result.name, selectedEntity || "全部对象", selectedYear != null ? `${selectedYear}` : ""]
          .filter(Boolean)
          .join("-"),
      ),
    [result.name, selectedEntity, selectedYear],
  );
  const summary = React.useMemo(() => buildSummaryCards(rows, groupColumns, selectedYear), [groupColumns, rows, selectedYear]);

  React.useEffect(() => {
    if (!availableYears.length) {
      setSelectedYear(null);
      return;
    }
    setSelectedYear((current) => (current != null && availableYears.includes(current) ? current : availableYears.at(-1) ?? null));
  }, [availableYears]);

  const entityOptions = React.useMemo(() => {
    if (selectedYear == null) return [];
    return rows
      .filter((row) => Number(row.year) === selectedYear)
      .map((row) => ({
        label: String(row.entity),
        value: String(row.entity),
        index: Number(row.index_0_100 ?? 0),
      }))
      .sort((left, right) => right.index - left.index);
  }, [rows, selectedYear]);

  React.useEffect(() => {
    if (!entityOptions.length) {
      setSelectedEntity("");
      return;
    }
    if (!entityOptions.some((item) => item.value === selectedEntity)) {
      setSelectedEntity(entityOptions[0].value);
    }
  }, [entityOptions, selectedEntity]);

  const groupTrend = React.useMemo(() => buildGroupTrend(rows, groupColumns), [groupColumns, rows]);
  const groupDelta = React.useMemo(
    () => buildGroupDelta(rows, groupColumns, summary.activeYear, summary.previousYear),
    [groupColumns, rows, summary.activeYear, summary.previousYear],
  );
  const overallTrend = React.useMemo(() => buildOverallTrend(rows), [rows]);
  const groupHeatmap = React.useMemo(() => buildGroupHeatmap(rows, groupColumns), [groupColumns, rows]);

  const latestGroupBarOption = React.useMemo(() => {
    if (summary.activeYear == null) return null;
    const scopedRows = rows.filter((row) => Number(row.year) === summary.activeYear);
    const items = groupColumns.map((column) => ({
      label: formatGroupName(column),
      value: average(scopedRows.map((row) => Number(row[column] ?? 0))),
    }));
    return {
      tooltip: { trigger: "axis" },
      grid: { top: 32, left: 48, right: 20, bottom: 48, containLabel: true },
      xAxis: { type: "value", max: 100 },
      yAxis: { type: "category", data: items.map((item) => item.label) },
      series: [
        {
          type: "bar",
          data: items.map((item) => Number(item.value.toFixed(2))),
          itemStyle: { color: "#1677ff" },
          label: { show: true, position: "right", formatter: "{c}" },
        },
      ],
    };
  }, [groupColumns, rows, summary.activeYear]);

  const groupDeltaOption = React.useMemo(() => {
    if (!groupDelta.labels.length || groupDelta.activeYear == null || groupDelta.previousYear == null) return null;
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; marker: string; seriesName: string; data: number }>) =>
          [`${params[0]?.axisValue ?? ""}`, ...params.map((item) => `${item.marker}${item.seriesName}: ${item.data.toFixed(2)}`)].join("<br/>"),
      },
      legend: { top: 4 },
      grid: { top: 48, left: 48, right: 20, bottom: 48, containLabel: true },
      xAxis: {
        type: "category",
        data: groupDelta.labels,
        axisLabel: { interval: 0, rotate: groupDelta.labels.length > 4 ? 16 : 0 },
      },
      yAxis: { type: "value" },
      series: [
        {
          name: `${groupDelta.previousYear}`,
          type: "bar",
          data: groupDelta.previousValues.map((value) => Number(value.toFixed(2))),
          itemStyle: { color: "#91caff" },
        },
        {
          name: `${groupDelta.activeYear}`,
          type: "bar",
          data: groupDelta.currentValues.map((value) => Number(value.toFixed(2))),
          itemStyle: { color: "#1677ff" },
        },
        {
          name: "变化值",
          type: "line",
          yAxisIndex: 0,
          data: groupDelta.deltaValues.map((value) => Number(value.toFixed(2))),
          itemStyle: { color: "#52c41a" },
          lineStyle: { width: 3 },
        },
      ],
    };
  }, [
    groupDelta.activeYear,
    groupDelta.currentValues,
    groupDelta.deltaValues,
    groupDelta.labels,
    groupDelta.previousValues,
    groupDelta.previousYear,
  ]);

  const groupTrendOption = React.useMemo(() => {
    if (!groupTrend.years.length) return null;
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 4 },
      grid: { top: 48, left: 48, right: 20, bottom: 36, containLabel: true },
      xAxis: { type: "category", data: groupTrend.years },
      yAxis: { type: "value", max: 100 },
      series: groupTrend.groups.map((group) => ({
        name: group.label,
        type: "line",
        smooth: true,
        data: group.values.map((value) => Number(value.toFixed(2))),
      })),
    };
  }, [groupTrend.groups, groupTrend.years]);

  const overallTrendOption = React.useMemo(() => {
    if (!overallTrend.years.length) return null;
    return {
      tooltip: { trigger: "axis" },
      grid: { top: 32, left: 48, right: 20, bottom: 36, containLabel: true },
      xAxis: { type: "category", data: overallTrend.years },
      yAxis: { type: "value", max: 100 },
      series: [
        {
          name: "综合指数",
          type: "line",
          smooth: true,
          areaStyle: { opacity: 0.12 },
          data: overallTrend.values.map((value) => Number(value.toFixed(2))),
          itemStyle: { color: "#1677ff" },
        },
      ],
    };
  }, [overallTrend.years, overallTrend.values]);

  const groupHeatmapOption = React.useMemo(() => {
    if (!groupHeatmap.years.length || !groupHeatmap.groups.length) return null;
    return {
      tooltip: {
        formatter: ({ value }: { value: [number, number, number] }) =>
          `${groupHeatmap.groups[value[1]]}<br/>${groupHeatmap.years[value[0]]}: ${value[2].toFixed(2)}`,
      },
      grid: { top: 24, left: 140, right: 18, bottom: 50, containLabel: true },
      xAxis: { type: "category", data: groupHeatmap.years },
      yAxis: { type: "category", data: groupHeatmap.groups },
      visualMap: {
        min: 0,
        max: 100,
        orient: "horizontal",
        left: "center",
        bottom: 0,
      },
      series: [
        {
          type: "heatmap",
          data: groupHeatmap.values,
          label: {
            show: true,
            formatter: ({ value }: { value: [number, number, number] }) => value[2].toFixed(1),
          },
        },
      ],
    };
  }, [groupHeatmap.groups, groupHeatmap.values, groupHeatmap.years]);

  const focusMatches = React.useMemo(() => {
    if (!selectedEntity || selectedYear == null) return [];
    return findSourceMatch(sourceDatasets, selectedEntity, selectedYear);
  }, [selectedEntity, selectedYear, sourceDatasets]);

  const focusSourceDataset = focusMatches[0]?.dataset ?? null;
  const focusSourceRow = focusMatches[0]?.row ?? null;

  const indicatorContributions = React.useMemo<IndicatorContribution[]>(() => {
    if (!model || !focusSourceDataset || !focusSourceRow) return [];
    const indicatorMap = new Map(
      focusSourceDataset.indicators
        .filter((indicator) => model.indicatorKeys.includes(indicator.key))
        .map((indicator) => [indicator.key, indicator] as const),
    );

    return model.indicatorKeys
      .map((key) => {
        const indicator = indicatorMap.get(key);
        if (!indicator) return null;
        const rawValue = Number(focusSourceRow[indicator.sourceColumn]);
        if (!Number.isFinite(rawValue)) return null;
        const standardizedValue = standardizeValue(model, key, rawValue, indicator.direction);
        const weight = Number(model.weights[key] ?? 0);
        return {
          key,
          name: indicator.name,
          group: indicator.dimension2Key || "default",
          direction: indicator.direction,
          rawValue,
          standardizedValue,
          weight,
          contribution: standardizedValue * weight,
        };
      })
      .filter((item): item is IndicatorContribution => item !== null)
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  }, [focusSourceDataset, focusSourceRow, model]);

  const groupOptions = React.useMemo(
    () => ["all", ...Array.from(new Set(indicatorContributions.map((item) => item.group)))],
    [indicatorContributions],
  );

  React.useEffect(() => {
    if (!groupOptions.includes(selectedGroup)) {
      setSelectedGroup("all");
    }
  }, [groupOptions, selectedGroup]);

  const visibleContributions = React.useMemo(
    () =>
      indicatorContributions.filter((item) => selectedGroup === "all" || item.group === selectedGroup),
    [indicatorContributions, selectedGroup],
  );

  const contributionBarOption = React.useMemo(() => {
    const items = visibleContributions.slice(0, 12).reverse();
    if (!items.length) return null;
    return {
      tooltip: {
        formatter: ({ name, value }: { name: string; value: number }) => `${name}<br/>贡献值：${value.toFixed(4)}`,
      },
      grid: { top: 24, left: 180, right: 20, bottom: 24, containLabel: true },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: items.map((item) => item.name) },
      series: [
        {
          type: "bar",
          data: items.map((item) => Number(item.contribution.toFixed(4))),
          itemStyle: {
            color: (params: { value: number }) => (params.value >= 0 ? "#52c41a" : "#ff4d4f"),
          },
        },
      ],
    };
  }, [visibleContributions]);

  const indicatorHeatmapOption = React.useMemo(() => {
    if (!model || !selectedEntity || !visibleContributions.length) return null;
    const years = summary.years;
    const indicators = visibleContributions.map((item) => item.name);
    const values: Array<[number, number, number]> = [];

    visibleContributions.forEach((item, rowIndex) => {
      years.forEach((year, colIndex) => {
        const match = findSourceMatch(sourceDatasets, selectedEntity, year)[0];
        if (!match) {
          values.push([colIndex, rowIndex, 0]);
          return;
        }
        const sourceIndicator = match.dataset.indicators.find((indicator) => indicator.key === item.key);
        if (!sourceIndicator) {
          values.push([colIndex, rowIndex, 0]);
          return;
        }
        const rawValue = Number(match.row[sourceIndicator.sourceColumn]);
        const standardized = Number.isFinite(rawValue)
          ? standardizeValue(model, item.key, rawValue, sourceIndicator.direction)
          : 0;
        values.push([colIndex, rowIndex, Number(standardized.toFixed(3))]);
      });
    });

    return {
      tooltip: {
        formatter: ({ value }: { value: [number, number, number] }) =>
          `${indicators[value[1]]}<br/>${years[value[0]]}: ${value[2].toFixed(3)}`,
      },
      grid: { top: 24, left: 180, right: 18, bottom: 50, containLabel: true },
      xAxis: { type: "category", data: years },
      yAxis: { type: "category", data: indicators },
      visualMap: {
        min: -3,
        max: 3,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
      },
      series: [
        {
          type: "heatmap",
          data: values,
          label: {
            show: true,
            formatter: ({ value }: { value: [number, number, number] }) => value[2].toFixed(2),
          },
        },
      ],
    };
  }, [model, selectedEntity, sourceDatasets, summary.years, visibleContributions]);

  const weightBarOption = React.useMemo(() => {
    if (!model || !indicatorContributions.length) return null;
    const items = [...indicatorContributions]
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 12)
      .reverse();
    return {
      tooltip: {
        formatter: ({ name, value }: { name: string; value: number }) => `${name}<br/>权重：${formatPercent(value * 100)}`,
      },
      grid: { top: 24, left: 180, right: 18, bottom: 24, containLabel: true },
      xAxis: { type: "value", max: Math.max(...items.map((item) => item.weight), 0.2) },
      yAxis: { type: "category", data: items.map((item) => item.name) },
      series: [{ type: "bar", data: items.map((item) => Number(item.weight.toFixed(4))), itemStyle: { color: "#722ed1" } }],
    };
  }, [indicatorContributions, model]);

  const topWeightShare = React.useMemo(() => {
    if (!model) return 0;
    return Object.values(model.weights)
      .sort((left, right) => right - left)
      .slice(0, 3)
      .reduce((sum, value) => sum + value, 0);
  }, [model]);

  const collectAllChartsPng = React.useCallback(() => {
    return [
      overviewPrimaryChartRef.current?.getPng(),
      overviewTrendChartRef.current?.getPng(),
      groupHeatmapChartRef.current?.getPng(),
      contributionChartRef.current?.getPng(),
      indicatorHeatmapChartRef.current?.getPng(),
      weightChartRef.current?.getPng(),
    ].filter((item): item is { filename: string; dataUrl: string } => Boolean(item));
  }, []);

  const exportAllChartsPng = React.useCallback(() => {
    const filenames = collectAllChartsPng().map((item) => {
      downloadDataUrl(item.dataUrl, item.filename);
      return item.filename;
    });
    return filenames;
  }, [collectAllChartsPng]);

  React.useImperativeHandle(ref, () => ({
    exportAllChartsPng,
    collectAllChartsPng,
  }), [collectAllChartsPng, exportAllChartsPng]);

  if (!rows.length) {
    return <Empty description="当前结果还没有可解释的数据。" />;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card size="small" title="解释视角">
        <Space wrap>
          <Typography.Text strong>分析年份</Typography.Text>
          <Select
            style={{ width: 140 }}
            value={selectedYear ?? undefined}
            onChange={setSelectedYear}
            options={availableYears.map((year) => ({ value: year, label: `${year}` }))}
          />
          <Typography.Text type="secondary">
            当前切换会联动总览、一级拆解和二级诊断。
          </Typography.Text>
        </Space>
      </Card>
      <Tabs
        items={[
        {
          key: "overview",
          label: "总览",
          forceRender: true,
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Row gutter={[16, 16]}>
                <Col span={6}>
                  <Card>
                    <Statistic title={`综合指数（${summary.activeYear ?? "-"}）`} value={summary.latestIndex} precision={2} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic
                      title={summary.previousYear ? `较 ${summary.previousYear} 变化` : "年度变化"}
                      value={summary.yearChange}
                      precision={2}
                      valueStyle={{ color: summary.yearChange >= 0 ? "#389e0d" : "#cf1322" }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic title="最强一级维度" value={summary.strongestGroup?.name || "-"} />
                    <Typography.Text type="secondary">
                      {summary.strongestGroup ? `${summary.strongestGroup.value.toFixed(2)} 分` : "暂无"}
                    </Typography.Text>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic title="最弱一级维度" value={summary.weakestGroup?.name || "-"} />
                    <Typography.Text type="secondary">
                      {summary.weakestGroup ? `${summary.weakestGroup.value.toFixed(2)} 分` : "暂无"}
                    </Typography.Text>
                  </Card>
                </Col>
              </Row>
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  {entityMode === "single" ? (
                    <ExpandableChartCard
                      ref={overviewPrimaryChartRef}
                      title="一级维度较上一期变化"
                      option={groupDeltaOption || overallTrendOption}
                      emptyText="暂无一级维度变化数据"
                      filenamePrefix={exportPrefix}
                      subtitle={
                        <Typography.Text type="secondary">
                          {groupDeltaOption && summary.previousYear != null && summary.activeYear != null
                            ? `当前只有一个实体，这里默认展示 ${summary.previousYear} 到 ${summary.activeYear} 各一级维度的变化，而不是没有区分度的同年满分截面。`
                            : "当前只有一个实体，默认优先展示跨年份变化，而不是同年横向比较。"}
                        </Typography.Text>
                      }
                    />
                  ) : (
                    <ExpandableChartCard
                      ref={overviewPrimaryChartRef}
                      title="一级维度当前截面"
                      option={latestGroupBarOption}
                      emptyText="暂无一级维度数据"
                      filenamePrefix={exportPrefix}
                    />
                  )}
                </Col>
                <Col span={12}>
                  <ExpandableChartCard
                    ref={overviewTrendChartRef}
                    title={entityMode === "single" ? "一级维度时间趋势" : "一级维度趋势"}
                    option={groupTrendOption}
                    emptyText="暂无趋势数据"
                    filenamePrefix={exportPrefix}
                    subtitle={
                      entityMode === "single" ? (
                        <Typography.Text type="secondary">
                          这张图最适合回答“哪个一级维度在持续改善，哪个维度在拖后腿”。
                        </Typography.Text>
                      ) : undefined
                    }
                  />
                </Col>
              </Row>
              <Alert
                showIcon
                type="info"
                message={entityMode === "single" ? "单实体时序解读建议" : "多实体结果解读建议"}
                description={
                  entityMode === "single"
                    ? `当前结果来自 ${result.datasetIds.length} 个数据集，但只有一个核心实体。建议优先看综合指数时间趋势、一级维度趋势，再切到“二级诊断”查看具体哪些指标在不同年份拉高或拖低结果。`
                    : `当前结果来自 ${result.datasetIds.length} 个数据集，${groupColumns.length} 个一级维度。建议先看最强/最弱维度，再切到“二级诊断”看具体指标为什么会拉高或拖低结果。`
                }
              />
            </Space>
          ),
        },
        {
          key: "groups",
          label: "一级拆解",
          forceRender: true,
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <ExpandableChartCard
                ref={groupHeatmapChartRef}
                title={entityMode === "single" ? "一级维度时间热力图" : "一级维度热力图"}
                option={groupHeatmapOption}
                emptyText="暂无热力图数据"
                height={CHART_HEIGHT + 20}
                filenamePrefix={exportPrefix}
                subtitle={
                  entityMode === "single" ? (
                    <Typography.Text type="secondary">
                      单实体模式下，这张图用来观察每个一级维度在不同年份是持续改善还是出现回落。
                    </Typography.Text>
                  ) : undefined
                }
              />
              <Card title="一级维度权重" size="small">
                <Space wrap>
                  {model
                    ? Object.entries(model.dimension2Weights)
                        .sort((left, right) => right[1] - left[1])
                        .map(([group, value]) => (
                          <Tag key={group} color="blue">
                            {group}：{formatPercent(value * 100)}
                          </Tag>
                        ))
                    : <Typography.Text type="secondary">当前结果还没有关联到模型信息。</Typography.Text>}
                </Space>
              </Card>
            </Space>
          ),
        },
        {
          key: "indicators",
          label: "二级诊断",
          forceRender: true,
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Card size="small" title="钻取控制台">
                <Space wrap>
                  <Typography.Text strong>分析年份</Typography.Text>
                  <Select
                    style={{ width: 140 }}
                    value={selectedYear ?? undefined}
                    onChange={setSelectedYear}
                    options={availableYears.map((year) => ({ value: year, label: `${year}` }))}
                  />
                  <Typography.Text strong>对象</Typography.Text>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ width: 260 }}
                    value={selectedEntity || undefined}
                    onChange={setSelectedEntity}
                    options={entityOptions.map((item) => ({ value: item.value, label: item.label }))}
                  />
                  <Typography.Text strong>一级分组</Typography.Text>
                  <Select
                    style={{ width: 280 }}
                    value={selectedGroup}
                    onChange={setSelectedGroup}
                    options={groupOptions.map((group) => ({
                      value: group,
                      label: group === "all" ? "全部一级分组" : group,
                    }))}
                  />
                </Space>
                {focusMatches.length > 1 ? (
                  <Alert
                    style={{ marginTop: 12 }}
                    type="warning"
                    showIcon
                    message="发现多个同名实体/年份来源"
                    description={`当前解释先使用数据集「${focusSourceDataset?.name || "-"}」的匹配行。后续如果多数据集并行计算增多，建议把 sourceDatasetId 一并写进结果集。`}
                  />
                ) : null}
                {!focusSourceRow ? (
                  <Alert
                    style={{ marginTop: 12 }}
                    type="error"
                    showIcon
                    message="没有找到对应原始行"
                    description="当前结果行可以展示总分，但缺少同名实体/年份的原始数据，暂时无法展开二级指标解释。"
                  />
                ) : null}
              </Card>
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <ExpandableChartCard
                    ref={contributionChartRef}
                    title="当前年份二级贡献榜"
                    option={contributionBarOption}
                    emptyText="当前分组还没有可解释的二级指标"
                    height={CHART_HEIGHT + 40}
                    filenamePrefix={exportPrefix}
                    subtitle={
                      selectedEntity ? (
                        <Typography.Text type="secondary">
                          当前对象：{selectedEntity}，分组：{selectedGroup === "all" ? "全部一级分组" : selectedGroup}
                        </Typography.Text>
                      ) : null
                    }
                  />
                </Col>
                <Col span={12}>
                  <ExpandableChartCard
                    ref={indicatorHeatmapChartRef}
                    title="二级指标时间热力图"
                    option={indicatorHeatmapOption}
                    emptyText="切换对象或分组后可查看二级指标的时间变化"
                    height={CHART_HEIGHT + 40}
                    filenamePrefix={exportPrefix}
                    subtitle={
                      selectedEntity ? (
                        <Typography.Text type="secondary">
                          当前对象：{selectedEntity}，会展示二级指标在不同年份的标准化变化。
                        </Typography.Text>
                      ) : null
                    }
                  />
                </Col>
              </Row>
              <Card title="二级指标解释表" size="small">
                <Table
                  rowKey="key"
                  size="small"
                  pagination={{ pageSize: 8 }}
                  dataSource={visibleContributions}
                  columns={[
                    { title: "二级指标", dataIndex: "name", key: "name", width: 220 },
                    { title: "一级分组", dataIndex: "group", key: "group", width: 180 },
                    {
                      title: "方向",
                      dataIndex: "direction",
                      key: "direction",
                      width: 100,
                      render: (value: "positive" | "negative") => (
                        <Tag color={value === "positive" ? "green" : "red"}>{value === "positive" ? "正向" : "负向"}</Tag>
                      ),
                    },
                    {
                      title: "原始值",
                      dataIndex: "rawValue",
                      key: "rawValue",
                      render: (value: number) => <CompactValueText value={value} column="raw" />,
                    },
                    {
                      title: "标准化值",
                      dataIndex: "standardizedValue",
                      key: "standardizedValue",
                      render: (value: number) => <CompactValueText value={value} column="standardized" />,
                    },
                    {
                      title: "权重",
                      dataIndex: "weight",
                      key: "weight",
                      render: (value: number) => `${(value * 100).toFixed(2)}%`,
                    },
                    {
                      title: "贡献值",
                      dataIndex: "contribution",
                      key: "contribution",
                      render: (value: number) => <CompactValueText value={value} column="contribution" />,
                    },
                  ]}
                />
              </Card>
            </Space>
          ),
        },
        {
          key: "method",
          label: "方法解释",
          forceRender: true,
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Row gutter={[16, 16]}>
                <Col span={6}>
                  <Card>
                    <Statistic title="方法" value={model?.method === "entropy" ? "熵权法" : model?.method === "pca" ? "PCA" : model?.method === "ahp" ? "AHP" : "-"} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic title="指标数量" value={model?.indicatorKeys.length ?? 0} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic title="一级维度数量" value={Object.keys(model?.dimension2Weights || {}).length} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic title="前三权重集中度" value={topWeightShare * 100} precision={2} suffix="%" />
                  </Card>
                </Col>
              </Row>
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <ExpandableChartCard
                    ref={weightChartRef}
                    title="指标权重 Top 12"
                    option={weightBarOption}
                    emptyText="暂无权重信息"
                    height={CHART_HEIGHT + 20}
                    filenamePrefix={exportPrefix}
                  />
                </Col>
                <Col span={12}>
                  <Card title="模型解释" size="small">
                    {model ? (
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <Alert
                          type="info"
                          showIcon
                          message="如何读这份结果"
                          description={
                            model.method === "entropy"
                              ? "熵权法更强调样本之间差异大的指标，变化越有区分度，权重通常越高。"
                              : model.method === "pca"
                                ? "PCA 更关注主成分解释力，适合看哪些指标共同构成了主要差异。"
                                : "AHP 的权重来自人工判断矩阵，结果更偏向专家主观偏好。"
                          }
                        />
                        <Typography.Text type="secondary">
                          标准化方式：{model.standardization?.kind === "minmax" ? "Min-Max" : model.standardization?.kind === "zscore" ? "Z-Score" : "-"}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          训练数据集：{model.trainedOnDatasetIds.length} 个
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          当前结果集：{result.name}
                        </Typography.Text>
                      </Space>
                    ) : (
                      <Empty description="当前结果还没有模型信息。" />
                    )}
                  </Card>
                </Col>
              </Row>
            </Space>
          ),
        },
        ]}
      />
    </Space>
  );
});
