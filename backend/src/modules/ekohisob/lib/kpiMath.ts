// KPI hisob-kitobi — pure funksiyalar (DB yo'q).
//
// Bonus pulga ta'sir qilgani uchun bu yerdagi qoidalar ANIQ va testlangan bo'lishi shart.
// Qoidalar:
//  1. Har ko'rsatkich: bajarilish % = qiymat / maqsad (yoki "kam — yaxshi" bo'lsa teskari),
//     `cap` (standart 120%) dan oshmaydi — bitta ko'rsatkichdagi ortiqcha boshqasini yopmasin.
//  2. Umumiy ball = vaznli o'rtacha. Qiymati kiritilmagan QO'LDA ko'rsatkich hisobdan chiqariladi
//     (admin kiritishni unutgani uchun xodim jazolanmasin) va "kiritilmagan" deb belgilanadi.
//  3. Admin tuzatishi (± ball) umumiy ballga qo'shiladi, 0..cap oralig'ida qoladi.
//  4. Bonus = bonusMax × ball%, faqat ball ≥ minScore bo'lsa; aks holda 0. Admin tuzatishi (± so'm) qo'shiladi.
//
// BIZNES QARORI (egasi hal qiladi, KODDA O'ZGARTIRILMAGAN): bonus "jarlik" shaklida —
// minScore dan 0.1 ball past bo'lsa bonus 0, minScore ning o'zida esa bonusMax × minScore%.
// Masalan minScore=50, bonusMax=1 000 000: ball 49.9 → 0 so'm; ball 50.0 → 500 000 so'm.
// Ya'ni 0.1 ball farqi 500 000 so'm. Muqobil (silliq o'tish, masalan minScore'dan
// boshlab chiziqli o'sish) biznes qarori; chegara xatti-harakati testlarda qotirilgan
// (kpiMath.test.ts: "jarlik"). Ball har doim round1 (1 xona), shuning uchun 49.99 amalda 50.0 bo'ladi.

import { monthBoundsUz, dayOfUz, isValidMonth, UZT_OFFSET_MS } from './uzt'

export type KpiDirection = 'higher' | 'lower'

export interface AutoMetricDef {
  key: string
  label: string
  unit: string
  direction: KpiDirection
  hint: string
  defaultTarget: number
  defaultWeight: number
}

/** Tizim o'zi hisoblaydigan ko'rsatkichlar katalogi (qiymat bazadagi haqiqiy yozuvlardan). */
export const AUTO_METRICS: AutoMetricDef[] = [
  {
    key: 'collected', label: "Yig'ilgan summa", unit: "so'm", direction: 'higher',
    hint: "Oy ichida qabul qilgan to'lovlar yig'indisi", defaultTarget: 50_000_000, defaultWeight: 40,
  },
  {
    key: 'payments_count', label: "To'lovlar soni", unit: 'ta', direction: 'higher',
    hint: "Oy ichida yozilgan to'lovlar soni", defaultTarget: 100, defaultWeight: 10,
  },
  {
    key: 'new_entities', label: 'Yangi tashkilotlar', unit: 'ta', direction: 'higher',
    hint: 'Oy ichida kiritilgan yangi tashkilotlar', defaultTarget: 20, defaultWeight: 20,
  },
  {
    key: 'draft_backlog', label: "To'ldirilmagan (chala) tashkilotlar", unit: 'ta', direction: 'lower',
    hint: "Hozir chala holatda turgan, o'zi kiritgan tashkilotlar. Maqsad — ruxsat etilgan eng ko'p son",
    defaultTarget: 5, defaultWeight: 10,
  },
  {
    key: 'plan_completion', label: 'Plan bajarilishi', unit: '%', direction: 'higher',
    hint: "Berilgan kunlik planlarning bajarilgan ulushi (plan berilmagan bo'lsa hisobdan chiqadi)",
    defaultTarget: 100, defaultWeight: 10,
  },
  {
    key: 'active_days', label: 'Faol kunlar', unit: 'kun', direction: 'higher',
    hint: "To'lov yozgan yoki tashkilot kiritgan kunlar soni", defaultTarget: 20, defaultWeight: 10,
  },
  {
    key: 'sms_sent', label: 'SMS eslatmalar', unit: 'ta', direction: 'higher',
    hint: "Qo'lda yuborilgan qarz eslatmalari", defaultTarget: 30, defaultWeight: 0,
  },
]

export const AUTO_METRIC_KEYS = AUTO_METRICS.map(m => m.key)

export function getAutoMetric(key: string): AutoMetricDef | undefined {
  return AUTO_METRICS.find(m => m.key === key)
}

export const DEFAULT_CAP_PERCENT = 120

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Bitta ko'rsatkichning bajarilish foizi (0..cap).
 *  - higher: qiymat/maqsad. Maqsad ≤ 0 bo'lsa mazmunsiz — qiymat > 0 bo'lsa 100, aks holda 0.
 *  - lower: qiymat ≤ maqsad → 100; undan oshgan sari kamayadi, maqsad×2 da 0.
 */
