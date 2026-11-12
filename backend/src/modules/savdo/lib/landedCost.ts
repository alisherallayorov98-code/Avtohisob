// Import kirimning to'liq (landed) tannarxi — pure funksiya.
// Valyutadagi narx kurs bilan so'mga aylantiriladi, qo'lda kiritilgan
// qo'shimcha xarajatlar (bojxona, transport ...) qatorlarga qiymat yoki
// miqdor bo'yicha taqsimlanadi. Taqsimot yig'indisi xarajat summasiga
// AYNAN teng (oxirgi qator qoldiqni oladi).

const r2 = (n: number): number => Math.round(n * 100) / 100

export interface LandedLineIn { quantity: number; price: number } // price — valyutada, birlik uchun
export interface LandedLineOut {
  baseUnitCost: number   // so'mda, xarajatsiz
  extraCost: number      // shu qatorga tushgan jami xarajat (so'm)
  unitCost: number       // so'mda, to'liq birlik tannarx
  lineTotal: number      // quantity * unitCost
}

export function computeLandedCost(
  lines: LandedLineIn[],
  rate: number,
  extraTotal: number,
  allocBy: 'value' | 'quantity' = 'value',
): LandedLineOut[] {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Kurs musbat bo\'lishi kerak')
  if (!Number.isFinite(extraTotal) || extraTotal < 0) throw new Error('Xarajat manfiy bo\'lishi mumkin emas')
  if (lines.length === 0) return []

  const base = lines.map(l => l.quantity * l.price * rate)
  const weights = allocBy === 'quantity' ? lines.map(l => l.quantity) : base
  const wSum = weights.reduce((a, b) => a + b, 0)

  let allocated = 0
  return lines.map((l, i) => {
    let share: number
    if (i === lines.length - 1) share = r2(extraTotal - allocated)
    else share = wSum > 0 ? r2((extraTotal * weights[i]) / wSum) : r2(extraTotal / lines.length)
    allocated += share
    const baseUnit = l.price * rate
    const unitCost = l.quantity > 0 ? r2(baseUnit + share / l.quantity) : r2(baseUnit)
    return {
      baseUnitCost: r2(baseUnit),
      extraCost: share,
      unitCost,
      lineTotal: r2(unitCost * l.quantity),
    }
  })
}
