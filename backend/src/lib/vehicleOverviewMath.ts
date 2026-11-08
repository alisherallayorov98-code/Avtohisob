// Mashina sahifasi "Umumiy ko'rinish" uchun sof hisob-kitoblar (DB'siz, testlangan).

const UZT_OFFSET_MS = 5 * 3600 * 1000

/** Sana -> "YYYY-MM" (UTC+5 bo'yicha, oy chegarasi O'zbekiston vaqtida) */
export function monthKey(d: Date | string): string {
  const t = new Date(new Date(d).getTime() + UZT_OFFSET_MS)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Oxirgi `count` oy kalitlari (eskidan yangiga), joriy oy ham ichida */
export function lastMonthKeys(now: Date, count: number): string[] {
  const t = new Date(now.getTime() + UZT_OFFSET_MS)
  let y = t.getUTCFullYear()
  let m = t.getUTCMonth()
  const keys: string[] = []
  for (let i = 0; i < count; i++) {
    keys.unshift(`${y}-${String(m + 1).padStart(2, '0')}`)
    m--
    if (m < 0) { m = 11; y-- }
  }
  return keys
}

export interface MonthlyPoint { month: string; maintenance: number; fuel: number; expenses: number; total: number }
type Dated = { date: Date | string; amount: number }

export function buildMonthlySeries(
  now: Date,
  months: number,
  rows: { maintenance: Dated[]; fuel: Dated[]; expenses: Dated[] },
): MonthlyPoint[] {
  const keys = lastMonthKeys(now, months)
  const map = new Map<string, MonthlyPoint>(keys.map(k => [k, { month: k, maintenance: 0, fuel: 0, expenses: 0, total: 0 }]))
  const add = (kind: 'maintenance' | 'fuel' | 'expenses', list: Dated[]) => {
    for (const r of list) {
      const p = map.get(monthKey(r.date))
      if (!p) continue
      p[kind] += r.amount
      p.total += r.amount
    }
  }
  add('maintenance', rows.maintenance)
  add('fuel', rows.fuel)
  add('expenses', rows.expenses)
  return keys.map(k => map.get(k)!)
}

export interface FuelFill { liters: number; odometer: number; date: Date | string }

export interface Consumption {
  l100: number
  spanKm: number
  liters: number
  fills: number
  normPer100: number | null
  overPct: number | null // me'yordan necha foiz ortiq (manfiy = tejamkor)
  level: 'ok' | 'warning' | 'critical' | null
}

/**
 * Fill-to-fill: birinchi to'ldirishdan keyingilarining litrlari / (oxirgi - birinchi odometr) * 100.
 * Ma'lumot yetarli bo'lmasa (2 tadan kam yoki 100 km dan kam masofa) null — soxta raqam ko'rsatilmaydi.
 */
export function computeConsumption(fills: FuelFill[], normPer100: number | null | undefined): Consumption | null {
  const valid = fills
    .filter(f => f.liters > 0 && f.odometer > 0)
    .sort((a, b) => a.odometer - b.odometer)
  if (valid.length < 2) return null
  const spanKm = valid[valid.length - 1].odometer - valid[0].odometer
  if (spanKm < 100) return null
  const liters = valid.slice(1).reduce((s, f) => s + f.liters, 0)
  const l100 = (liters / spanKm) * 100
  if (!isFinite(l100) || l100 <= 0 || l100 > 200) return null
  const norm = normPer100 && normPer100 > 0 ? normPer100 : null
  const overPct = norm ? ((l100 - norm) / norm) * 100 : null
  const level = overPct == null ? null : overPct > 20 ? 'critical' : overPct > 8 ? 'warning' : 'ok'
  return {
    l100: Math.round(l100 * 10) / 10,
    spanKm: Math.round(spanKm),
    liters: Math.round(liters),
    fills: valid.length,
    normPer100: norm,
    overPct: overPct == null ? null : Math.round(overPct),
    level,
  }
}

export type DocLevel = 'expired' | 'soon' | 'ok'
export interface DocStatus { daysLeft: number; level: DocLevel }

export function docStatus(expiry: Date | string | null | undefined, now: Date): DocStatus | null {
  if (!expiry) return null
  const daysLeft = Math.ceil((new Date(expiry).getTime() - now.getTime()) / 86400000)
  return { daysLeft, level: daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'soon' : 'ok' }
}
