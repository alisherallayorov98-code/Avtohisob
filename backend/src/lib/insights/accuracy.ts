// Qoidaning haqiqiy aniqligi — admin hukmlaridan (to'g'ri / noto'g'ri). PURE.
// Aniqligi past qoida o'chirilmaydi: "Taxmin"ga tushadi va ro'yxat oxiriga suriladi.
import type { FindingOut } from './types'

export interface RuleAccuracy {
  confirmed: number
  wrong: number
  normal: number
  /** To'g'ri chiqqanlar foizi; kamida 3 ta hukm bo'lmasa — null (xulosa qilish erta) */
  pct: number | null
  /** Ko'pincha noto'g'ri chiqadi — ishonchni pasaytirish kerak */
  low: boolean
}

export const MIN_JUDGED = 3

export function accuracyOf(confirmed: number, wrong: number, normal: number): RuleAccuracy {
  const judged = confirmed + wrong
  const pct = judged >= MIN_JUDGED ? Math.round((confirmed / judged) * 100) : null
  return { confirmed, wrong, normal, pct, low: wrong >= MIN_JUDGED && confirmed / judged < 0.5 }
}

/** Hukm statistikasi → har savolga aniqlik; past aniqlikda ishonch "guess" ga tushiriladi */
export function applyAccuracy<T extends Pick<FindingOut, 'ruleKey' | 'confidence' | 'basis'>>(
  findings: T[], stats: Map<string, RuleAccuracy>,
): Array<T & { ruleAccuracy?: RuleAccuracy; lowAccuracy?: boolean }> {
  return findings.map(f => {
    const a = stats.get(f.ruleKey)
    if (!a) return f
    if (!a.low) return { ...f, ruleAccuracy: a }
    return {
      ...f, ruleAccuracy: a, lowAccuracy: true, confidence: 'guess' as const,
      basis: `Bu turdagi savollar ko'pincha noto'g'ri chiqqan (${a.confirmed} to'g'ri, ${a.wrong} noto'g'ri) — avtomatik "Taxmin"ga tushirildi. ${f.basis || ''}`.trim(),
    }
  })
}
