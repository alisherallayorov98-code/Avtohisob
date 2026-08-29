// FIFO tannarx sarfi — sotuvda qaysi kirim qatlamlaridan qancha sarflanganini
// aniqlaydi (eskisidan boshlab). Pure funksiya — DB'ga bog'liq emas, chaqiruvchi
// mavjud qatlamlarni oldindan olib beradi va natijani atomik yozadi.

export interface CostLayerInput {
  id: string
  unitCost: number
  remainingQty: number
  createdAt: Date | string | number
}

export interface CostConsumptionResult {
  layerId: string
  quantity: number
  unitCost: number
}

export interface FifoConsumeResult {
  consumptions: CostConsumptionResult[]
  totalCost: number
  avgUnitCost: number
}

/**
 * Berilgan miqdorni FIFO tartibida (eng eski kirim birinchi) qatlamlardan sarflaydi.
 * Yetarli qoldiq bo'lmasa xato tashlaydi — hech qachon manfiy qoldiqqa tushmaydi.
 */
export function consumeFifoLayers(layers: CostLayerInput[], qtyNeeded: number): FifoConsumeResult {
  if (!Number.isFinite(qtyNeeded) || qtyNeeded <= 0) {
    throw new Error('qtyNeeded musbat son bo\'lishi kerak')
  }

  const sorted = layers
    .filter(l => l.remainingQty > 0)
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      if (ta !== tb) return ta - tb
      // Bir xil millisekundda kirim bo'lsa — id bo'yicha deterministik tartib (audit uchun)
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  const totalAvailable = sorted.reduce((sum, l) => sum + l.remainingQty, 0)
  if (totalAvailable < qtyNeeded) {
    throw new Error(`Omborda yetarli qoldiq yo'q: kerak ${qtyNeeded}, mavjud ${totalAvailable}`)
  }

  const consumptions: CostConsumptionResult[] = []
  let remaining = qtyNeeded
  let totalCost = 0

  for (const layer of sorted) {
    if (remaining <= 0) break
    const take = Math.min(remaining, layer.remainingQty)
    consumptions.push({ layerId: layer.id, quantity: take, unitCost: layer.unitCost })
    totalCost += take * layer.unitCost
    remaining -= take
  }

  // 2 xonagacha yaxlitlash — qoldiq (agar bo'lsa) oxirgi sarfga singib ketadi,
  // shuning uchun alohida "qoldiqni qo'shish" qadami kerak emas: totalCost
  // to'g'ridan-to'g'ri barcha sarflarning yig'indisi.
  totalCost = Math.round(totalCost * 100) / 100
  const avgUnitCost = Math.round((totalCost / qtyNeeded) * 100) / 100

  return { consumptions, totalCost, avgUnitCost }
}