export function achievementPercent(
  value: number, target: number, direction: KpiDirection, cap: number = DEFAULT_CAP_PERCENT,
): number {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0
  const t = Number.isFinite(target) ? target : 0

  if (direction === 'lower') {
    if (v <= t) return 100
    const denom = Math.max(t, 1)
    return round1(Math.max(0, 100 - ((v - t) / denom) * 100))
  }

  if (t <= 0) return v > 0 ? 100 : 0
  return round1(Math.min(cap, (v / t) * 100))
}

export interface IndicatorInput {
  id: string
  name: string
  weight: number
  target: number
  direction: KpiDirection
  /** Ko'rsatish uchun birlik (hisobga ta'sir qilmaydi) */
  unit?: string
  /** null — qiymat yo'q (qo'lda ko'rsatkich kiritilmagan yoki hisoblab bo'lmadi) */
  value: number | null
}

export interface IndicatorScore extends IndicatorInput {
  /** Bajarilish foizi; qiymat yo'q bo'lsa null */
  achievement: number | null
  /** Umumiy ballga qo'shgan hissasi (ball punkti) */
  points: number | null
  /** Hisobga olinmadi (qiymat yo'q yoki vazn 0) */
  excluded: boolean
}

export interface ScoreResult {
  /** Tuzatishsiz ball, 0..cap */
  baseScore: number
  items: IndicatorScore[]
  /** Hisobga olingan vaznlar yig'indisi */
  usedWeight: number
  /** Qiymati yo'qligi sababli chiqarib tashlangan ko'rsatkichlar soni */
  missingCount: number
}

export function computeScore(
  indicators: IndicatorInput[], cap: number = DEFAULT_CAP_PERCENT,
): ScoreResult {
  const used = indicators.filter(i => i.weight > 0 && i.value !== null)
  const usedWeight = used.reduce((s, i) => s + i.weight, 0)

  const items: IndicatorScore[] = indicators.map(i => {
    const excluded = i.weight <= 0 || i.value === null
    if (excluded) return { ...i, achievement: i.value === null ? null : achievementPercent(i.value, i.target, i.direction, cap), points: null, excluded: true }
    const achievement = achievementPercent(i.value as number, i.target, i.direction, cap)
    return {
      ...i,
      achievement,
      points: usedWeight > 0 ? round1((achievement * i.weight) / usedWeight) : 0,
      excluded: false,
    }
  })

  const baseScore = usedWeight > 0
    ? round1(Math.min(cap, used.reduce((s, i) => {
        const a = achievementPercent(i.value as number, i.target, i.direction, cap)
        return s + (a * i.weight) / usedWeight
      }, 0)))
    : 0

  return {
    baseScore,
    items,
    usedWeight,
    missingCount: indicators.filter(i => i.weight > 0 && i.value === null).length,
  }
}

/** Yakuniy ball = asosiy ball + admin tuzatishlari, 0..cap oralig'ida. */
export function finalScore(baseScore: number, adjustmentPoints: number, cap: number = DEFAULT_CAP_PERCENT): number {
  return round1(Math.min(cap, Math.max(0, baseScore + adjustmentPoints)))
}

export interface BonusInput {
  score: number
  bonusMax: number
  minScore: number
  /** Admin qo'lda qo'shgan/ayirgan summa (so'm) */
  bonusDelta?: number
}

/**
 * Bonus summasi (so'm). minScore dan past ball → asosiy bonus 0; admin tuzatishi (± so'm)
 * baribir qo'shiladi (masalan alohida rag'bat), natija esa hech qachon manfiy bo'lmaydi.
 */
export function computeBonus({ score, bonusMax, minScore, bonusDelta = 0 }: BonusInput): number {
  const base = score >= minScore ? Math.round((Math.max(0, bonusMax) * score) / 100) : 0
  return Math.max(0, base + Math.round(bonusDelta))
}

// ─── Sana yordamchilari (kun chegarasi UTC+5 — loyihaning yagona qoidasi) ───
// Hisob lib/uzt.ts bilan BIR XIL (yagona manba); eski nomlar moslik uchun saqlangan.

/** "YYYY-MM" → [oy boshi, keyingi oy boshi) UZT bo'yicha (UTC Date sifatida). */
export function monthBoundsUzt(month: string): { start: Date; end: Date } {
  const b = monthBoundsUz(month)
  if (b) return b
  // Noto'g'ri oy — eski xatti-harakat (xato tashlamaydi)
  const [y, m] = month.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - UZT_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - UZT_OFFSET_MS),
  }
}

/** UTC vaqtni UZT kuni "YYYY-MM-DD" ga aylantiradi. */
export function dayKeyUzt(d: Date | string): string {
  return dayOfUz(d) ?? ''
}

