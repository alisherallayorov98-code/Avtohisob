// Mashina dosyesi: hayot tarixi (vaqt chizig'i), oylik xarajatlar va avtopark bilan solishtirish.
// PURE — Snapshot'dan quriladi.
import type { FindingOut } from './types'
import { type Ctx, fmtNum, maintTotal, consumption, median, uzDay } from './context'
import { effectiveServiceCurrentKm } from '../serviceStatus'
import { isEnginePart } from './keywords'

export interface TimelineEvent {
  date: string
  kind: 'repair' | 'engine' | 'service' | 'inspection' | 'fuel_month' | 'tire'
  title: string
  detail?: string
  amount?: number
  flag?: 'warning' | 'critical'
}

export interface Metric { label: string; value: number | null; unit: string; fleet: number | null; better: 'lower' | 'higher'; note?: string }

export interface Dossier {
  vehicle: {
    id: string; plate: string; brand: string; model: string; year: number; status: string; mileage: number
    fuelType: string; fuelNorm: number | null; lastGpsSignal: string | null; branchId: string
    insuranceExpiry: string | null; techInspectionExpiry: string | null
  }
  metrics: Metric[]
  monthly: Array<{ month: string; fuel: number; repairs: number; other: number; km: number | null }>
  services: Array<{ type: string; lastDate: string | null; lastKm: number | null; leftKm: number | null }>
  timeline: TimelineEvent[]
  findings: FindingOut[]
}

const SERVICE_NAMES: Record<string, string> = { oil_change: 'Motor moyi', oil_filter: 'Moy filtri', air_filter: 'Havo filtri', fuel_filter: "Yoqilg'i filtri", gearbox_oil: 'Korobka moyi' }
const ENGINE_TYPES: Record<string, string> = { overhaul: "Kapital ta'mir", major_repair: "Yirik dvigatel ta'miri", minor_repair: "Kichik dvigatel ta'miri", inspection: "Dvigatel ko'rigi" }

function monthKeyUz(d: Date): string { return uzDay(d).slice(0, 7) }

