// KPI avto-ko'rsatkichlari — manipulyatsiyaga chidamli hisoblash (pure, DB'siz, testlanadi).
//
// Bonus pulga ta'sir qiladi, shuning uchun xom sanash o'rniga "haqiqiy ish"ni sanaymiz:
//  - new_entities: faqat faol (active) va keyinroq nofaol qilinmagan/qoralama bo'lib qolmagan
//    tashkilotlar; takroriy STIR (bir xil STIR bilan ilgari kiritilgan) sanalmaydi;
//  - payments_count: bitta kassa operatsiyasi (groupId) bir marta; bir tashkilotga bir kunda
//    (UZT) yozilgan bir necha to'lov bir marta; summasi 0 yoki manfiy to'lov sanalmaydi;
//  - sms_sent: bir tashkilotga bir necha SMS bir marta sanaladi.
// Kunlik/oylik chegara — lib/uzt.ts (UTC+5).

import { dayOfUz } from './uzt'

export interface EntityRow {
  id: string
  stir: string | null | undefined
  status: string
  createdAt: Date | string
}

/** STIR kaliti: faqat raqamlar; bo'sh/qisqa bo'lsa null (takrorlanish tekshirilmaydi). */
export function stirKey(stir: string | null | undefined): string | null {
  const d = String(stir ?? '').replace(/\D/g, '')
  return d.length >= 9 ? d : null
}

/** Hisobga olinadigan holatlar: faol tashkilot (qoralama/nofaol — yo'q). Qora ro'yxatdagi ham real tashkilot. */
export const CREDITED_STATUSES = ['active', 'blacklisted']

const ts = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime()

/**
 * Oy ichida xodim kiritgan tashkilotlardan hisobga olinadiganlar soni.
 * `candidates` — xodim shu oyda kiritganlar; `sameStir` — korxonadagi shu STIRlar bilan
 * barcha tashkilotlar (nomzodlarning o'zlari ham kirishi mumkin): nomzod eng erta
 * yaratilgan (createdAt, keyin id) bo'lmasa — takroriy, sanalmaydi.
 */
export function countCreditedEntities(candidates: EntityRow[], sameStir: EntityRow[]): number {
  const earliest = new Map<string, { t: number; id: string }>()
  for (const e of sameStir) {
    const k = stirKey(e.stir)
    if (!k) continue
    const t = ts(e.createdAt)
    const cur = earliest.get(k)
    if (!cur || t < cur.t || (t === cur.t && e.id < cur.id)) earliest.set(k, { t, id: e.id })
  }
  let n = 0
  for (const c of candidates) {
    if (!CREDITED_STATUSES.includes(c.status)) continue
    const k = stirKey(c.stir)
    if (k) {
      const first = earliest.get(k)
      if (first && first.id !== c.id) continue // boshqa (ilgari kiritilgan) tashkilot bilan bir xil STIR
    }
    n++
  }
  return n
}

export interface PaymentRow {
  entityId: string
  paidAt: Date | string
  amount: number
  groupId?: string | null
}

/**
 * To'lovlar "hodisa"lari soni: musbat summali to'lovlar, bitta kassa operatsiyasi (groupId)
 * bir marta, va bir tashkilotga bir UZT kunida bir marta.
 */
export function countPaymentEvents(rows: PaymentRow[]): number {
  const seen = new Set<string>()
  for (const r of rows) {
    if (!(Number(r.amount) > 0)) continue
    const day = dayOfUz(r.paidAt)
    if (!day) continue
    seen.add(`${r.entityId}|${day}`)
  }
  return seen.size
}

/** Foydali (hisobga olinadigan) to'lov summasi — musbat to'lovlar yig'indisi (butun so'm). */
export function sumValidPayments(rows: PaymentRow[]): number {
  return rows.reduce((s, r) => s + (Number(r.amount) > 0 ? Math.round(Number(r.amount)) : 0), 0)
}

/** Faol kunlar: to'lov (musbat) yoki kiritilgan tashkilot kunlari (UZT), takrorsiz. */
export function activeDayKeys(paymentDates: Array<Date | string>, entityDates: Array<Date | string>): Set<string> {
  const out = new Set<string>()
  for (const d of paymentDates) { const k = dayOfUz(d); if (k) out.add(k) }
  for (const d of entityDates) { const k = dayOfUz(d); if (k) out.add(k) }
  return out
}
