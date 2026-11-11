// Tashrif qaydlari — PURE qism (kiritishni tekshirish, va'da bajarilganmi).

import { isValidIsoDate, parseDateOnly, todayUz } from './uzt'
import { validateLatLon, cleanText } from './ekoValidate'

export const VISIT_KINDS = ['not_paid', 'promised', 'visited'] as const
export type VisitKind = (typeof VISIT_KINDS)[number]

/** Va'da sanasi bugundan ko'pi bilan shuncha kun keyin bo'lishi mumkin. */
export const MAX_PROMISE_DAYS_AHEAD = 90

export interface VisitInput {
  kind: VisitKind
  reason: string | null
  promisedDate: Date | null
  lat: number | null
  lon: number | null
  photoFileId: string | null
}

export type VisitParse = { ok: true; value: VisitInput } | { ok: false; error: string }

/** ISO sanaga kun qo'shadi (Date mintaqasiz: UTC yarim tun). */
export function addDaysIso(iso: string, days: number): string {
  const d = parseDateOnly(iso)
  if (!d) throw new Error('bad date')
  return new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10)
}

export function parseVisitInput(body: any, today: string = todayUz()): VisitParse {
  const b = body ?? {}
  if (!(VISIT_KINDS as readonly string[]).includes(b.kind)) {
    return { ok: false, error: "kind noto'g'ri. Mumkin: not_paid, promised, visited" }
  }
  const kind = b.kind as VisitKind

  const reasonC = cleanText(b.reason, 500, 'Sabab')
  if (!reasonC.ok) return { ok: false, error: reasonC.error }
  if (kind === 'not_paid' && !reasonC.value) return { ok: false, error: "To'lanmagan sababini kiriting" }

  let promisedDate: Date | null = null
  if (kind === 'promised') {
    if (!isValidIsoDate(b.promisedDate)) return { ok: false, error: "Va'da sanasi noto'g'ri (YYYY-MM-DD)" }
    if (b.promisedDate < today) return { ok: false, error: "Va'da sanasi o'tgan kun bo'la olmaydi" }
    if (b.promisedDate > addDaysIso(today, MAX_PROMISE_DAYS_AHEAD)) {
      return { ok: false, error: `Va'da sanasi ${MAX_PROMISE_DAYS_AHEAD} kundan uzoq bo'lmasin` }
    }
    promisedDate = parseDateOnly(b.promisedDate)
  } else if (b.promisedDate !== undefined && b.promisedDate !== null && b.promisedDate !== '') {
    return { ok: false, error: "Va'da sanasi faqat kind=promised uchun" }
  }

  let lat: number | null = null
  let lon: number | null = null
  const hasGeo = !(b.lat === undefined || b.lat === null || b.lat === '') || !(b.lon === undefined || b.lon === null || b.lon === '')
  if (hasGeo) {
    const ll = validateLatLon(b.lat, b.lon)
    if (!ll.ok) return { ok: false, error: ll.error }
    lat = ll.value.lat; lon = ll.value.lon
  }

  const photoC = cleanText(b.photoFileId, 200, 'Rasm identifikatori')
  if (!photoC.ok) return { ok: false, error: photoC.error }

  return { ok: true, value: { kind, reason: reasonC.value, promisedDate, lat, lon, photoFileId: photoC.value } }
}

export interface PromiseVisit { id: string; entityId: string; promisedDate: string; createdAt: Date }
export interface PaymentRef { entityId: string; paidAt: Date }

/**
 * Bajarilmagan va'dalar: har tashkilot uchun ENG OXIRGI va'da olinadi; sanasi bugun yoki o'tgan
 * bo'lsa VA va'da berilgandan keyin to'lov yozilmagan bo'lsa — bajarilmagan.
 * `daysOverdue` — va'da sanasidan necha kun o'tgan (0 = bugun).
 */
export function findBrokenPromises(
  visits: PromiseVisit[],
  payments: PaymentRef[],
  today: string = todayUz(),
): { visitId: string; entityId: string; promisedDate: string; daysOverdue: number }[] {
  const latest = new Map<string, PromiseVisit>()
  for (const v of visits) {
    const cur = latest.get(v.entityId)
    if (!cur || v.createdAt.getTime() > cur.createdAt.getTime()) latest.set(v.entityId, v)
  }
  const out: { visitId: string; entityId: string; promisedDate: string; daysOverdue: number }[] = []
  for (const v of latest.values()) {
    if (v.promisedDate > today) continue
    const paid = payments.some(p => p.entityId === v.entityId && p.paidAt.getTime() >= v.createdAt.getTime())
    if (paid) continue
    const days = Math.round((parseDateOnly(today)!.getTime() - parseDateOnly(v.promisedDate)!.getTime()) / 86400000)
    out.push({ visitId: v.id, entityId: v.entityId, promisedDate: v.promisedDate, daysOverdue: days })
  }
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue)
}

