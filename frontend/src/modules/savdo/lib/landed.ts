// Import kirim tannarxi PREVIEW (formada ko'rsatish uchun). Haqiqiy hisob serverda:
// backend/src/modules/savdo/lib/landedCost.ts — algoritm bir xil bo'lishi shart.

const r2 = (n: number): number => Math.round(n * 100) / 100

export function previewLanded(
  lines: { quantity: number; price: number }[], rate: number, extraTotal: number, allocBy: 'value' | 'quantity',
  perUnitRate = 0,
): { unitCost: number; extraCost: number; lineTotal: number }[] {
  if (!(rate > 0) || lines.length === 0) return lines.map(() => ({ unitCost: 0, extraCost: 0, lineTotal: 0 }))
  const base = lines.map(l => l.quantity * l.price * rate)
  const weights = allocBy === 'quantity' ? lines.map(l => l.quantity) : base
  const wSum = weights.reduce((a, b) => a + b, 0)
  let allocated = 0
  return lines.map((l, i) => {
    const share = i === lines.length - 1
      ? r2(extraTotal - allocated)
      : wSum > 0 ? r2((extraTotal * weights[i]) / wSum) : r2(extraTotal / lines.length)
    allocated += share
    const extraCost = r2(share + r2(perUnitRate * l.quantity))
    const unitCost = l.quantity > 0 ? r2(l.price * rate + extraCost / l.quantity) : 0
    return { unitCost, extraCost, lineTotal: r2(unitCost * l.quantity) }
  })
}
