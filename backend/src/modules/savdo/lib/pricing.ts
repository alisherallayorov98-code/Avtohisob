// Sotuv narxini aniqlash — qo'lda kiritilgan narx ustunlik qiladi, aks holda
// mijozning narx toifasiga (optom/chakana) qarab mahsulot narxi tanlanadi.

export interface ResolvePriceOptions {
  wholesalePrice: number
  retailPrice: number
  customerPriceTier?: 'retail' | 'wholesale' | null
  manualPrice?: number | null
}

export function resolveUnitPrice(opts: ResolvePriceOptions): number {
  if (opts.manualPrice != null) return opts.manualPrice
  return opts.customerPriceTier === 'wholesale' ? opts.wholesalePrice : opts.retailPrice
}
