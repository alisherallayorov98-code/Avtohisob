// "Manba" jadvallari — har savol qaysi yozuvlardan kelib chiqqanini ko'rsatadi.
// Har qatorga yozuv havolasi (refs) biriktiriladi: tekshirish panelida o'sha yozuv to'liq ochiladi.
import type { Evidence, EvidenceRef, MaintSnap, FuelSnap, ExpenseSnap, VehicleSnap, WaybillSnap, TireSnap, EngineSnap, ServiceRecSnap } from './types'
import { fmtDate, fmtNum } from './context'

type Cell = string | number
const dash = (x: unknown) => (x == null || x === '' ? '—' : String(x))
const cut = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function table(columns: string[], rows: Cell[][], note?: string, refs?: Array<EvidenceRef | null>, highlight?: string[]): Evidence {
  return {
    ...(note && { note }), columns, rows,
    ...(refs && refs.some(Boolean) && { refs }),
    ...(highlight && highlight.length && { highlight }),
  }
}

export function maintLine(m: MaintSnap): string {
  const parts = m.parts.map(p => (p.qty > 1 ? `${p.name} ×${fmtNum(p.qty, p.qty % 1 ? 1 : 0)}` : p.name))
  return cut([parts.join(', '), m.notes || ''].filter(Boolean).join(' · ') || "(izoh yo'q)")
}

/** Ta'mir yozuvlari: sana, probeg, ish/qismlar, usta, summa, kiritilgan sana */
export function maintEv(ms: MaintSnap[], note?: string, highlight?: string[]): Evidence {
  const list = ms.slice(-25)
  return table(
    ['Sana', 'Probeg', 'Ish / qismlar', 'Usta', 'Summa', 'Kiritilgan'],
    list.map(m => [fmtDate(m.date), m.mileage ? fmtNum(m.mileage) : '—', maintLine(m), dash(m.workerName), fmtNum(m.cost + m.laborCost), fmtDate(m.createdAt)]),
    note, list.map(m => ({ kind: 'maintenance', id: m.id })), highlight,
  )
}

export function fuelEv(rs: FuelSnap[], note?: string): Evidence {
  const list = rs.slice(-25)
  return table(
    ['Sana', 'Miqdor', 'Odometr', 'Summa', 'Chek'],
    list.map(r => [fmtDate(r.date), fmtNum(r.liters, 1), r.odometer > 0 ? fmtNum(r.odometer) : '—', r.cost > 0 ? fmtNum(r.cost) : '—', r.hasReceipt === undefined ? '—' : r.hasReceipt ? 'bor' : "yo'q"]),
    note, list.map(r => ({ kind: 'fuel', id: r.id })),
  )
}

export function expenseEv(es: ExpenseSnap[], note?: string): Evidence {
  const list = [...es].sort((a, b) => b.amount - a.amount).slice(0, 25)
  return table(
    ['Sana', 'Kategoriya', 'Summa', 'Chek'],
    list.map(e => [fmtDate(e.date), dash(e.category), fmtNum(e.amount), e.hasReceipt ? 'bor' : "yo'q"]),
    note, list.map(e => ({ kind: 'expense', id: e.id })),
  )
}

/** Mashina kartochkasidagi maydonlar */
export function vehicleEv(v: VehicleSnap, fields: Array<[string, Cell | null | undefined]>, note?: string): Evidence {
  return table(['Maʼlumot', 'Qiymat'], [['Mashina', `${v.plate} — ${v.brand} ${v.model}`], ...fields.map(([k, x]) => [k, dash(x)])], note,
    [{ kind: 'vehicle', id: v.id }, ...fields.map(() => null)])
}

/** Bir nechta mashina ro'yxati (tashkilot darajasidagi savollar) */
export function vehiclesEv(vs: VehicleSnap[], extra: { columns: string[]; cells: (v: VehicleSnap) => Cell[] } | null, note?: string): Evidence {
  const list = vs.slice(0, 50)
  return table(
    ['Mashina', 'Model', ...(extra?.columns || [])],
    list.map(v => [v.plate, `${v.brand} ${v.model}`, ...(extra ? extra.cells(v) : [])]),
    vs.length > list.length ? `${note ? `${note} ` : ''}(birinchi ${list.length} tasi, jami ${vs.length})` : note,
    list.map(v => ({ kind: 'vehicle', id: v.id })),
  )
}

export function waybillEv(ws: WaybillSnap[], note?: string, plateOf?: (vid: string) => string): Evidence {
  const list = ws.slice(0, 25)
  return table(
    [...(plateOf ? ['Mashina'] : []), 'Raqam', 'Holat', 'Chiqish', 'Qaytish', 'Odometr', 'Yoqilg\'i'],
    list.map(w => [...(plateOf ? [plateOf(w.vehicleId)] : []), w.number, w.status, fmtDate(w.actualDeparture || w.plannedDeparture), fmtDate(w.actualReturn),
      `${w.departureOdometer != null ? fmtNum(w.departureOdometer) : '—'} → ${w.returnOdometer != null ? fmtNum(w.returnOdometer) : '—'}`, fmtNum(w.fuelIssued, 1)]),
    note, list.map(w => ({ kind: 'waybill', id: w.id })),
  )
}

export function tireEv(ts: TireSnap[], plateOf: (vid: string) => string, note?: string): Evidence {
  const list = ts.slice(0, 25)
  return table(
    ['Seriya', 'Mashina', 'Pozitsiya', 'Holat', "O'rnatilgan km", 'Yurgan / norma', 'Narx'],
    list.map(t => [t.serial, t.vehicleId ? plateOf(t.vehicleId) : '—', dash(t.position), t.status,
      t.installedMileageKm != null ? fmtNum(t.installedMileageKm) : '—',
      `${fmtNum(t.actualMileageUsed || 0)} / ${fmtNum(t.standardMileageKm)}`, fmtNum(t.purchasePrice)]),
    note, list.map(t => ({ kind: 'tire', id: t.id })),
  )
}

const ENGINE_TYPE: Record<string, string> = { overhaul: "Kapital ta'mir", major_repair: "Yirik ta'mir", minor_repair: "Kichik ta'mir", inspection: 'Tekshiruv', oil_change: 'Moy' }

export function engineEv(es: EngineSnap[], note?: string): Evidence {
  const list = es.slice(-25)
  return table(
    ['Sana', 'Turi', 'Probeg', 'Keyingi xizmat', 'Narx'],
    list.map(e => [fmtDate(e.date), ENGINE_TYPE[e.type] || e.type, e.mileage ? fmtNum(e.mileage) : '—', e.nextServiceMileage ? fmtNum(e.nextServiceMileage) : '—', fmtNum(e.cost)]),
    note, list.map(e => ({ kind: 'engine', id: e.id })),
  )
}

const SERVICE_TYPE: Record<string, string> = { oil_change: 'Motor moyi', air_filter: 'Havo filtri', fuel_filter: "Yoqilg'i filtri", gearbox_oil: 'Korobka moyi' }

export function serviceEv(rs: ServiceRecSnap[], note?: string): Evidence {
  const list = rs.slice(-25)
  return table(
    ['Sana', 'Xizmat', 'Probeg', 'Narx', 'Kiritilgan'],
    list.map(r => [fmtDate(r.date), SERVICE_TYPE[r.serviceType] || r.serviceType, r.km ? fmtNum(r.km) : '—', fmtNum(r.cost), r.createdAt ? fmtDate(r.createdAt) : '—']),
    note, list.map(r => (r.id ? { kind: 'service', id: r.id } : null)),
  )
}
