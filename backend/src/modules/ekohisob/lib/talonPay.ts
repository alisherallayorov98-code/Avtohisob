// EkoHisob — talon qisman to'lovi (pure, DB'siz, testlanadi).
//
// Talon qarzi = amount − paidAmount. To'lov talonlarni SANA bo'yicha FIFO (eskisidan)
// yopadi; summa talondan kam bo'lsa talon QISMAN yopiladi (ilgari kam summa talonni
// umuman yopmasdi va pul "havoda" qolardi).

import { talonPaidPart } from './debtMath'

export interface TalonRow {
  id: string
  date: Date | string
  amount: number
  paidAmount?: number | null
  paid?: boolean
}

export interface TalonUpdate {
  id: string
  /** shu amal bilan qo'shilgan (musbat) yoki ayirilgan (manfiy) summa */
  delta: number
  /** talonning YANGI to'langan summasi */
  paidAmount: number
  /** yangi paid bayrog'i: paidAmount >= amount */
  paid: boolean
}

const dayKey = (d: Date | string): number => {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(t) ? t : 0
}
const byDateAsc = (a: TalonRow, b: TalonRow) =>
  dayKey(a.date) - dayKey(b.date) || a.id.localeCompare(b.id)

/** "YYYY-MM" oyning UTC chegarasi (talon sanasi `@db.Date` — UTC yarim tun). */
export function talonMonthBounds(month: string): { start: Date; end: Date } {
  const start = new Date(`${month}-01T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start, end }
}

/**
 * `amount` ni talonlarga sanasi bo'yicha FIFO taqsimlaydi; qisman yopishni qo'llaydi.
 * Σ delta + leftover == amount. Hech bir talon amount dan oshmaydi.
 */
export function applyToTalons(
  talons: TalonRow[],
  amount: number,
): { updates: TalonUpdate[]; applied: number; leftover: number; closed: number } {
  let left = Math.max(0, Math.trunc(Number(amount) || 0))
  const updates: TalonUpdate[] = []
  let closed = 0
  for (const t of [...talons].sort(byDateAsc)) {
    if (left <= 0) break
    const total = Math.max(0, Math.trunc(Number(t.amount) || 0))
    const cur = talonPaidPart(t)
    const need = total - cur
    if (need <= 0) continue
    const take = Math.min(left, need)
    left -= take
    const paidAmount = cur + take
    const paid = paidAmount >= total
    if (paid) closed++
    updates.push({ id: t.id, delta: take, paidAmount, paid })
  }
  const applied = updates.reduce((s, u) => s + u.delta, 0)
  return { updates, applied, leftover: left, closed }
}

/**
 * To'lov bekor qilinganda talonlar to'lovini kamaytiradi — eng YANGI talondan boshlab (LIFO).
 * `reduceBy` dan ko'p ayirmaydi; to'langan summadan ko'p ham ayirmaydi (manfiy bo'lmaydi).
 */
export function reduceTalonPaid(
  talons: TalonRow[],
  reduceBy: number,
  preferIds: string[] = [],
): { updates: TalonUpdate[]; reduced: number } {
  let left = Math.max(0, Math.trunc(Number(reduceBy) || 0))
  const updates: TalonUpdate[] = []
  // `preferIds` (masalan, aynan "to'lanmagan"ga qaytarilayotgan talon) birinchi, qolganlari LIFO
  const ordered = [...talons].sort(byDateAsc).reverse()
  const pref = ordered.filter(t => preferIds.includes(t.id))
  const rest = ordered.filter(t => !preferIds.includes(t.id))
  for (const t of [...pref, ...rest]) {
    if (left <= 0) break
    const total = Math.max(0, Math.trunc(Number(t.amount) || 0))
    const cur = talonPaidPart(t)
    if (cur <= 0) continue
    const take = Math.min(left, cur)
    left -= take
    const paidAmount = cur - take
    updates.push({ id: t.id, delta: -take, paidAmount, paid: paidAmount >= total && total > 0 })
  }
  return { updates, reduced: updates.reduce((s, u) => s - u.delta, 0) }
}

/**
 * Bekor qilishdan keyin bir oyning talonlarida qancha to'lov ayirish kerak:
 * talonlarga tatbiq etilgan summa (T) qolgan to'lovlardan (S') oshmasligi shart.
 * Ayiriladigan = min(bekor qilingan summa, max(0, T − S')). Ya'ni hech qachon
 * bekor qilingandan ko'p ayirmaydi (eski nomuvofiq ma'lumot buzilmasin).
 */
export function talonReductionForMonth(
  talons: TalonRow[],
  remainingPaymentsInMonth: number,
  reversedInMonth: number,
): number {
  const T = talons.reduce((s, t) => s + talonPaidPart(t), 0)
  const over = Math.max(0, T - Math.max(0, Math.trunc(Number(remainingPaymentsInMonth) || 0)))
  return Math.min(Math.max(0, Math.trunc(Number(reversedInMonth) || 0)), over)
}

/**
 * Talon summasi = hajm (kub) × bir kub narxi — BUTUN so'm, float xatosiz.
 * Hajm 3 xonagacha kasr (mil) bilan butun songa o'tkaziladi: round(milli × narx / 1000).
 */
export function computeTalonAmount(volume: number, cubicPrice: number): number {
  const milli = Math.round(volume * 1000)
  const price = Math.trunc(Number(cubicPrice) || 0)
  if (milli <= 0 || price <= 0) return 0
  return Math.round((milli * price) / 1000)
}

/** Hajm: musbat, ko'pi bilan 3 xona kasr, 1 000 000 dan oshmaydi. Aks holda null. */
export function parseVolume(v: unknown): number | null {
  const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= 1_000_000 ? n : null
}
