/**
 * Arxiv boshqaruvi:
 *  - getArchive: list (filter, pagination)
 *  - restoreArchive: yozuvni asl joyga qaytaradi (entityType bo'yicha)
 *  - permanentDelete: arxivdan butunlay o'chiradi
 *
 * Multi-tenant: foydalanuvchi faqat o'z org arxivini ko'radi va boshqaradi.
 * Faqat admin/manager rollarga ruxsat (route'da tekshiriladi).
 */
import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { resolveOrgId } from '../lib/orgFilter'
import { restoreFromArchive } from '../services/archiveService'
import { restoreMaintenanceRecord } from '../services/restorers/maintenanceRestorer'

// Modulga qarab restore funksiyasi tanlanadi.
// Yangi modul qo'shilganda shu yerga qator qo'shing.
const RESTORERS: Record<string, (tx: any, snapshot: any) => Promise<void>> = {
  MaintenanceRecord: restoreMaintenanceRecord,
}

export async function getArchive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { entityType, search, includeRestored } = req.query as any
    const orgId = await resolveOrgId(req.user!)

    const where: any = {}
    if (orgId) where.organizationId = orgId
    if (entityType) where.entityType = entityType
    if (!includeRestored || includeRestored === 'false') where.isRestored = false
    if (search && typeof search === 'string' && search.trim()) {
      where.entityLabel = { contains: search.trim(), mode: 'insensitive' }
    }

    const [total, items, byType] = await Promise.all([
      (prisma as any).archive.count({ where }),
      (prisma as any).archive.findMany({
        where,
        skip,
        take: limit,
        orderBy: { deletedAt: 'desc' },
        include: { deletedBy: { select: { fullName: true } } },
      }),
      // Modul bo'yicha xulosa (badge'lar uchun)
      (prisma as any).archive.groupBy({
        by: ['entityType'],
        where: orgId ? { organizationId: orgId, isRestored: false } : { isRestored: false },
        _count: true,
      }),
    ])

    res.json({
      success: true,
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      stats: byType.map((b: any) => ({ entityType: b.entityType, count: b._count })),
    })
  } catch (err) { next(err) }
}

export async function restoreArchive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const orgId = await resolveOrgId(req.user!)
    const arch = await (prisma as any).archive.findUnique({ where: { id } })
    if (!arch) throw new AppError('Arxiv yozuvi topilmadi', 404)
    if (orgId && arch.organizationId && arch.organizationId !== orgId) {
      throw new AppError('Ruxsat yo\'q', 403)
    }
    if (arch.isRestored) throw new AppError('Bu yozuv allaqachon tiklangan', 400)

    const restorer = RESTORERS[arch.entityType]
    if (!restorer) {
      throw new AppError(`${arch.entityType} turini tiklash hozircha qo'llab-quvvatlanmaydi`, 400)
    }

    await restoreFromArchive(id, restorer)
    res.json(successResponse(null, 'Yozuv tiklandi'))
  } catch (err) { next(err) }
}

export async function permanentDeleteArchive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const orgId = await resolveOrgId(req.user!)
    const arch = await (prisma as any).archive.findUnique({ where: { id } })
    if (!arch) throw new AppError('Arxiv yozuvi topilmadi', 404)
    if (orgId && arch.organizationId && arch.organizationId !== orgId) {
      throw new AppError('Ruxsat yo\'q', 403)
    }
    await (prisma as any).archive.delete({ where: { id } })
    res.json(successResponse(null, "Arxivdan butunlay o'chirildi"))
  } catch (err) { next(err) }
}
