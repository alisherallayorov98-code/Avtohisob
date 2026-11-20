// Ta'mir xarajatidagi shina ulushi — "Shinalarsiz" hisobot uchun.
// To'liq shina almashtirilgan mashina "eng ko'p xarajat qilingan" bo'lib chiqib ketmasin.
// Shina belgisi (har biri sababi bilan — hujjatda ko'rsatiladi, admin tekshira oladi):
//   MaintenanceItem.isTire · qism kategoriyasi 'tires' · nomda shina/balon/pokrishka/tyre ·
//   shina o'lchami (315/80R22.5, 12.00R20, 12.00-20, R22.5) · qismsiz ta'mir izohida "shina".
// "Balon" metan/gaz ballon bo'lsa — shina emas.
import { prisma } from './prisma'

type Part = { name?: string | null; category?: string | null } | null | undefined

const WORDS: Array<[RegExp, string]> = [
  [/shina|шина|shinа/i, 'shina'],
  [/pokri[sş]hk|покрышк/i, 'pokrishka'],
  [/\btyres?\b|\btires?\b/i, 'tire'],
  [/bal+on|бал+он/i, 'balon'],
]
// "Balon" shina emas: metan/gaz ballon, ballon kalit va h.k.
const NOT_TIRE_BALON = /metan|метан|gaz|газ|propan|пропан|kislorod|кислород|kalit|klyuch|ключ|gbo|гбо|cng|lpg|\d+\s*(l|л|litr|литр)\b/i
const SIZES: RegExp[] = [
  /\b\d{3}\s*\/\s*\d{2}\s*[-\s]?z?r\s*\d{2}(?:[.,]\d)?/i, // 315/80R22.5, 205/55 R16
  /\b\d{1,2}[.,]\d{2}\s*[-\s]?r\s*\d{2}(?:[.,]\d)?/i,     // 12.00R20, 11.00 R22.5
  /\b\d{1,2}[.,]\d{2}\s*-\s*\d{2}\b/,                    // 12.00-20 (diagonal)
  /\br\s?(?:1[3-9]|2[0-4])(?:[.,]5)?c?\b/i,              // R22.5, R16C
]

/** Qism shinami — sababi bilan (null = shina emas) */
export function tireReason(p: Part, flagged = false): string | null {
  if (flagged) return 'shina belgisi qo\'yilgan'
  if (!p) return null
  if (p.category === 'tires') return 'kategoriya: Shinalar'
  const name = p.name || ''
  for (const [re, label] of WORDS) {
    if (!re.test(name)) continue
    if (label === 'balon' && NOT_TIRE_BALON.test(name)) continue
    return `nomida "${label}"`
  }
  for (const re of SIZES) {
    const m = name.match(re)
    if (m) return `shina o'lchami ${m[0].trim()}`
  }
  return null
}

export const isTirePart = (p: Part, flagged = false): boolean => tireReason(p, flagged) != null

interface MaintLike {
  cost: unknown; laborCost: unknown; notes?: string | null
  sparePart?: { name?: string | null; category?: string | null } | null
  items?: Array<{ quantityUsed: number; unitCost: unknown; isTire?: boolean | null; sparePart?: { name?: string | null; category?: string | null } | null }>
}

export interface TireLine { name: string; qty: number; amount: number; reason: string }

/**
 * Bitta ta'mirdagi shina summasi va qatorlari.
 * - Faqat shinadan iborat ta'mir — usta haqi (o'rnatish) bilan to'liq.
 * - Aralash ta'mir — shina qismlari (narxi kiritilmagan bo'lsa — miqdor ulushi bo'yicha qismlar summasidan).
 * - Qismsiz ta'mir: qism yoki izoh shina bo'lsa — to'liq.
 */
export function tireBreakdown(m: MaintLike): { tire: number; lines: TireLine[] } {
  const cost = Number(m.cost) || 0
  const total = cost + (Number(m.laborCost) || 0)
  const items = m.items || []
  if (items.length) {
    const rows = items.map(i => ({ i, reason: tireReason(i.sparePart, !!i.isTire), sum: (Number(i.unitCost) || 0) * i.quantityUsed }))
    const tireRows = rows.filter(r => r.reason)
    if (!tireRows.length) return { tire: 0, lines: [] }
    const allTire = tireRows.length === rows.length
    const itemsSum = rows.reduce((s, r) => s + r.sum, 0)
    const tireSum = tireRows.reduce((s, r) => s + r.sum, 0)
    let tire: number
    if (allTire) tire = total
    else if (itemsSum > 0) tire = Math.min(tireSum, cost)
    else {
      // Donalik narxlar kiritilmagan — qismlar summasi miqdor ulushi bo'yicha bo'linadi
      const q = rows.reduce((s, r) => s + r.i.quantityUsed, 0) || 1
      tire = cost * (tireRows.reduce((s, r) => s + r.i.quantityUsed, 0) / q)
    }
    const share = tireSum > 0 ? tire / tireSum : 0
    const lines = tireRows.map(r => ({
      name: r.i.sparePart?.name || 'Shina', qty: r.i.quantityUsed, reason: r.reason!,
      amount: Math.round(tireSum > 0 ? r.sum * share : tire / tireRows.length),
    }))
    return { tire: Math.round(tire), lines }
  }
  const reason = tireReason(m.sparePart) || (m.notes && tireReason({ name: m.notes }) ? `izohda: ${tireReason({ name: m.notes })}` : null)
  if (!reason) return { tire: 0, lines: [] }
  return { tire: Math.round(total), lines: [{ name: m.sparePart?.name || (m.notes || 'Shina').slice(0, 80), qty: 1, amount: Math.round(total), reason }] }
}

export const tireShare = (m: MaintLike): number => tireBreakdown(m).tire

export interface TireShare { vehicleId: string; tire: number; date: Date; lines: TireLine[]; workerName: string | null }

/**
 * Tasdiqlangan ta'mirlardagi shina ulushlari: id → ulush.
 * Nom bo'yicha aniqlash bazada qilib bo'lmaydi (o'lcham naqshlari), shuning uchun davrdagi
 * ta'mirlar yengil select bilan yuklanadi va JS'da tekshiriladi.
 */
export async function loadTireShares(where: Record<string, unknown>): Promise<Map<string, TireShare>> {
  const rows = await (prisma as any).maintenanceRecord.findMany({
    // Faqat tasdiqlangan ta'mirlar (hisobotlar ham faqat shularni sanaydi)
    where: { AND: [where, { status: 'approved' }] },
    select: {
      id: true, vehicleId: true, cost: true, laborCost: true, notes: true, installationDate: true, workerName: true,
      sparePart: { select: { name: true, category: true } },
      items: { select: { quantityUsed: true, unitCost: true, isTire: true, sparePart: { select: { name: true, category: true } } } },
    },
  })
  const out = new Map<string, TireShare>()
  for (const r of rows) {
    const b = tireBreakdown(r)
    if (b.tire > 0) out.set(r.id, { vehicleId: r.vehicleId, tire: b.tire, date: new Date(r.installationDate), lines: b.lines, workerName: r.workerName })
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
