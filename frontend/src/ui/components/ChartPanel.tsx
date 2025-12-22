import React, { useMemo, useRef } from "react";
import { Button, Select, Space, Typography } from "antd";
import ReactECharts from "echarts-for-react";

type Row = Record<string, any>;

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ChartPanel(props: { rows: Row[]; title: string }) {
  const { rows, title } = props;
  const chartRef = useRef<ReactECharts>(null);

  const entities = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(String(r.entity));
    return Array.from(set).sort();
  }, [rows]);

  const metricOptions = useMemo(() => {
    if (rows.length === 0) return [];
    const cols = Object.keys(rows[0]);
    const metrics = cols.filter((c) => c === "index_0_100" || c.startsWith("subindex."));
    return metrics;
  }, [rows]);

  const [selectedEntities, setSelectedEntities] = React.useState<string[]>(() => (entities[0] ? [entities[0]] : []));
  const [metric, setMetric] = React.useState<string>(() => metricOptions[0] || "index_0_100");

  React.useEffect(() => {
    if (selectedEntities.length === 0 && entities.length > 0) setSelectedEntities([entities[0]]);
  }, [entities, selectedEntities.length]);

  React.useEffect(() => {
    if (!metricOptions.includes(metric) && metricOptions.length > 0) setMetric(metricOptions[0]);
  }, [metricOptions, metric]);

  const seriesData = useMemo(() => {
    if (selectedEntities.length === 0) return { years: [] as number[], series: [] as Array<{ name: string; data: Array<number | null> }> };

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

  const option = useMemo(() => {
    return {
      title: { text: title, left: "center" },
      tooltip: { trigger: "axis" },
      legend: { top: 28 },
      xAxis: { type: "category", data: seriesData.years },
      yAxis: { type: "value" },
      series: seriesData.series.map((s) => ({ name: s.name, type: "line", data: s.data, smooth: true })),
    };
  }, [seriesData, title]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text strong>实体（可多选）</Typography.Text>
        <Select
          mode="multiple"
          style={{ width: 360 }}
          value={selectedEntities}
          onChange={setSelectedEntities}
          options={entities.map((e) => ({ value: e, label: e }))}
        />
        <Typography.Text strong>指标</Typography.Text>
        <Select style={{ width: 260 }} value={metric} onChange={setMetric} options={metricOptions.map((m) => ({ value: m, label: m }))} />
        <Button
          onClick={() => {
            const inst = chartRef.current?.getEchartsInstance();
            if (!inst) return;
            const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
            downloadDataUrl(url, `${title}.png`);
          }}
        >
          导出 PNG
        </Button>
      </Space>
      <ReactECharts ref={chartRef} option={option} style={{ height: 360 }} />
    </div>
  );
}
