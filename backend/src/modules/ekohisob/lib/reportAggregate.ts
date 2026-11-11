// EkoHisob — hisobot agregatlarining sof mantiqi (DB'siz, testlanadi).
//
// "Majburiyat" (obligation) modeli: tashkilotning OY uchun majburiyati — shu oyning
// hisobi (charge) + shu oydagi talonlar (+ joriy oy uchun hali hisoblanmagan belgilangan oylik).
// Hamma ko'rsatkich (to'lov foizi, kutilgan, yopilgan, qoldiq) BIR XIL qatorlardan olinadi,
// shuning uchun:  yopilgan + qoldiq == kutilgan  (har oy, har tuman).

import { payRate } from './reportMath'

/** SQL'dan keladigan bitta (oy × tuman × mahalla) qatori — tashkilot darajasida yig'ilgan. */
export interface ObligationRow {
  month: string
  districtId: string
  mahallId: string | null
  /** majburiyati bor tashkilotlar */
  obliged: number
  /** majburiyatini TO'LIQ yopganlar (applied >= expected) */
  settled: number
  /** qisman yopganlar (0 < applied < expected) */
  partial: number
  /** kutilgan summa (hisob + talon [+ hisoblanmagan oylik]) */
  expected: number
  /** shundan yopilgan (har tashkilot bo'yicha min(to'langan, kutilgan)) */
  applied: number
  /** kutilganning hisob qismi (talon qismi = expected − expectedCharge) */
  expectedCharge: number
}

export interface ObligationTotals {
  obliged: number
  settled: number
  partial: number
  expected: number
  applied: number
  remaining: number
  expectedCharge: number
  expectedTalon: number
}

const n0 = (v: unknown): number => {
  const x = Math.round(Number(v))
  return Number.isFinite(x) ? x : 0
}

export function emptyTotals(): ObligationTotals {
  return { obliged: 0, settled: 0, partial: 0, expected: 0, applied: 0, remaining: 0, expectedCharge: 0, expectedTalon: 0 }
}

export function sumObligations(
  rows: ObligationRow[],
  pick: (r: ObligationRow) => boolean = () => true,
): ObligationTotals {
  const t = emptyTotals()
  for (const r of rows) {
    if (!pick(r)) continue
    t.obliged += n0(r.obliged)
    t.settled += n0(r.settled)
    t.partial += n0(r.partial)
    t.expected += n0(r.expected)
    t.applied += n0(r.applied)
    t.expectedCharge += n0(r.expectedCharge)
  }
  t.remaining = Math.max(0, t.expected - t.applied)
  t.expectedTalon = Math.max(0, t.expected - t.expectedCharge)
  return t
}

/** Oy bo'yicha jamilar (oyma-oy hisobot uchun). */
export function totalsByMonth(rows: ObligationRow[], months: string[]): Map<string, ObligationTotals> {
  const out = new Map<string, ObligationTotals>()
  for (const m of months) out.set(m, sumObligations(rows, r => r.month === m))
  return out
}

/** Tuman bo'yicha jamilar (bitta oy). */
export function totalsByDistrict(rows: ObligationRow[], month: string): Map<string, ObligationTotals> {
  const ids = new Set(rows.filter(r => r.month === month).map(r => r.districtId))
  const out = new Map<string, ObligationTotals>()
  for (const id of ids) out.set(id, sumObligations(rows, r => r.month === month && r.districtId === id))
  return out
}

/** Mahalla bo'yicha jamilar (bitta oy, bitta tuman). Mahallasiz — null kalit. */
export function totalsByMahalla(
  rows: ObligationRow[], month: string, districtId: string,
): Map<string | null, ObligationTotals> {
  const keys = new Set<string | null>(
    rows.filter(r => r.month === month && r.districtId === districtId).map(r => r.mahallId),
  )
  const out = new Map<string | null, ObligationTotals>()
  for (const k of keys) {
    out.set(k, sumObligations(rows, r => r.month === month && r.districtId === districtId && r.mahallId === k))
  }
  return out
}

