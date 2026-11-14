// Ta'mirdan qaytarilgan (omborga qaytarish tasdiqlangan) qismlarni ayirish.
// Qism qaytarilgan bo'lsa u aslida o'rnatilmagan — tahlilda "o'rnatilgan" deb hisoblanmasligi kerak
// (aks holda dvigatel/takroriy ta'mir/narx savollari yolg'on chiqadi).

export interface ReturnedItem { maintenanceId: string; sparePartId: string; quantity: number; unitCost: number }

export interface PartLike { sparePartId: string | null; qty: number; unitCost: number }

/** maintenanceId|sparePartId → qaytarilgan soni va summasi */
export function buildReturnMap(items: ReturnedItem[]): Map<string, { qty: number; cost: number }> {
  const m = new Map<string, { qty: number; cost: number }>()
  for (const it of items) {
    if (!it.maintenanceId || !it.sparePartId || !(it.quantity > 0)) continue
    const k = `${it.maintenanceId}|${it.sparePartId}`
    const x = m.get(k) || { qty: 0, cost: 0 }
    x.qty += it.quantity
    x.cost += it.quantity * (it.unitCost || 0)
    m.set(k, x)
  }
  return m
}

/**
 * Ta'mir qismlaridan qaytarilganlarini ayiradi. To'liq qaytarilgan qism ro'yxatdan chiqadi.
 * Qaytarish bir xil qismning bir nechta qatoriga taqsimlanadi (birinchisidan boshlab).
 * returnedCost — ta'mir summasidan ayirish uchun (qaytarilgan qismlar qiymati).
 */
export function netParts<T extends PartLike>(maintenanceId: string, parts: T[], returns: Map<string, { qty: number; cost: number }>): { parts: T[]; returnedCost: number } {
  const left = new Map<string, number>()
  let returnedCost = 0
  const out: T[] = []
  for (const p of parts) {
    if (!p.sparePartId) { out.push(p); continue }
    const k = `${maintenanceId}|${p.sparePartId}`
    const r = returns.get(k)
    if (!r) { out.push(p); continue }
    const remainingReturn = left.has(k) ? left.get(k)! : r.qty
    const take = Math.min(p.qty, remainingReturn)
    left.set(k, remainingReturn - take)
    returnedCost += take * (p.unitCost || 0)
    if (p.qty - take > 0) out.push({ ...p, qty: p.qty - take })
  }
  return { parts: out, returnedCost }
}