export function buildDossier(c: Ctx, vehicleId: string, findings: FindingOut[]): Dossier | null {
  const v = c.vehicle.get(vehicleId)
  if (!v) return null

  // ── Ko'rsatkichlar va avtopark bilan solishtirish ──
  const km30 = c.kmBetween(v.id, c.ago(30), c.now)
  const fleetKm30 = c.active.map(x => c.kmBetween(x.id, c.ago(30), c.now)).filter((x): x is number => x != null)
  const cs90 = consumption(c, v.id, c.ago(90), c.now)
  const peers = c.active.filter(x => x.brand === v.brand && x.model === v.model)
    .map(x => consumption(c, x.id, c.ago(90), c.now)?.per100).filter((x): x is number => x != null)
  const costOf = (vid: string, days: number) => {
    const from = c.ago(days)
    return (c.fuelByV.get(vid) || []).filter(r => r.date >= from).reduce((s, r) => s + r.cost, 0)
      + (c.maintByV.get(vid) || []).filter(m => m.status === 'approved' && m.date >= from).reduce((s, m) => s + maintTotal(m), 0)
      + (c.expensesByV.get(vid) || []).filter(e => e.date >= from).reduce((s, e) => s + e.amount, 0)
  }
  const perKm = (vid: string) => {
    const km = c.kmBetween(vid, c.ago(90), c.now)
    return km && km >= 500 ? costOf(vid, 90) / km : null
  }
  const fleetPerKm = c.active.map(x => perKm(x.id)).filter((x): x is number => x != null)
  const repairs90 = (vid: string) => (c.maintByV.get(vid) || []).filter(m => m.status === 'approved' && m.date >= c.ago(90)).length
  const fleetRepairs = c.active.map(x => repairs90(x.id))

  const metrics: Metric[] = [
    { label: 'Oxirgi 30 kunda yurgan', value: km30, unit: 'km', fleet: fleetKm30.length >= 3 ? median(fleetKm30) : null, better: 'higher' },
    { label: "Yoqilg'i sarfi (90 kun)", value: cs90 ? Math.round(cs90.per100 * 10) / 10 : null, unit: '/100km', fleet: peers.length >= 3 ? Math.round(median(peers) * 10) / 10 : null, better: 'lower', note: v.fuelNorm ? `Norma: ${fmtNum(v.fuelNorm, 1)}` : 'Norma belgilanmagan' },
    { label: '1 km xarajati (90 kun)', value: perKm(v.id) != null ? Math.round(perKm(v.id)!) : null, unit: "so'm", fleet: fleetPerKm.length >= 3 ? Math.round(median(fleetPerKm)) : null, better: 'lower' },
    { label: "Ta'mirlar soni (90 kun)", value: repairs90(v.id), unit: 'ta', fleet: fleetRepairs.length >= 3 ? median(fleetRepairs) : null, better: 'lower' },
    { label: 'Jami xarajat (90 kun)', value: Math.round(costOf(v.id, 90)), unit: "so'm", fleet: null, better: 'lower' },
  ]

  // ── Oylik qatorlar (oxirgi 12 oy) ──
  const months: string[] = []
  const u = new Date(c.now.getTime() + 5 * 3600 * 1000)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth() - i, 1))
    months.push(d.toISOString().slice(0, 7))
  }
  const monthly = months.map(m => ({ month: m, fuel: 0, repairs: 0, other: 0, km: null as number | null }))
  const idx = new Map(months.map((m, i) => [m, i]))
  for (const r of c.fuelByV.get(v.id) || []) { const i = idx.get(monthKeyUz(r.date)); if (i != null) monthly[i].fuel += r.cost }
  for (const m of c.maintByV.get(v.id) || []) { const i = idx.get(monthKeyUz(m.date)); if (i != null && m.status === 'approved') monthly[i].repairs += maintTotal(m) }
  for (const e of c.expensesByV.get(v.id) || []) { const i = idx.get(monthKeyUz(e.date)); if (i != null) monthly[i].other += e.amount }
  const dkm = c.dailyKm.get(v.id)
  if (dkm && c.gpsCacheFrom) {
    for (const [day, km] of dkm) {
      const i = idx.get(day.slice(0, 7))
      if (i != null) monthly[i].km = (monthly[i].km || 0) + km
    }
    // Kesh boshlanishidan oldingi oylar uchun km noma'lum (0 emas)
    for (const row of monthly) if (row.month < c.gpsCacheFrom.slice(0, 7)) row.km = null
  }

  // ── Xizmatlar holati ──
  const services = [...(c.intervalsByV.get(v.id)?.values() || [])].map(it => ({
    type: SERVICE_NAMES[it.serviceType] || it.serviceType,
    lastDate: it.lastServiceDate ? uzDay(it.lastServiceDate) : null,
    lastKm: it.lastServiceKm,
    leftKm: it.nextDueKm != null ? it.nextDueKm - effectiveServiceCurrentKm(v.mileage, it.lastServiceKm, it.serviceOdometerKm) : null,
  }))

  // ── Vaqt chizig'i ──
  const tl: TimelineEvent[] = []
  for (const m of c.maintByV.get(v.id) || []) {
    const parts = m.parts.map(p => p.name).filter(Boolean)
    tl.push({
      date: uzDay(m.date), kind: 'repair',
      title: parts.length ? parts.slice(0, 4).join(', ') + (parts.length > 4 ? ` +${parts.length - 4}` : '') : (m.notes || "Ta'mir").slice(0, 80),
      detail: [m.workerName && `Usta: ${m.workerName}`, m.mileage && `${fmtNum(m.mileage)} km`, m.status === 'pending_approval' && 'Tasdiq kutmoqda'].filter(Boolean).join(' · ') || undefined,
      amount: maintTotal(m),
      flag: isEnginePart(parts.join(' ') + ' ' + (m.notes || '')) ? 'warning' : undefined,
    })
  }
  for (const e of c.engineByV.get(v.id) || []) {
    tl.push({ date: uzDay(e.date), kind: 'engine', title: ENGINE_TYPES[e.type] || e.type, detail: `${fmtNum(e.mileage)} km`, amount: e.cost, flag: e.type === 'overhaul' ? 'critical' : undefined })
  }
  for (const r of c.serviceByV.get(v.id) || []) {
    tl.push({ date: uzDay(r.date), kind: 'service', title: SERVICE_NAMES[r.serviceType] || r.serviceType, detail: `${fmtNum(r.km)} km`, amount: r.cost || undefined })
  }
  for (const i of c.inspByV.get(v.id) || []) {
    tl.push({ date: uzDay(i.date), kind: 'inspection', title: 'Texnik tekshiruv', detail: i.overall === 'ok' ? 'Yaxshi' : i.overall === 'warning' ? 'Ogohlantirish' : 'KRITIK', flag: i.overall === 'critical' ? 'critical' : i.overall === 'warning' ? 'warning' : undefined })
  }
  // Yoqilg'i — har bir quyish emas, oylik jamlanma (vaqt chizig'i to'lib ketmasin)
  const fuelByMonth = new Map<string, { l: number; s: number; n: number; last: Date }>()
  for (const r of c.fuelByV.get(v.id) || []) {
    const k = monthKeyUz(r.date)
    const x = fuelByMonth.get(k) || { l: 0, s: 0, n: 0, last: r.date }
    x.l += r.liters; x.s += r.cost; x.n++; if (r.date > x.last) x.last = r.date
    fuelByMonth.set(k, x)
  }
  for (const [, x] of fuelByMonth) {
    tl.push({ date: uzDay(x.last), kind: 'fuel_month', title: `Yoqilg'i: ${x.n} marta, ${fmtNum(x.l)} ${v.fuelType === 'gas' ? 'm³' : 'L'}`, amount: x.s })
  }
  for (const t of c.tiresByV.get(v.id) || []) {
    if (t.removedDate) tl.push({ date: uzDay(t.removedDate), kind: 'tire', title: `Shina yechildi: ${t.serial}`, detail: t.actualMileageUsed != null ? `${fmtNum(t.actualMileageUsed)} km yurgan` : undefined })
  }
  tl.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return {
    vehicle: {
      id: v.id, plate: v.plate, brand: v.brand, model: v.model, year: v.year, status: v.status, mileage: v.mileage,
      fuelType: v.fuelType, fuelNorm: v.fuelNorm, lastGpsSignal: v.lastGpsSignal?.toISOString() ?? null, branchId: v.branchId,
      insuranceExpiry: v.insuranceExpiry?.toISOString() ?? null, techInspectionExpiry: v.techInspectionExpiry?.toISOString() ?? null,
    },
    metrics,
    monthly,
    services,
    timeline: tl.slice(0, 200),
    findings: findings.filter(f => f.vehicleId === v.id),
  }
}

