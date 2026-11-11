// EkoHisob SMS byudjeti, dedup va qayta urinish qoidalari — sof mantiq (DB'siz, testlanadi).
//
// Pul (SMS haqi) segmentlar bo'yicha yuritiladi: bitta SMS 1 yoki 3 segment bo'lishi
// mumkin (lotin vs kirill), shuning uchun limitlar SMS SONI bo'yicha emas, SEGMENTLAR
// YIG'INDISI bo'yicha hisoblanadi. Yuborish yo'li (services/smsGateway.ts) ushbu
// funksiyalarni DB tranzaksiyasi ichida chaqiradi — qaror bitta joyda.

import { levelRank } from './escalation'

export const MAX_SMS_ATTEMPTS = 3
export const MAX_ESCALATION_ATTEMPTS = 3
export const MANUAL_COOLDOWN_HOURS = 24
export const ESCALATION_COOLDOWN_HOURS = 48
export const SEND_WINDOW_START_HOUR = 10 // UZT, kiritilgan
export const SEND_WINDOW_END_HOUR = 18 // UZT, kiritilmagan (17:59 gacha)

export type SmsKind = 'auto' | 'escalation' | 'manual'

/** Dedup kaliti: (tashkilot, tur, davr). Bir kalitga ikki SMS yo'q. */
export function dedupKey(entityId: string, kind: string, periodKey: string): string {
  return `${entityId}|${kind}|${periodKey}`
}

/** Eskalatsiya SMS uchun davr kaliti: daraja ham kiradi (overdue va critical alohida). */
export function escalationPeriodKey(month: string, level: string): string {
  return `${month}:${level}`
}

// ─── Byudjet ─────────────────────────────────────────────────────────────────

export interface BudgetInput {
  /** Oylik limit (segment) */
  monthlyLimit: number
  /** Shu oyda sarflangan + band qilingan (pending) segmentlar */
  usedMonthSegments: number
  /** Kunlik maksimum (segment) */
  dailyMax: number
  /** Bugun (UZT) sarflangan + band qilingan segmentlar */
  usedTodaySegments: number
}

export interface BudgetRemaining {
  monthly: number
  daily: number
  /** Ikkalasining kichigi */
  remaining: number
  /** Cheklovchi: qaysi biri avval tugaydi */
  limitedBy: 'monthly' | 'daily'
}

const nn = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

export function remainingBudget(b: BudgetInput): BudgetRemaining {
  const monthly = Math.max(0, nn(b.monthlyLimit) - nn(b.usedMonthSegments))
  const daily = Math.max(0, nn(b.dailyMax) - nn(b.usedTodaySegments))
  const remaining = Math.min(monthly, daily)
  return { monthly, daily, remaining, limitedBy: monthly <= daily ? 'monthly' : 'daily' }
}

/** `segments` yuborishga byudjet yetadimi (0 segmentli xabar yuborilmaydi). */
export function canSpend(b: BudgetInput, segments: number): boolean {
  if (!Number.isFinite(segments) || segments <= 0) return false
  return segments <= remainingBudget(b).remaining
}

// ─── Yuborishdan oldingi qaror ───────────────────────────────────────────────

export type SkipReason =
  | 'not_found' | 'bad_status' | 'opt_out' | 'no_phone' | 'empty_message'
  | 'duplicate' | 'cooldown' | 'max_attempts' | 'monthly_limit' | 'daily_limit'

export interface ReservationInput {
  entityFound: boolean
  entityStatus: string | null
  smsOptOut: boolean
  phoneValid: boolean
  segments: number
  budget: BudgetInput
  /** Shu (tashkilot, tur(lar), davr) uchun 'sent' yoki 'pending' yozuv bor */
  duplicateExists: boolean
  /** Shu (tashkilot, tur, davr) uchun muvaffaqiyatsiz urinishlar soni */
  failedAttempts: number
  /** Cooldown oynasida shu tashkilot/telefonga 'sent'/'pending' bor */
  cooldownHit: boolean
}

export type ReservationDecision = { ok: true } | { ok: false; reason: SkipReason }

/**
 * Yuborishga RUXSAT berish qarori. Tartib muhim: avval tashkilot holati va rozilik
 * (pul sarflanmaydi), keyin takror/cooldown, oxirida byudjet.
 */
