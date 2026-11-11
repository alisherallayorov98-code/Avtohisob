import L from 'leaflet'

/**
 * Qarz darajasi — Dashboard va Tashkilotlar sahifasidagi shkala bilan bir xil
 * (ui/tokens.css `--eko-level-*`). Marker va klaster `.eko-app` daraxti ichidagi
 * Leaflet pane'da turadi, shuning uchun CSS o'zgaruvchisi ishlaydi: ranglar
 * bitta manbadan (token) olinadi, qorong'i rejimda ham mos.
 */
export type DebtLevel = 'current' | 'warning' | 'overdue' | 'critical'

export function levelOf(months: number): DebtLevel {
  if (months <= 0) return 'current'
  if (months === 1) return 'warning'
  if (months === 2) return 'overdue'
  return 'critical'
}

const LEVEL_VAR: Record<DebtLevel, string> = {
  current: 'var(--eko-level-0)',
  warning: 'var(--eko-level-1)',
  overdue: 'var(--eko-level-2)',
  critical: 'var(--eko-level-3)',
}
/** CSS rang qiymati (inline style / legend uchun) */
export const levelColor = (lv: DebtLevel) => `rgb(${LEVEL_VAR[lv]})`

export const LEVEL_LABEL: Record<DebtLevel, string> = {
  current: 'Qarzsiz',
  warning: '1 oy qarz',
  overdue: '2 oy qarz',
  critical: '3+ oy qarz',
}

const STATUS_COLOR = {
  blacklisted: 'rgb(var(--eko-level-x))',
  inactive: 'rgb(var(--eko-subtle))',
  draft: 'rgb(var(--eko-warn))',
}

export function ensureMapStyle() {
  if (document.getElementById('eko-marker-style')) return
  const style = document.createElement('style')
  style.id = 'eko-marker-style'
  style.textContent = `
    @keyframes eko-pulse {
      0%   { box-shadow: 0 0 0 0 rgb(var(--eko-level-3) / 0.55); }
      70%  { box-shadow: 0 0 0 12px rgb(var(--eko-level-3) / 0); }
      100% { box-shadow: 0 0 0 0 rgb(var(--eko-level-3) / 0); }
    }
    @media (prefers-reduced-motion: reduce) { .eko-pin.pulse .eko-dot { animation: none !important; } }
    .eko-pin { position: relative; }
    .eko-pin .eko-dot { width:16px; height:16px; border-radius:50%; border:2px solid rgb(var(--eko-surface)); box-shadow:0 1px 5px rgb(0 0 0 / .4); }
    .eko-pin.pulse .eko-dot { animation: eko-pulse 1.6s infinite; }
    .eko-pin .eko-badge {
      position:absolute; top:-9px; right:-10px; min-width:16px; height:16px; padding:0 3px;
      background:rgb(var(--eko-text)); color:rgb(var(--eko-surface)); font-size:12px; font-weight:700; line-height:16px;
      text-align:center; border-radius:8px; border:1.5px solid rgb(var(--eko-surface));
    }
    .leaflet-tooltip.eko-label {
      background:rgb(var(--eko-surface) / .94); border:none; box-shadow:0 1px 3px rgb(0 0 0 / .25);
      font-size:12px; font-weight:600; padding:1px 6px; color:rgb(var(--eko-text));
    }
    .leaflet-tooltip.eko-label::before { display:none; }
    path.eko-heat-1 { stroke: rgb(var(--eko-level-1)); fill: rgb(var(--eko-level-1)); }
    path.eko-heat-2 { stroke: rgb(var(--eko-level-2)); fill: rgb(var(--eko-level-2)); }
    path.eko-heat-3 { stroke: rgb(var(--eko-level-3)); fill: rgb(var(--eko-level-3)); }
    path.eko-route-line { stroke: rgb(var(--eko-text)); }
  `
  document.head.appendChild(style)
}

/** Marker belgisi. Rang — QARZ DARAJASI; talon rejimi kvadrat shaklda. */
export function makeIcon(status: string, debtMonths = 0, billingMode?: string) {
  const level = levelOf(debtMonths)
  const color = status === 'blacklisted' ? STATUS_COLOR.blacklisted
    : status === 'inactive' ? STATUS_COLOR.inactive
    : status === 'draft' ? STATUS_COLOR.draft
    : status === 'paid' ? levelColor('current')
    : levelColor(level)

  const pulse = status === 'unpaid' && level === 'critical' ? 'pulse' : ''
  const shape = billingMode === 'talon' ? 'border-radius:3px' : 'border-radius:50%'
  const badge = status === 'draft'
    ? `<span class="eko-badge">?</span>`
    : (status === 'unpaid' && debtMonths > 1 ? `<span class="eko-badge">${debtMonths}</span>` : '')

  return L.divIcon({
    className: '',
    html: `<div class="eko-pin ${pulse}"><div class="eko-dot" style="background:${color};${shape}"></div>${badge}</div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  })
}

/** Klaster belgisi: rangi ichidagi qarzdorlar ulushiga bog'liq. */
export function makeClusterIcon(cluster: any) {
  const markers = cluster.getAllChildMarkers()
  const total = markers.length
  const unpaid = markers.filter((m: any) => m.options.ekoUnpaid).length
  const ratio = total > 0 ? unpaid / total : 0
  const bg = ratio >= 0.5 ? 'rgb(var(--eko-level-3))'
    : ratio > 0 ? 'rgb(var(--eko-level-2))'
    : 'rgb(var(--eko-level-0))'
  const size = total >= 50 ? 50 : total >= 10 ? 44 : 40
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};
      border:3px solid rgb(var(--eko-surface));display:flex;flex-direction:column;align-items:center;justify-content:center;
      color:#fff;font-weight:700;box-shadow:0 2px 8px rgb(0 0 0 / .3);line-height:1.1;text-shadow:0 1px 2px rgb(0 0 0 / .45)">
      <span style="font-size:13px">${total}</span>
      ${unpaid > 0 ? `<span style="font-size:12px;font-weight:600">${unpaid} qarz</span>` : ''}
    </div>`,
    className: '',
    iconSize: [size, size],
  })
}

export function userLocationIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:rgb(var(--eko-info));border:3px solid rgb(var(--eko-surface));box-shadow:0 0 0 4px rgb(var(--eko-info) / .3),0 2px 6px rgb(0 0 0 / .4)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  })
}
