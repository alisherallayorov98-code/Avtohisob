// Qoidalar uchun tayyor indekslar va yordamchilar — Snapshot'dan bir marta quriladi.
import type {
  Snapshot, VehicleSnap, MaintSnap, EngineSnap, IntervalSnap, ServiceRecSnap, FuelSnap,
  InspectionSnap, TireSnap, WaybillSnap, ExpenseSnap, Finding, Category, Severity, FindingAction,
  Evidence, QuickAction,
} from './types'
import { DEFAULT_THRESHOLDS, type Thresholds } from './thresholds'

export const DAY_MS = 86400000
const UZ_OFFSET_MS = 5 * 3600 * 1000

/** UTC+5 kun kaliti (VehicleDailyKm.date bilan bir xil shkala) */
export function uzDay(d: Date): string {
  return new Date(d.getTime() + UZ_OFFSET_MS).toISOString().slice(0, 10)
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  const s = uzDay(d)
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`
}

export function fmtNum(n: number, digits = 0): string {
  const fixed = Math.abs(n).toFixed(digits)
  const [int, frac] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '−' : '') + grouped + (frac ? ',' + frac : '')
}

export function fmtUzs(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${fmtNum(n / 1_000_000, 1)} mln so'm`
  return `${fmtNum(Math.round(n))} so'm`
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function groupBy<T>(xs: T[], key: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    if (k == null) continue
    const arr = m.get(k)
    if (arr) arr.push(x); else m.set(k, [x])
  }
  return m
}

export interface Ctx {
  s: Snapshot
  now: Date
  t: Thresholds
  vehicles: VehicleSnap[]
  active: VehicleSnap[]
  vehicle: Map<string, VehicleSnap>
  maintByV: Map<string, MaintSnap[]>      // sana bo'yicha o'sish tartibida, rejected'siz
  engineByV: Map<string, EngineSnap[]>    // sana bo'yicha o'sish
  intervalsByV: Map<string, Map<string, IntervalSnap>>
  serviceByV: Map<string, ServiceRecSnap[]>  // sana bo'yicha o'sish
  fuelByV: Map<string, FuelSnap[]>        // sana bo'yicha o'sish
  inspByV: Map<string, InspectionSnap[]>  // sana bo'yicha kamayish (eng yangisi birinchi)
  tiresByV: Map<string, TireSnap[]>
  waybillsByV: Map<string, WaybillSnap[]>
  expensesByV: Map<string, ExpenseSnap[]>
  dailyKm: Map<string, Map<string, number>>
  /** Tashkilot GPS keshidagi eng eski va eng yangi kun (null = kesh yo'q) */
  gpsCacheFrom: string | null
  gpsCacheTo: string | null
  gpsCacheAlive: boolean
  ago: (days: number) => Date
  daysSince: (d: Date) => number
  plate: (vid: string) => string
  isGpsLinked: (v: VehicleSnap) => boolean
  /** [from, to] oralig'ida GPS km. null = ma'lumot ishonchsiz (kesh yo'q yoki oraliq keshdan tashqarida) */
  kmBetween: (vid: string, from: Date, to: Date) => number | null
  /** Inson shkalasidagi eng so'nggi ma'lum probeg (ta'mir/dvigatel/xizmat yozuvlari, GPS'siz mashinada — mileage) */
  humanKm: (vid: string) => number
  f: (p: {
    ruleKey: string; category: Category; severity: Severity; vehicleId?: string | null
    subjectKey?: string; title: string; detail: string; action: FindingAction; impactUzs?: number
    evidence?: Evidence; evidenceLabel?: string; quick?: QuickAction
  }) => Finding
  avgFuelPrice: (fuelType: string) => number
}