export function decideReservation(i: ReservationInput): ReservationDecision {
  if (!i.entityFound) return { ok: false, reason: 'not_found' }
  if (i.entityStatus !== 'active') return { ok: false, reason: 'bad_status' }
  if (i.smsOptOut) return { ok: false, reason: 'opt_out' }
  if (!i.phoneValid) return { ok: false, reason: 'no_phone' }
  if (!Number.isFinite(i.segments) || i.segments <= 0) return { ok: false, reason: 'empty_message' }
  if (i.duplicateExists) return { ok: false, reason: 'duplicate' }
  if (i.failedAttempts >= MAX_SMS_ATTEMPTS) return { ok: false, reason: 'max_attempts' }
  if (i.cooldownHit) return { ok: false, reason: 'cooldown' }
  const rem = remainingBudget(i.budget)
  if (i.segments > rem.remaining) {
    return { ok: false, reason: rem.monthly < i.segments ? 'monthly_limit' : 'daily_limit' }
  }
  return { ok: true }
}

// ─── Eskiz xato turlari ──────────────────────────────────────────────────────

/**
 * - config: kalit yo'q / sozlanmagan — butun navbat to'xtaydi
 * - auth: login/parol noto'g'ri yoki token yangilanmadi — butun navbat to'xtaydi
 * - transient: tarmoq, timeout, 429, 5xx — keyin qayta uriniladi
 * - permanent: bu xabar/raqam rad etildi (4xx) — qayta urinish foydasiz
 */
export type SmsErrorType = 'config' | 'auth' | 'transient' | 'permanent'

export function classifyHttpFailure(status: number): SmsErrorType {
  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 425 || status === 429) return 'transient'
  if (status >= 500) return 'transient'
  return 'permanent'
}

/** Butun navbatni to'xtatish kerakmi (har yangi SMS baribir muvaffaqiyatsiz bo'ladi). */
export function shouldAbortBatch(type: SmsErrorType | undefined, consecutiveTransient: number): boolean {
  if (type === 'config' || type === 'auth') return true
  if (type === 'transient' && consecutiveTransient >= 3) return true
  return false
}

/** Xato turi bo'yicha: urinish "sarflandi"mi (jurnalda 'failed' qoladimi) yoki qaytariladimi. */
export function consumesAttempt(type: SmsErrorType | undefined): boolean {
  return type === 'transient' || type === 'permanent' || type === undefined
}

// ─── Avto-SMS rejasi ─────────────────────────────────────────────────────────

export interface AutoRunInput {
  enabled: boolean
  /** Korxona sozlagan kun (1–28) */
  smsAutoDay: number
  /** Bugungi kun (UZT, 1–31) */
  todayDay: number
  /** Shu oyda to'liq ishlagan oy "YYYY-MM" yoki null */
  smsAutoLastMonth: string | null
  /** Joriy oy (UZT) */
  currentMonth: string
}

/**
 * `smsAutoDay <= bugun` va shu oy hali to'liq ishlamagan bo'lsa ishlaydi.
 * Shu tufayli sozlangan kun o'tib ketgan bo'lsa ham (server o'chiq, byudjet tugagan)
 * keyingi kunlarda davom etadi, lekin to'liq ishlagan oyda ikkinchi marta yurmaydi.
 */
export function shouldRunAuto(i: AutoRunInput): boolean {
  if (!i.enabled) return false
  if (i.smsAutoLastMonth === i.currentMonth) return false
  return i.todayDay >= i.smsAutoDay
}

export interface AutoCandidate {
  id: string
  debtLevel: string
  debt: number
}

/** Saralash: daraja (critical > overdue > warning), keyin qarz kamayish tartibida, keyin id (barqaror). */
export function sortCandidates<T extends AutoCandidate>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    levelRank(b.debtLevel) - levelRank(a.debtLevel)
    || b.debt - a.debt
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Byudjetga sig'adiganlarni tartib bilan tanlaydi (sig'maganini o'tkazib, kichikrog'ini oladi).
 * Kafolat: tanlanganlar segmentlari yig'indisi `remaining` dan oshmaydi.
 */
export function selectWithinBudget<T extends { segments: number }>(
  ordered: T[], remaining: number,
): { chosen: T[]; deferred: T[]; spent: number } {
  const chosen: T[] = []
  const deferred: T[] = []
  let left = Math.max(0, Math.floor(remaining))
  let spent = 0
  for (const c of ordered) {
    if (c.segments > 0 && c.segments <= left) {
      chosen.push(c); left -= c.segments; spent += c.segments
    } else deferred.push(c)
  }
  return { chosen, deferred, spent }
}

// ─── Vaqt oynasi (UZT) ───────────────────────────────────────────────────────

/** SMS/Telegram amallari faqat 10:00–17:59 UZT. `uztHour` — 0..23 (uztParts().hour). */
export function isInSendWindow(uztHour: number): boolean {
  return uztHour >= SEND_WINDOW_START_HOUR && uztHour < SEND_WINDOW_END_HOUR
}

// ─── Eskalatsiya qayta urinish ───────────────────────────────────────────────

