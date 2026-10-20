// Shared chart primitives — SVG, token-themed, responsive, accessible.
// Method: dataviz skill (form heuristic → colour by job → validated palette →
// mark specs → hover layer → table twin). See theme.ts for the validator output.

export * from './theme';
export * from './scales';
export * from './aggregate';
export * from './hooks';
export { ChartFrame, DataTable, type DataTableSpec } from './ChartFrame';
export { ChartTooltip, TooltipRow, TooltipTitle } from './Tooltip';
export { Legend, type LegendItem, type LegendShape } from './Legend';
export { Glyph, shapePath } from './Glyph';
export { Sparkline, type SparklineProps } from './Sparkline';
export { StatTile, deltaText, type StatTileProps, type StatDelta } from './StatTile';
export { ProgressRing } from './ProgressRing';
export { AreaChart, pickXLabelIndices, type AreaSeries } from './AreaChart';
export { BarChart, type BarRow, type BarSegment } from './BarChart';
export { Heatmap } from './Heatmap';
export { ReliabilityDiagram, brierVerdict, binLabel, type ReliabilitySeries } from './ReliabilityDiagram';