export function buildCtx(s: Snapshot): Ctx {
  const now = s.now
  const vehicle = new Map(s.vehicles.map(v => [v.id, v]))
  const byDateAsc = <T extends { date: Date }>(xs: T[]) => xs.sort((a, b) => a.date.getTime() - b.date.getTime())

  // Faqat tasdiqlangan ta'mirlar (loader ham faqat shularni beradi — bu ikkinchi himoya)
  const maintByV = groupBy(s.maintenance.filter(m => m.status === 'approved'), m => m.vehicleId)
  for (const arr of maintByV.values()) byDateAsc(arr)
  const engineByV = groupBy(s.engine, e => e.vehicleId)
  for (const arr of engineByV.values()) byDateAsc(arr)
  const serviceByV = groupBy(s.serviceRecords, r => r.vehicleId)
  for (const arr of serviceByV.values()) byDateAsc(arr)
  const fuelByV = groupBy(s.fuel, r => r.vehicleId)
  for (const arr of fuelByV.values()) byDateAsc(arr)
  const inspByV = groupBy(s.inspections, i => i.vehicleId)
  for (const arr of inspByV.values()) arr.sort((a, b) => b.date.getTime() - a.date.getTime())

  const intervalsByV = new Map<string, Map<string, IntervalSnap>>()
  for (const it of s.intervals) {
    let m = intervalsByV.get(it.vehicleId)
    if (!m) { m = new Map(); intervalsByV.set(it.vehicleId, m) }
    m.set(it.serviceType, it)
  }

  const dailyKm = new Map<string, Map<string, number>>()
  let gpsCacheFrom: string | null = null
  let gpsCacheTo: string | null = null
  for (const d of s.dailyKm) {
    let m = dailyKm.get(d.vehicleId)
    if (!m) { m = new Map(); dailyKm.set(d.vehicleId, m) }
    m.set(d.day, (m.get(d.day) || 0) + d.km)
    if (!gpsCacheFrom || d.day < gpsCacheFrom) gpsCacheFrom = d.day
    if (!gpsCacheTo || d.day > gpsCacheTo) gpsCacheTo = d.day
  }
  // Kesh "tirik": GPS ulangan va eng so'nggi yozuv 3 kundan eski emas
  const gpsCacheAlive = s.org.gpsConnected && !!gpsCacheTo && gpsCacheTo >= uzDay(new Date(now.getTime() - 3 * DAY_MS))

  const isGpsLinked = (v: VehicleSnap) => !!(v.gpsUnitName || v.lastGpsSignal || dailyKm.has(v.id))

  const kmBetween = (vid: string, from: Date, to: Date): number | null => {
    if (!gpsCacheAlive || !gpsCacheFrom || !gpsCacheTo) return null
    const v = vehicle.get(vid)
    if (!v || !isGpsLinked(v)) return null
    const a = uzDay(from)
    const b = uzDay(to)
    if (a < gpsCacheFrom) return null
    const m = dailyKm.get(vid)
    if (!m) return 0
    let sum = 0
    for (const [day, km] of m) if (day >= a && day <= b) sum += km
    return sum
  }

  const humanKm = (vid: string): number => {
    let best = 0
    for (const m of maintByV.get(vid) || []) if (m.mileage && m.mileage > best) best = m.mileage
    for (const e of engineByV.get(vid) || []) if (e.mileage > best) best = e.mileage
    for (const r of serviceByV.get(vid) || []) if (r.km > best) best = r.km
    const v = vehicle.get(vid)
    if (v && !v.gpsUnitName && v.mileage > best) best = v.mileage
    return best
  }

  const priceByType = new Map<string, number[]>()
  for (const r of s.fuel) {
    if (r.liters > 0 && r.cost > 0) {
      const arr = priceByType.get(r.fuelType) || []
      arr.push(r.cost / r.liters)
      priceByType.set(r.fuelType, arr)
    }
  }
  const avgFuelPrice = (ft: string) => median(priceByType.get(ft) || [])

  return {
    s, now,
    t: s.thresholds ?? DEFAULT_THRESHOLDS,
    vehicles: s.vehicles,
    active: s.vehicles.filter(v => v.status === 'active'),
    vehicle, maintByV, engineByV, intervalsByV, serviceByV, fuelByV, inspByV,
    tiresByV: groupBy(s.tires, t => t.vehicleId),
    waybillsByV: groupBy(s.waybills, w => w.vehicleId),
    expensesByV: groupBy(s.expenses, e => e.vehicleId),
    dailyKm, gpsCacheFrom, gpsCacheTo, gpsCacheAlive,
    ago: (days: number) => new Date(now.getTime() - days * DAY_MS),
    daysSince: (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS),
    plate: (vid: string) => vehicle.get(vid)?.plate || '—',
    isGpsLinked,
    kmBetween,
    humanKm,
    f: (p) => ({
      ruleKey: p.ruleKey, category: p.category, severity: p.severity,
      vehicleId: p.vehicleId ?? null, subjectKey: p.subjectKey ?? '',
      title: p.title, detail: p.detail, action: p.action, impactUzs: p.impactUzs,
      ...(p.evidence && { evidence: p.evidence }),
      ...(p.evidenceLabel && { evidenceLabel: p.evidenceLabel }),
      ...(p.quick && { quick: p.quick }),
    }),
    avgFuelPrice,
  }
}