export type EscalationRowDecision = 'skip_done' | 'try' | 'give_up'

/**
 * Eskalatsiya jurnali qatori bo'yicha: bajarilgan → o'tkazish; 'pending'/'failed' va
 * urinishlar chegaradan oshmagan → urinish; aks holda taslim.
 */
export function decideEscalationRow(
  row: { status: string; attempts: number } | null | undefined,
  maxAttempts: number = MAX_ESCALATION_ATTEMPTS,
): EscalationRowDecision {
  if (!row) return 'try'
  if (row.status === 'done') return 'skip_done'
  if (row.attempts >= maxAttempts) return 'give_up'
  return 'try'
}

/**
 * Import qilingan tashkilotlar uchun birinchi sinxronlashda daraja JIM o'rnatiladi
 * (ommaviy eskalatsiya/SMS ketmasin). Faqat import partiyasi bor, daraja hali 'current'
 * (hech qachon sinxronlanmagan) va yaqinda yaratilgan tashkilotlar.
 */
export function isSilentFirstSync(e: {
  importBatchId: string | null | undefined
  oldLevel: string | null | undefined
  createdAt: Date | string
  now: Date
}, windowHours = 36): boolean {
  if (!e.importBatchId) return false
  if (levelRank(e.oldLevel) !== 0) return false
  const t = (e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)).getTime()
  if (!Number.isFinite(t)) return false
  return e.now.getTime() - t < windowHours * 3600_000
}

// ─── SMS samaradorligi ───────────────────────────────────────────────────────

export interface SmsEvent { entityId: string; at: Date | string; kind?: string | null }
export interface PaymentEvent { entityId: string; paidAt: Date | string; amount?: number }

export interface SmsEffectiveness {
  windowDays: number
  /** SMS olgan tashkilotlar (barchasi) */
  smsEntities: number
  /** Baholash mumkin bo'lganlar: kamida bitta SMS'idan windowDays o'tgan */
  evaluated: number
  /** Ulardan SMS'dan keyin windowDays ichida to'lov qilganlar */
  paid: number
  /** paid / evaluated, 0..100, 1 xona; baholanadigan yo'q bo'lsa null */
  ratePercent: number | null
  /** Shu to'lovlar summasi (so'm, butun) */
  paidAmount: number
}

const ts = (d: Date | string): number => (d instanceof Date ? d : new Date(d)).getTime()

/**
 * SMS'dan keyin `windowDays` kun ichida to'lov qilgan tashkilotlar ulushi.
 *  - Tashkilot "baholanadi" agar uning kamida bitta SMS'i `now - windowDays` dan eski bo'lsa
 *    (yangi SMS'lar hali natija berishga ulgurmagan — ulushni sun'iy pasaytirmasin).
 *  - To'lov SMS'dan KEYIN (>=) va windowDays ichida (<) bo'lishi shart.
 *  - Bir tashkilot bir marta sanaladi (ko'p SMS/ko'p to'lov ulushni oshirmaydi).
 */
export function computeSmsEffectiveness(
  sms: SmsEvent[], payments: PaymentEvent[], now: Date, windowDays = 7,
): SmsEffectiveness {
  const win = windowDays * 24 * 3600_000
  const smsByEntity = new Map<string, number[]>()
  for (const s of sms) {
    const t = ts(s.at)
    if (!s.entityId || !Number.isFinite(t)) continue
    const arr = smsByEntity.get(s.entityId) ?? []
    arr.push(t); smsByEntity.set(s.entityId, arr)
  }
  const payByEntity = new Map<string, { t: number; amount: number }[]>()
  for (const p of payments) {
    const t = ts(p.paidAt)
    if (!p.entityId || !Number.isFinite(t)) continue
    const arr = payByEntity.get(p.entityId) ?? []
    arr.push({ t, amount: Math.max(0, Math.round(p.amount ?? 0)) }); payByEntity.set(p.entityId, arr)
  }

  let evaluated = 0, paid = 0, paidAmount = 0
  for (const [entityId, times] of smsByEntity) {
    const mature = times.filter(t => t + win <= now.getTime())
    if (mature.length === 0) continue
    evaluated++
    const pays = payByEntity.get(entityId) ?? []
    const hits = pays.filter(p => mature.some(t => p.t >= t && p.t < t + win))
    if (hits.length > 0) {
      paid++
      paidAmount += hits.reduce((s, h) => s + h.amount, 0)
    }
  }
  return {
    windowDays,
    smsEntities: smsByEntity.size,
    evaluated,
    paid,
    ratePercent: evaluated > 0 ? Math.round((paid / evaluated) * 1000) / 10 : null,
    paidAmount,
  }
}
