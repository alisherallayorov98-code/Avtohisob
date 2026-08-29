// Inventarizatsiya (jismoniy sanash) tuzatish hisob-kitobi — pure funksiya.
// Ortiqcha (surplus) qatlam qo'shilganda qaysi tannarxda qo'shilishini
// aniqlaydi: mavjud ochiq qatlamlarning og'irlikli o'rtachasi (mavjud bo'lmasa 0).

const round2 = (n: number): number => Math.round(n * 100) / 100

export interface CostLayerLike {
  unitCost: number
  remainingQty: number
}

export function computeAverageCost(layers: CostLayerLike[]): number {
  const totalQty = layers.reduce((sum, l) => sum + l.remainingQty, 0)
  if (totalQty <= 0) return 0
  const totalValue = layers.reduce((sum, l) => sum + l.remainingQty * l.unitCost, 0)
  return round2(totalValue / totalQty)
}

export interface CountDiffResult {
  diffQty: number
  unitCost: number
  diffValue: number
}

/** Sanalgan miqdor va tizim qoldig'idan farq va uning qiymatini hisoblaydi. */
export function computeCountDiff(systemQty: number, countedQty: number, layers: CostLayerLike[]): CountDiffResult {
  const diffQty = Math.round(countedQty) - Math.round(systemQty)
  const unitCost = computeAverageCost(layers)
  const diffValue = round2(diffQty * unitCost)
  return { diffQty, unitCost, diffValue }
}
