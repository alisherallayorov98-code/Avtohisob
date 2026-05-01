/**
 * Universal arxiv xizmati.
 *
 * Modullarning DELETE operatsiyasi shu yerga snapshot yozadi → keyin tikla mumkin.
 *
 * Muhim qoidalar:
 * - Snapshot to'liq bo'lishi shart (bog'liq yozuvlar — items, evidence va h.k. ham qo'shilsin)
 * - Restore o'chirilgan tartibga teskari amalga oshiriladi (parent → children)
 * - Multi-tenant: organizationId saqlanadi, faqat o'sha tashkilot tikla oladi
 * - Default 90 kun saqlanadi, keyin avto-tozalash
 */
import { prisma } from '../lib/prisma'

const DEFAULT_TTL_DAYS = 90

export interface ArchiveSnapshot {
  /** Asosiy yozuv */
  primary: any
  /** Bog'liq yozuvlar (modulga qarab — items, evidence, va h.k.) */
  related?: Record<string, any[]>
}

/**
 * Yozuvni arxivga qo'yib, asl jadvaldan o'chiradi (transaction ichida).
 * @param entityType  Jadval/model nomi (masalan 'MaintenanceRecord')
 * @param entityId    Asosiy yozuv id si
 * @param entityLabel Foydalanuvchiga ko'rsatish uchun yorliq
 * @param snapshot    To'liq snapshot (primary + related)
 * @param organizationId Tashkilot id (multi-tenant uchun)
 * @param deletedById Kim o'chirayotgani
 * @param deleteFn    Asl jadvallardan o'chirish funksiyasi (transaction client'i bilan ishlasin)
 * @param reason      Ixtiyoriy: nima uchun o'chirildi
 * @returns Yaratilgan archive yozuvi
 */
export async function archiveAndDelete(opts: {
  entityType: string
  entityId: string
  entityLabel: string
  snapshot: ArchiveSnapshot
  organizationId: string | null
  deletedById: string
  deleteFn: (tx: any) => Promise<void>
  reason?: string
  ttlDays?: number
}) {
  const ttl = opts.ttlDays ?? DEFAULT_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000)

  return await prisma.$transaction(async (tx: any) => {
    // 1) Avval asl yozuvlarni o'chiramiz (cascade ham ishlaydi)
    await opts.deleteFn(tx)
    // 2) Snapshot ni archive ga yozamiz
    return await tx.archive.create({
      data: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        entityLabel: opts.entityLabel,
        snapshot: opts.snapshot as any,
        organizationId: opts.organizationId,
        deletedById: opts.deletedById,
        reason: opts.reason ?? null,
        expiresAt,
      },
    })
  })
}

/**
 * Arxivdagi yozuvni asl joyga qaytaradi.
 * @param archiveId          Archive yozuvi id si
 * @param restoreFn          Snapshot dan asl jadvallarga yozish funksiyasi (tx client bilan)
 */
export async function restoreFromArchive(
  archiveId: string,
  restoreFn: (tx: any, snapshot: ArchiveSnapshot) => Promise<void>,
) {
  return await prisma.$transaction(async (tx: any) => {
    const arch = await tx.archive.findUnique({ where: { id: archiveId } })
    if (!arch) throw new Error('Arxiv yozuvi topilmadi')
    if (arch.isRestored) throw new Error('Bu yozuv allaqachon tiklangan')
    await restoreFn(tx, arch.snapshot as ArchiveSnapshot)
    await tx.archive.update({
      where: { id: archiveId },
      data: { isRestored: true, restoredAt: new Date() },
    })
  })
}

/**
 * Eski (expiresAt o'tgan yoki tiklangan) archive yozuvlarini avto-tozalash.
 * Cron tomonidan kuniga 1 marta chaqiriladi.
 */
export async function cleanupExpiredArchive(): Promise<number> {
  const result = await (prisma as any).archive.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRestored: true, restoredAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
  })
  return result.count ?? 0
}
