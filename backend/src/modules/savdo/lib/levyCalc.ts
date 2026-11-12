// Savdo — yig'imlar (utilizatsiya yig'imi va shunga o'xshash) hisobi — pure funksiya.
//
// Umumiy qoida (tovar turiga qotirilmagan): yig'im stavkasi = eng kam oylik ish haqining
// FOIZI, har bir ASOS birligi uchun. Asos ikki xil:
//   per_kg   — har bir kilogramm uchun (qator og'irligi = miqdor × birlik og'irligi)
//   per_unit — har bir dona/birlik uchun (qator miqdori)
// Natija so'mda, qatorning to'liq tannarxiga qo'shiladi (landedCost.fixedExtra).

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export type LevyBasis = 'per_kg' | 'per_unit'
export const LEVY_BASES: readonly LevyBasis[] = ['per_kg', 'per_unit']
export const LEVY_BASIS_LABEL: Record<LevyBasis, string> = { per_kg: 'har bir kg uchun', per_unit: 'har bir dona uchun' }

export function isLevyBasis(v: unknown): v is LevyBasis {
  return v === 'per_kg' || v === 'per_unit'
}

/** Bitta asos birligi uchun stavka (so'm): eng kam oylik × foiz / 100. */
export function levyRate(minWage: number, percent: number): number {
  return (minWage * percent) / 100
}

export interface LevyInput {
  basis: LevyBasis
  minWage: number
  percent: number
  quantity: number
  /** Bir birlikning og'irligi (kg) — faqat per_kg uchun majburiy */
  unitWeightKg?: number | null
}

export interface LevyResult {
  basisQty: number   // kg yoki dona
  rate: number       // so'm / asos birligi
  amount: number     // qator uchun jami, so'm
}

export function computeLevy(i: LevyInput): LevyResult {
  if (!Number.isFinite(i.minWage) || i.minWage <= 0) {
    throw new Error('Eng kam oylik ish haqi kiritilmagan')
  }
  if (!Number.isFinite(i.percent) || i.percent < 0) {
    throw new Error('Yig\'im foizi noto\'g\'ri')
  }
  if (!Number.isFinite(i.quantity) || i.quantity <= 0) {
    throw new Error('Miqdor musbat bo\'lishi kerak')
  }
  let basisQty = i.quantity
  if (i.basis === 'per_kg') {
    const w = Number(i.unitWeightKg)
    if (!Number.isFinite(w) || w <= 0) throw new Error('Kilogramm bo\'yicha yig\'im uchun birlik og\'irligini kiriting')
    basisQty = Math.round(i.quantity * w * 1000) / 1000
  }
  const rate = levyRate(i.minWage, i.percent)
  return { basisQty, rate: r2(rate), amount: r2(basisQty * rate) }
}