/** Ta'mir yozuvining barcha matni (izoh + qism nomlari) — kalit so'z qidirish uchun */
export function maintText(m: MaintSnap): string {
  return [m.notes || '', ...m.parts.map(p => p.name)].join(' | ').toLowerCase()
}

export function maintTotal(m: MaintSnap): number {
  return m.cost + m.laborCost
}

/** [from, to] oralig'idagi yoqilg'i sarfi L/100km. GPS km bo'lsa o'shani, bo'lmasa odometr farqini ishlatadi */
export function consumption(c: Ctx, vid: string, from: Date, to: Date, minKm = 300): { per100: number; liters: number; km: number } | null {
  const fills = (c.fuelByV.get(vid) || []).filter(r => r.date >= from && r.date <= to)
  if (fills.length < 2) return null
  const liters = fills.reduce((s, r) => s + r.liters, 0)
  let km = c.kmBetween(vid, from, to)
  if (km == null || km <= 0) {
    const odos = fills.map(r => r.odometer).filter(o => o > 0)
    if (odos.length < 2) return null
    km = Math.max(...odos) - Math.min(...odos)
    // odometr bo'yicha: birinchi quyish oldingi davrga tegishli (fill-to-fill)
    const firstLiters = fills.find(r => r.odometer > 0)?.liters || 0
    const adj = liters - firstLiters
    if (km < minKm || adj <= 0) return null
    return { per100: (adj / km) * 100, liters: adj, km }
  }
  if (km < minKm) return null
  return { per100: (liters / km) * 100, liters, km }
}

/** Forma uchun sana qiymati (YYYY-MM-DD, UTC+5) */
export const isoDay = (d: Date) => uzDay(d)

/** Sarf hisobining dalili: oraliqdagi quyishlar va km manbasi */
export function consumptionEvidence(c: Ctx, vid: string, from: Date, to: Date): Evidence {
  const fills = (c.fuelByV.get(vid) || []).filter(r => r.date >= from && r.date <= to)
  const gps = c.kmBetween(vid, from, to)
  return {
    note: gps != null && gps > 0
      ? `${fmtDate(from)}–${fmtDate(to)}: GPS bo'yicha ${fmtNum(gps)} km, ${fills.length} ta quyish.`
      : `${fmtDate(from)}–${fmtDate(to)}: km odometr farqidan (birinchi quyish oldingi davrga tegishli — fill-to-fill).`,
    columns: ['Sana', 'Miqdor', 'Odometr', 'Summa'],
    rows: fills.slice(-15).map(r => [fmtDate(r.date), fmtNum(r.liters, 1), r.odometer > 0 ? fmtNum(r.odometer) : '—', r.cost > 0 ? fmtNum(r.cost) : '—']),
  }
}

/** Kunlik GPS km jadvali (dalil uchun) */
export function dailyKmEvidence(c: Ctx, vid: string, from: Date, to: Date, note?: string): Evidence {
  const m = c.dailyKm.get(vid)
  const rows: Array<Array<string | number>> = []
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const day = uzDay(new Date(t))
    rows.push([day.split('-').reverse().join('.'), fmtNum(m?.get(day) || 0)])
  }
  return { note, columns: ['Kun', 'GPS km'], rows }
}
