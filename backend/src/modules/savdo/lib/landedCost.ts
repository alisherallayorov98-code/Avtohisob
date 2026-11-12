// Import kirimning to'liq (landed) tannarxi — pure funksiya.
// Valyutadagi narx kurs bilan so'mga aylantiriladi, qo'lda kiritilgan
// qo'shimcha xarajatlar (bojxona, transport ...) qatorlarga qiymat yoki
// miqdor bo'yicha taqsimlanadi. Taqsimot yig'indisi xarajat summasiga
// AYNAN teng (oxirgi qator qoldiqni oladi).
//
// Ikki xil xarajat:
//  - umumiy partiya (extraTotal): bir summa, qatorlarga qiymat/miqdor bo'yicha bo'linadi;
//  - har bir birlikka (perUnitRate): so'm/birlik — har qator o'z miqdoriga ko'paytiriladi
//    (masalan bojxona 500 so'm/kg). Qiymatga bog'liq emas.

const r2 = (n: number): number => Math.round(n * 100) / 100

// price — valyutada, birlik uchun. fixedExtra — shu qatorga XOS xarajat, so'mda jami (masalan utilizatsiya yig'imi);
// u taqsimlanmaydi, faqat shu qatorga tushadi.
export interface LandedLineIn { quantity: number; price: number; fixedExtra?: number }
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
  perUnitRate = 0,
): LandedLineOut[] {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Kurs musbat bo\'lishi kerak')
  if (!Number.isFinite(extraTotal) || extraTotal < 0) throw new Error('Xarajat manfiy bo\'lishi mumkin emas')
  if (!Number.isFinite(perUnitRate) || perUnitRate < 0) throw new Error('Birlik xarajati manfiy bo\'lishi mumkin emas')
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
    const perUnitPart = r2(perUnitRate * l.quantity)
    const extraCost = r2(share + perUnitPart + (l.fixedExtra || 0))
    const baseUnit = l.price * rate
    const unitCost = l.quantity > 0 ? r2(baseUnit + extraCost / l.quantity) : r2(baseUnit)
    return {
      baseUnitCost: r2(baseUnit),
      extraCost,
      unitCost,
      lineTotal: r2(unitCost * l.quantity),
    }
  })
}

export interface CostGroupInput {
  /** Butun partiyaga umumiy summa (so'm) — qatorlarga qiymat/miqdor bo'yicha bo'linadi */
  total: number
  /** Har bir birlikka so'm — qator miqdoriga ko'paytiriladi */
  perUnit: number
}

export interface GroupedLineOut extends LandedLineOut {
  extraCustoms: number   // bojxona xarajatlari ulushi
  extraOther: number     // qo'shimcha xarajatlar ulushi
  levy: number           // qatorga xos yig'im (utilizatsiya va h.k.)
}

/**
 * Xarajatlar IKKI guruhda alohida taqsimlanadi: bojxona va qo'shimcha (sertifikat, transport,
 * deklarant ...). Har guruh o'z yig'indisiga AYNAN teng; qatorga xos yig'im (levy) ustiga qo'shiladi.
 * To'liq tannarx = narx×kurs + (bojxona + qo'shimcha + yig'im) / miqdor.
 */
export function computeLandedCostGrouped(
  lines: LandedLineIn[],
  rate: number,
  groups: { customs: CostGroupInput; other: CostGroupInput },
  allocBy: 'value' | 'quantity' = 'value',
): GroupedLineOut[] {
  const plain = lines.map(l => ({ quantity: l.quantity, price: l.price }))
  const customs = computeLandedCost(plain, rate, groups.customs.total, allocBy, groups.customs.perUnit)
  const other = computeLandedCost(plain, rate, groups.other.total, allocBy, groups.other.perUnit)
  return lines.map((l, i) => {
    const levy = r2(l.fixedExtra || 0)
    const extraCost = r2(customs[i].extraCost + other[i].extraCost + levy)
    const baseUnit = l.price * rate
    const unitCost = l.quantity > 0 ? r2(baseUnit + extraCost / l.quantity) : r2(baseUnit)
    return {
      baseUnitCost: r2(baseUnit),
      extraCustoms: customs[i].extraCost,
      extraOther: other[i].extraCost,
      levy,
      extraCost,
      unitCost,
      lineTotal: r2(unitCost * l.quantity),
    }
  })
}
