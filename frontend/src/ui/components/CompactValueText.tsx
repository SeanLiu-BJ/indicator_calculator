import React from "react";
import { Typography } from "antd";

const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("zh-CN", {
  maximumSignificantDigits: 6,
  minimumSignificantDigits: 1,
  useGrouping: false,
});

function isYearLike(column?: string) {
  if (!column) return false;
  return column === "year" || column.endsWith("year");
}

function formatDisplayValue(value: number, column?: string) {
  if (!Number.isFinite(value)) return String(value);
  if (isYearLike(column) || Number.isInteger(value)) {
    return String(value);
  }
  return COMPACT_NUMBER_FORMAT.format(value);
}

function toNumericValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "" && value.trim() === String(numeric)) {
      return numeric;
    }
  }
  return null;
}

export function formatCompactTableValue(value: unknown, column?: string) {
  if (value == null || value === "") {
    return { display: "-", raw: "-" };
  }

  const numericValue = toNumericValue(value);
  if (numericValue !== null) {
    return {
      display: formatDisplayValue(numericValue, column),
      raw: String(value),
    };
  }

  return {
    display: String(value),
    raw: String(value),
  };
}

export function CompactValueText(props: { value: unknown; column?: string }) {
  const { value, column } = props;
  const formatted = React.useMemo(() => formatCompactTableValue(value, column), [value, column]);

  return (
    <Typography.Text title={formatted.raw} style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatted.display}
    </Typography.Text>
  );
}
