export type Direction = 'higher' | 'lower'

export interface Indicator {
  id: string
  name: string
  kind: 'auto' | 'manual'
  metric: string | null
  unit: string
  direction: Direction
  target: number
  weight: number
  isActive: boolean
  sortOrder: number
}

export interface MetricDef {
  key: string
  label: string
  unit: string
  direction: Direction
  hint: string
  defaultTarget: number
  defaultWeight: number
}

export interface Item {
  id: string
  name: string
  weight: number
  target: number
  direction: Direction
  unit?: string
  value: number | null
  achievement: number | null
  points: number | null
  excluded: boolean
}

export interface Adjustment {
  id: string
  points: number
  bonusDelta: number
  reason: string
  createdAt: string
  createdByName: string | null
}

export interface UserResult {
  userId: string
  fullName: string
  baseScore: number
  adjustmentPoints: number
  score: number
  bonusDelta: number
  bonus: number
  missingCount: number
  items: Item[]
  adjustments: Adjustment[]
}

export interface Scheme { bonusMax: number; minScore: number; capPercent: number }

export interface MonthResults {
  month: string
  status: 'open' | 'closed'
  closedAt: string | null
  scheme: Scheme
  indicators: Indicator[]
  rows: UserResult[]
  totalBonus: number
}

export function errMsg(e: any, fallback = 'Xato yuz berdi'): string {
  return e?.response?.data?.error || fallback
}

/** Qiymatni birlik bilan ko'rsatadi: 12 500 000 so'm, 18 ta, 85 % */
export function fmtValue(v: number | null, unit: string): string {
  if (v === null) return '—'
  const n = Math.round(v * 10) / 10
  const s = n.toLocaleString('en-US').replace(/,/g, ' ')
  return unit ? `${s} ${unit}` : s
}

/** Xom javob tanasi (code/limit/missing kabi qo'shimcha maydonlar uchun). */
export function errBody(e: any): any {
  return e?.response?.data ?? {}
}

export interface MissingEntry { userId: string; fullName: string; missingCount: number; indicators: string[] }

/** Tuzatish chegarasi xatosi (422 ADJUST_LIMIT) uchun tushunarli matn. */
export function adjustLimitMessage(limit: number): string {
  const n = Math.round(limit).toLocaleString('en-US').replace(/,/g, ' ')
  return `Tuzatish chegaradan oshdi: bir tuzatish va oy bo'yicha sof jami ±${n} so'mdan oshmasligi kerak. Summani kamaytiring.`
}
