/**
 * Diagramma ranglari (recharts sahifalarda qoladi — bu faqat tokenlar).
 * `style={{ stroke: chart.main }}` yoki recharts `stroke={chart.main}` (CSS var
 * qiymati `.eko-app` ichida hal bo'ladi, qorong'i rejimda avtomatik almashadi).
 */
export const chart = {
  main: 'rgb(var(--eko-chart-1))',
  light: 'rgb(var(--eko-chart-2))',
  grid: 'rgb(var(--eko-chart-grid))',
  axis: 'rgb(var(--eko-chart-axis))',
  ref: 'rgb(var(--eko-chart-ref))',
} as const
