// Ombordan omborga jo'natma qoidalari — sof mantiq (DB'siz, testlangan).

export const MAX_QTY = 1_000_000

/** Miqdor: butun son, kamida 1. Aks holda null. (Manfiy/kasr miqdor zaxirani buzar edi.) */
export function parseQty(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_QTY) return null
  return n
}

export interface NormalizedItem { sparePartId: string; quantity: number }

/** Qatorlarni tekshiradi va bir qismning takroriy qatorlarini yig'adi. */
export function normalizeItems(items: unknown): { items: NormalizedItem[]; error?: string } {
  if (!Array.isArray(items) || items.length === 0) return { items: [], error: 'Kamida bitta ehtiyot qism tanlang' }
  const map = new Map<string, number>()
  for (const raw of items) {
    const it = (raw || {}) as { sparePartId?: unknown; quantity?: unknown }
    if (!it.sparePartId || typeof it.sparePartId !== 'string') return { items: [], error: 'Ehtiyot qism tanlanmagan' }
    const q = parseQty(it.quantity)
    if (q == null) return { items: [], error: "Miqdor butun son bo'lishi va kamida 1 bo'lishi kerak" }
    map.set(it.sparePartId, (map.get(it.sparePartId) || 0) + q)
  }
  return { items: [...map.entries()].map(([sparePartId, quantity]) => ({ sparePartId, quantity })) }
}

export type BatchAction = 'ship' | 'receive' | 'reject'

/**
 * Kim qaysi amalni bajara oladi.
 * allowedWarehouseIds === null — cheklovsiz (super_admin).
 * Yuborish — jo'natuvchi ombor tomoni; qabul qilish/rad etish — qabul qiluvchi ombor tomoni.
 * (Tashkilot admini/menejeri ikkala omborni ko'radi, shuning uchun ikkalasini bajara oladi.)
 */
export function canActOnBatch(action: BatchAction, allowedWarehouseIds: string[] | null, fromWarehouseId: string, toWarehouseId: string): boolean {
  if (allowedWarehouseIds === null) return true
  return allowedWarehouseIds.includes(action === 'ship' ? fromWarehouseId : toWarehouseId)
}

export interface ReceiveRow { id: string; quantity: number; received: number }

/**
 * Qabul qilishda haqiqiy kelgan miqdorlar. Berilmasa — hammasi to'liq kelgan deb olinadi.
 * Har bir qism uchun 0 .. jo'natilgan miqdor (butun son).
 */
export function resolveReceived(
  transfers: { id: string; quantity: number }[],
  input: { transferId?: string; receivedQuantity?: unknown }[] | undefined,
): { rows: ReceiveRow[]; shortage: number; error?: string } {
  const given = new Map<string, unknown>()
  if (input !== undefined) {
    if (!Array.isArray(input)) return { rows: [], shortage: 0, error: "Qabul qilingan miqdorlar noto'g'ri" }
    for (const r of input) {
      if (!r?.transferId || !transfers.some(t => t.id === r.transferId)) return { rows: [], shortage: 0, error: "Jo'natmada bunday qism yo'q" }
      if (given.has(r.transferId)) return { rows: [], shortage: 0, error: 'Bir qism ikki marta berilgan' }
      given.set(r.transferId, r.receivedQuantity)
    }
  }
  const rows: ReceiveRow[] = []
  let shortage = 0
  for (const t of transfers) {
    let received = t.quantity
    if (given.has(t.id)) {
      const n = Number(given.get(t.id))
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > t.quantity) {
        return { rows: [], shortage: 0, error: `Kelgan miqdor 0 dan ${t.quantity} gacha butun son bo'lishi kerak` }
      }
      received = n
    }
    shortage += t.quantity - received
    rows.push({ id: t.id, quantity: t.quantity, received })
  }
  return { rows, shortage }
}
