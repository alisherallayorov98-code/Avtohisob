// EkoHisob audit jurnali — "kim, qachon, nimani o'zgartirdi".
//
// Nega: inspektorlar naqd pul yig'adi. Ilgari to'lovni yoki talonni o'chirish hech
// qayerda qayd etilmasdi — suiiste'molni aniqlashning imkoni yo'q edi. Endi pulga
// ta'sir qiluvchi har bir amal yoziladi.
//
// MUHIM: jurnal best-effort. Yozuv xatosi asosiy amalni (to'lov qabul qilish)
// hech qachon buzmasligi kerak — shuning uchun barcha xatolar yutiladi.

import { prisma } from '../../../lib/prisma'
import { EkoUserPayload } from '../middleware/ekoAuth'

export type EkoAuditAction =
  | 'payment.create'
  | 'payment.delete'
  | 'talon.create'
  | 'talon.update'
  | 'talon.paid'
  | 'talon.unpaid'
  | 'talon.delete'
  | 'entity.deactivate'
  | 'charge.recalc'

export interface EkoAuditEntry {
  action: EkoAuditAction
  targetType: 'payment' | 'talon' | 'entity' | 'charge'
  targetId?: string | null
  /** tashkilot nomi — yozuv o'chirilgandan keyin ham o'qilsin */
  targetName?: string | null
  amount?: number | null
  details?: Record<string, unknown> | null
}

// Foydalanuvchi nomi keshi — har audit yozuvida DB so'rovi qilmaslik uchun.
// Jarayon umri davomida yashaydi; nom o'zgarishi kamdan-kam va tarixga ta'sir qilmaydi.
const nameCache = new Map<string, string>()

async function resolveActorName(actor: EkoUserPayload): Promise<string> {
  const cached = nameCache.get(actor.id)
  if (cached) return cached
  let name = actor.email || '—'
  try {
    const u = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: actor.id },
      select: { fullName: true },
    })
    if (u?.fullName) name = u.fullName
  } catch { /* jurnal uchun nom muhim emas — email qoladi */ }
  nameCache.set(actor.id, name)
  return name
}

/** Audit yozuvi qo'shadi. Hech qachon xato tashlamaydi. */
export async function logEkoAudit(
  actor: EkoUserPayload | null | undefined,
  entry: EkoAuditEntry,
): Promise<void> {
  try {
    if (!actor?.orgId) return
    const userName = await resolveActorName(actor)
    await (prisma as any).ekoHisobAuditLog.create({
      data: {
        orgId: actor.orgId,
        userId: actor.id || null,
        userName,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        targetName: entry.targetName ?? null,
        amount: entry.amount ?? null,
        details: entry.details ?? undefined,
      },
    })
  } catch (err: any) {
    console.warn('[EkoAudit] jurnalga yozilmadi:', err?.message ?? err)
  }
}