/**
 * To'lov foizi (tashkilot bo'yicha): TO'LIQ yopganlar / majburiyati borlar.
 * Qisman to'lov to'liq to'lagan hisoblanmaydi. Majburiyat yo'q → null (0% emas).
 */
export function settlementRate(t: Pick<ObligationTotals, 'settled' | 'obliged'>): number | null {
  return payRate(t.settled, t.obliged)
}

/**
 * Pul bo'yicha yig'im foizi: yopilgan / kutilgan (BIR XIL to'plam, kesilmaydi).
 * Kutilgan 0 → null.
 */
export function collectionRate(t: Pick<ObligationTotals, 'applied' | 'expected'>): number | null {
  return payRate(t.applied, t.expected)
}

/**
 * Avans / ortiqcha: oyga tegishli kassa tushumi majburiyatdan ORTIQ bo'lgan qismi.
 * (O'zgaruvchan rejim to'lovlari, oldindan to'lov, ortiqcha summa.) Hech qachon manfiy emas.
 */
export function advanceAmount(collectedForMonth: number, applied: number): number {
  return Math.max(0, n0(collectedForMonth) - n0(applied))
}

/**
 * O'zgarish foizi: ikkala qiymat ham bir xil ma'noda (olma-olma) berilishi chaqiruvchi
 * javobgarligida. Oldingi 0 → null.
 */
export function pctChange(current: number, previous: number): number | null {
  const prev = Number(previous) || 0
  if (prev === 0) return null
  return Math.round(((Number(current) || 0) - prev) / prev * 100)
}

/**
 * Yig'im tempi: oyning X-kuniga qadar (UZT kun) kassaga tushgan kumulyativ summa,
 * o'tgan oyning SHU kuniga qadar tushgan summaga nisbatan.
 * `projected` — shu tezlikda oy oxirigacha chiziqli taxmin; day<1 → null.
 */
export interface Pace {
  day: number
  daysInMonth: number
  current: number
  previous: number
  /** current − previous */
  diff: number
  /** o'zgarish foizi; previous 0 → null */
  deltaPercent: number | null
  projected: number | null
  ahead: boolean | null
}

export function computePace(day: number, daysInMonth: number, current: number, previous: number): Pace {
  const d = Math.max(0, Math.floor(Number(day) || 0))
  const dim = Math.max(0, Math.floor(Number(daysInMonth) || 0))
  const cur = Math.max(0, n0(current))
  const prev = Math.max(0, n0(previous))
  return {
    day: d,
    daysInMonth: dim,
    current: cur,
    previous: prev,
    diff: cur - prev,
    deltaPercent: pctChange(cur, prev),
    projected: d >= 1 && dim >= 1 ? Math.round(cur * dim / d) : null,
    ahead: prev === 0 && cur === 0 ? null : cur >= prev,
  }
}

/** @db.Date ustunini ("YYYY-MM-DD") kalitga aylantiradi — bu instant emas, kalendar sana (UTC yarim tun). */
export function dateOnlyKey(d: Date | string): string {
  const v = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(v.getTime())) return ''
  const p2 = (x: number) => String(x).padStart(2, '0')
  return `${v.getUTCFullYear()}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())}`
}

/** Inspektor to'lov guruhlari: (oy × tuman) qatorlaridan yig'indilar. */
export interface PaymentGroupRow { month: string; districtId: string; districtName: string; count: number; amount: number }

export function rollupPaymentGroups(rows: PaymentGroupRow[], months: string[]) {
  const byMonth = new Map<string, number>(months.map(m => [m, 0]))
  const byDistrict = new Map<string, { name: string; collected: number; count: number }>()
  let collected = 0, count = 0
  for (const r of rows) {
    const amt = n0(r.amount), cnt = n0(r.count)
    collected += amt
    count += cnt
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + amt)
    const cur = byDistrict.get(r.districtId) ?? { name: r.districtName, collected: 0, count: 0 }
    cur.collected += amt
    cur.count += cnt
    byDistrict.set(r.districtId, cur)
  }
  return { collected, count, byMonth, byDistrict }
}
