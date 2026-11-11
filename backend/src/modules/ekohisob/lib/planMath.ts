// Kunlik plan qoidalari — sof mantiq (DB'siz, testlanadi). Sana/kun FAQAT lib/uzt.ts (UTC+5).

import { isValidIsoDate } from './uzt'

const DAY_MS = 24 * 60 * 60 * 1000

/** "YYYY-MM-DD" ni n kunga siljitadi (Date mintaqasiga bog'liq emas). Noto'g'ri sana → xato. */
export function addDaysIso(iso: string, n: number): string {
  if (!isValidIsoDate(iso)) throw new Error(`Noto'g'ri sana: ${iso}`)
  const t = new Date(`${iso}T00:00:00.000Z`).getTime() + n * DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

export const MIN_PAST_REASON = 5

export type PlanChangeCheck = { ok: true; past: boolean } | { ok: false; status: 400 | 403; error: string }

/**
 * Plan sanasini o'zgartirish/o'chirish huquqi:
 *  - bugun va kelajak — boshliq ham, admin ham;
 *  - O'TGAN sana — faqat admin va sabab (kamida 5 belgi) bilan (o'tgan natijani "to'g'rilab"
 *    KPI'ga ta'sir qilmaslik uchun: plan_completion KPI ko'rsatkichi shu planlardan hisoblanadi).
 */
export function checkPlanChange(input: {
  date: string; today: string; role: string; reason?: unknown
}): PlanChangeCheck {
  if (!isValidIsoDate(input.date)) return { ok: false, status: 400, error: "Sana noto'g'ri (YYYY-MM-DD)" }
  if (input.date >= input.today) return { ok: true, past: false }
  if (input.role !== 'admin') {
    return { ok: false, status: 403, error: "O'tgan sanadagi planni faqat administrator o'zgartira oladi" }
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < MIN_PAST_REASON) {
    return { ok: false, status: 400, error: `O'tgan sanadagi plan uchun sabab kerak (kamida ${MIN_PAST_REASON} belgi)` }
  }
  return { ok: true, past: true }
}

/**
 * Inspektor yukiga moslangan maqsad: umumiy maqsad × (inspektor tumani yuki / o'rtacha yuk),
 * koeffitsient [minFactor, maxFactor] ga cheklanadi (juda kichik/katta tuman maqsadni
 * mazmunsiz qilmasin). Natija butun son; asosiy maqsad > 0 bo'lsa kamida 1.
 * Yuk — masalan tumandagi faol tashkilotlar soni. O'rtacha yuk ≤ 0 yoki yuk noma'lum bo'lsa
 * asosiy maqsad o'zgarishsiz qaytadi. (Hozircha ishlatilmaydi — keyingi bosqich.)
 */
export function normalizedTarget(input: {
  baseTarget: number; load: number; avgLoad: number; minFactor?: number; maxFactor?: number
}): number {
  const base = Number.isFinite(input.baseTarget) ? Math.max(0, input.baseTarget) : 0
  if (base === 0) return 0
  const minF = input.minFactor ?? 0.5
  const maxF = input.maxFactor ?? 2
  if (!(input.avgLoad > 0) || !Number.isFinite(input.load) || input.load < 0) return Math.max(1, Math.round(base))
  const factor = Math.min(maxF, Math.max(minF, input.load / input.avgLoad))
  return Math.max(1, Math.round(base * factor))
}