// ─── Oyni yopish va bonus tuzatish qoidalari (pulga ta'sir qiladi) ───────────

/** Bir xodimning bir oydagi JAMI (sof) bonus tuzatishi chegarasi — bonusMax ning shu foizi. */
export const ADJUST_MAX_PERCENT = 50
/** Tuzatish (ball yoki bonus) sababi minimal uzunligi. */
export const MIN_ADJUST_REASON = 10

/** Bonus tuzatishining mutlaq chegarasi (so'm, butun). */
export function bonusAdjustmentLimit(bonusMax: number, percent: number = ADJUST_MAX_PERCENT): number {
  const m = Number.isFinite(bonusMax) ? Math.max(0, bonusMax) : 0
  return Math.floor((m * Math.max(0, percent)) / 100)
}

export function validateAdjustmentReason(reason: unknown): string | null {
  const r = typeof reason === 'string' ? reason.trim() : ''
  if (r.length < MIN_ADJUST_REASON) return `Tuzatish sababi kamida ${MIN_ADJUST_REASON} belgi bo'lishi shart`
  return null
}

export type AdjustmentCheck = { ok: true } | { ok: false; error: string; limit: number }

/**
 * Admin bonus tuzatishi: bitta tuzatish ham, oy bo'yicha sof jami ham |limit| dan oshmasin.
 * `existingNetDelta` — shu xodim shu oy uchun avvalgi tuzatishlar yig'indisi (ishorali).
 */
export function checkBonusAdjustment(input: {
  bonusMax: number; existingNetDelta: number; newDelta: number; maxPercent?: number
}): AdjustmentCheck {
  const delta = Math.round(input.newDelta)
  if (delta === 0) return { ok: true }
  const limit = bonusAdjustmentLimit(input.bonusMax, input.maxPercent)
  if (Math.abs(delta) > limit) {
    return { ok: false, limit, error: `Bonus tuzatishi chegaradan oshdi: bir tuzatish ${limit.toLocaleString('en-US').replace(/,/g, ' ')} so'm (bonus chegarasining ${input.maxPercent ?? ADJUST_MAX_PERCENT}%) dan oshmasligi kerak` }
  }
  const net = Math.round(input.existingNetDelta) + delta
  if (Math.abs(net) > limit) {
    return { ok: false, limit, error: `Oylik jami bonus tuzatishi chegaradan oshdi (chegara ±${limit.toLocaleString('en-US').replace(/,/g, ' ')} so'm)` }
  }
  return { ok: true }
}

export type CloseDecision =
  | { ok: true; forced: boolean }
  | { ok: false; status: 400 | 409; code: 'INVALID_MONTH' | 'NOT_PAST' | 'ALREADY_CLOSED' | 'MISSING_VALUES'; error: string }

/**
 * Oyni yopish qoidasi: faqat O'TGAN oy (month < joriy oy UZT); qiymati kiritilmagan
 * (missingCount>0) ko'rsatkich bor bo'lsa `force:true` talab qilinadi.
 */
export function decideClose(input: {
  month: string; currentMonth: string; alreadyClosed: boolean; missingTotal: number; force: boolean
}): CloseDecision {
  if (!isValidMonth(input.month)) return { ok: false, status: 400, code: 'INVALID_MONTH', error: "Oy formati noto'g'ri" }
  if (input.month >= input.currentMonth) {
    return { ok: false, status: 400, code: 'NOT_PAST', error: "Faqat o'tgan oyni yopish mumkin (joriy oy hali tugamagan)" }
  }
  if (input.alreadyClosed) return { ok: false, status: 409, code: 'ALREADY_CLOSED', error: 'Bu oy allaqachon yopilgan' }
  if (input.missingTotal > 0 && !input.force) {
    return {
      ok: false, status: 409, code: 'MISSING_VALUES',
      error: `${input.missingTotal} ta ko'rsatkich qiymati kiritilmagan. Baribir yopish uchun force:true yuboring`,
    }
  }
  return { ok: true, forced: input.missingTotal > 0 }
}

/** Ko'rsatkich sozlamasini tekshiradi; xato matni yoki null. */
export function validateIndicatorInput(i: {
  name?: unknown; weight?: unknown; target?: unknown; direction?: unknown
}): string | null {
  if (typeof i.name !== 'string' || !i.name.trim()) return 'Ko\'rsatkich nomi kerak'
  const weight = Number(i.weight)
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) return 'Vazn 0 dan 100 gacha bo\'lishi kerak'
  const target = Number(i.target)
  if (!Number.isFinite(target) || target < 0) return 'Maqsad manfiy bo\'lmasligi kerak'
  if (i.direction !== 'higher' && i.direction !== 'lower') return 'Yo\'nalish noto\'g\'ri'
  if (i.direction === 'higher' && target <= 0) return '«Ko\'p — yaxshi» ko\'rsatkichda maqsad 0 dan katta bo\'lishi kerak'
  return null
}
