// Savdo — to'lovni fakturalar bo'yicha taqsimlash (FIFO).
// EkoHisob paymentAllocation.ts bilan bir xil mantiq, faqat oy o'rniga
// faktura (sale) kaliti bilan: 1) tanlangan faktura, 2) qolgani eng eski
// ochiq fakturadan boshlab, 3) qolgan summa avans (saleId'siz to'lov).

export interface OpenSale {
  saleId: string
  /** shu fakturada qolgan qarz, 0 yoki manfiy bo'lsa e'tiborga olinmaydi */
  balance: number
}

export interface SaleAllocation {
  saleId: string
  amount: number
}

export interface SaleAllocationResult {
  /** Fakturalar bo'yicha taqsimot — har biriga alohida to'lov yozuvi yaratiladi */
  allocations: SaleAllocation[]
  /** Barcha qarz yopilgandan keyin ortib qolgan summa — saleId'siz avans yozuviga boradi */
  advance: number
  /** Tanlangan fakturadan tashqari yopilgan qarz (UI "eski qarzga o'tdi" deb ko'rsatishi uchun) */
  appliedToOlder: number
}

const num = (v: number | string | null | undefined): number => Math.trunc(Number(v) || 0)

/**
 * To'lovni fakturalarga taqsimlaydi:
 *  1. avval TANLANGAN faktura qarzi yopiladi (berilgan bo'lsa);
 *  2. ortgani `openSales` massividagi tartibda (chaqiruvchi eng eskidan
 *     yangisiga saralab beradi — createdAt asc) yopiladi;
 *  3. barcha qarz yopilgandan keyin qolgani avans (saleId=null) bo'ladi.
 */
export function allocatePaymentToSales(
  amount: number | string,
  openSales: OpenSale[],
  selectedSaleId?: string | null,
): SaleAllocationResult {
  let left = num(amount)
  if (left <= 0) return { allocations: [], advance: 0, appliedToOlder: 0 }

  const allocations: SaleAllocation[] = []
  const push = (saleId: string, value: number) => {
    if (value <= 0) return
    const existing = allocations.find(a => a.saleId === saleId)
    if (existing) existing.amount += value
    else allocations.push({ saleId, amount: value })
  }

  // 1. Tanlangan faktura
  if (selectedSaleId) {
    const selected = openSales.find(s => s.saleId === selectedSaleId)
    const selectedBalance = Math.max(0, num(selected?.balance))
    const toSelected = Math.min(left, selectedBalance)
    push(selectedSaleId, toSelected)
    left -= toSelected
  }

  // 2. Qolgan ochiq fakturalar — berilgan tartibda (eng eskisidan)
  let appliedToOlder = 0
  if (left > 0) {
    const others = openSales.filter(s => s.saleId !== selectedSaleId && num(s.balance) > 0)
    for (const s of others) {
      if (left <= 0) break
      const take = Math.min(left, num(s.balance))
      push(s.saleId, take)
      appliedToOlder += take
      left -= take
    }
  }

  // 3. Avans — saleId'siz qoladi
  const advance = left

  return { allocations, advance, appliedToOlder }
}
