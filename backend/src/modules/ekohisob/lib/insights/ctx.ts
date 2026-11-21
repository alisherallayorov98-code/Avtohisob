// Qoidalar uchun umumiy kontekst: indekslar va yordamchilar. PURE.
import type { Snapshot, EntitySnap, Finding, PaymentSnap, VisitSnap, SmsSnap, UserSnap, Evidence } from './types'
import { uzDate, uzDateTime, uzMonth, uzNum } from '../dateFormat'
import { uztParts, currentMonthUz, todayUz } from '../uzt'

export const DAY_MS = 86_400_000

export const fmtDate = (d: Date | string | null | undefined) => uzDate(d)
export const fmtDateTime = (d: Date | string | null | undefined) => uzDateTime(d)
export const fmtMonth = (m: string | null | undefined) => uzMonth(m)
export const fmtUzs = (n: number | null | undefined) => `${uzNum(n)} so'm`

export function table(columns: string[], rows: Array<Array<string | number | null | undefined>>, note?: string, entityIds?: Array<string | null>): Evidence {
  return {
    columns,
    rows: rows.map(r => r.map(v => (v == null || v === '' ? '—' : v)) as Array<string | number>),
    ...(note ? { note } : {}),
    ...(entityIds ? { entityIds } : {}),
  }
}

/** Ikki nuqta orasidagi masofa (metr) */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const l = m.get(k)
    if (l) l.push(x)
    else m.set(k, [x])
  }
  return m
}

export interface Ctx {
  s: Snapshot
  now: Date
  today: string
  month: string
  /** UZT bo'yicha oyning kuni */
  day: number
  entity: Map<string, EntitySnap>
  /** Faol tashkilotlar (status=active) */
  active: EntitySnap[]
  paymentsBy: Map<string, PaymentSnap[]>
  visitsBy: Map<string, VisitSnap[]>
  smsBy: Map<string, SmsSnap[]>
  user: Map<string, UserSnap>
  ago: (days: number) => Date
  daysSince: (d: Date) => number
  userName: (id: string | null | undefined) => string
  /** Finding'ga entity havolasi va standart tugma qo'shadi */
  f: (x: Finding) => Finding
  entityAction: (e: { id: string }) => { label: string; path: string }
}

export function buildCtx(s: Snapshot): Ctx {
  const now = s.now
  const entity = new Map(s.entities.map(e => [e.id, e]))
  const user = new Map(s.users.map(u => [u.id, u]))
  const p = uztParts(now)
  const c: Ctx = {
    s, now,
    today: todayUz(now),
    month: currentMonthUz(now),
    day: p?.day ?? 1,
    entity,
    active: s.entities.filter(e => e.status === 'active'),
    paymentsBy: groupBy(s.payments, x => x.entityId),
    visitsBy: groupBy(s.visits, x => x.entityId),
    smsBy: groupBy(s.sms, x => x.entityId),
    user,
    ago: (days) => new Date(now.getTime() - days * DAY_MS),
    daysSince: (d) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS)),
    userName: (id) => (id ? user.get(id)?.fullName ?? 'Noma\'lum xodim' : '—'),
    entityAction: (e) => ({ label: 'Tashkilot kartochkasi', path: `entity:${e.id}` }),
    f: (x) => x,
  }
  c.f = (x) => ({ ...x, action: x.action ?? (x.entityId ? c.entityAction({ id: x.entityId }) : undefined) })
  return c
}
