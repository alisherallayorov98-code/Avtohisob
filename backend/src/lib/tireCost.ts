// Ta'mir xarajatidagi shina ulushi — "Shinalarsiz" hisobot uchun.
// To'liq shina almashtirilgan mashina "eng ko'p xarajat qilingan" bo'lib chiqib ketmasin.
// Shina belgisi: MaintenanceItem.isTire, qism kategoriyasi 'tires' yoki qism nomida aniq so'z.
// ("balon"/"rezina" ataylab yo'q — metan ballon va rezina vtulka ham shunday ataladi.)
import { prisma } from './prisma'

const TIRE_WORDS = ['shina', 'шина', 'pokrishka', 'покрышк', 'tyre', ' tire']

export function isTirePart(p: { name?: string | null; category?: string | null } | null | undefined, flagged = false): boolean {
  if (flagged) return true
  if (!p) return false
  if (p.category === 'tires') return true
  const n = ` ${(p.name || '').toLowerCase()}`
  return TIRE_WORDS.some(w => n.includes(w))
}

interface MaintLike {
  cost: unknown; laborCost: unknown
  sparePart?: { name?: string | null; category?: string | null } | null
  items?: Array<{ quantityUsed: number; unitCost: unknown; isTire?: boolean | null; sparePart?: { name?: string | null; category?: string | null } | null }>
}

/**
 * Bitta ta'mirdagi shina summasi. Ta'mir faqat shinadan iborat bo'lsa — usta haqi (shina o'rnatish)
 * bilan birga to'liq; aralash bo'lsa — faqat shina qismlari (usta haqi boshqa ishga ham tegishli).
 */
export function tireShare(m: MaintLike): number {
  const total = Number(m.cost) + Number(m.laborCost)
  const items = m.items || []
  if (items.length) {
    let tire = 0, other = 0
    for (const i of items) {
      const sum = Number(i.unitCost) * i.quantityUsed
      if (isTirePart(i.sparePart, !!i.isTire)) tire += sum; else other += sum
    }
    if (tire <= 0) return 0
    return other <= 0 ? total : Math.min(tire, Number(m.cost))
  }
  return isTirePart(m.sparePart) ? total : 0
}

// Bazadan nomzodlarni olish (keng); aniq qaror tireShare/isTirePart'da
const partWhere = { OR: [{ category: 'tires' }, ...TIRE_WORDS.map(w => ({ name: { contains: w.trim(), mode: 'insensitive' } }))] }
const itemWhere = { OR: [{ isTire: true }, { sparePart: partWhere }] }

/** Shina qatnashgan ta'mirlar: id → { vehicleId, tire } (faqat shular yuklanadi — og'ir emas) */
export async function loadTireShares(where: Record<string, unknown>): Promise<Map<string, { vehicleId: string; tire: number }>> {
  const rows = await (prisma as any).maintenanceRecord.findMany({
    // Faqat tasdiqlangan ta'mirlar (hisobotlar ham faqat shularni sanaydi)
    where: { AND: [where, { status: 'approved' }, { OR: [{ items: { some: itemWhere } }, { sparePart: partWhere }] }] },
    select: {
      id: true, vehicleId: true, cost: true, laborCost: true,
      sparePart: { select: { name: true, category: true } },
      items: { select: { quantityUsed: true, unitCost: true, isTire: true, sparePart: { select: { name: true, category: true } } } },
    },
  })
  const out = new Map<string, { vehicleId: string; tire: number }>()
  for (const r of rows) {
    const tire = tireShare(r)
    if (tire > 0) out.set(r.id, { vehicleId: r.vehicleId, tire })
  }
  return out
}

/** Mashina bo'yicha shina summasi */
export async function tireCostByVehicle(where: Record<string, unknown>): Promise<Map<string, number>> {
  const shares = await loadTireShares(where)
  const m = new Map<string, number>()
  for (const s of shares.values()) m.set(s.vehicleId, (m.get(s.vehicleId) || 0) + s.tire)
  return m
}
