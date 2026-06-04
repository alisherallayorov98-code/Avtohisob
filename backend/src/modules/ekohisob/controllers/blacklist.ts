import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

export async function listBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { districtId } = req.query

    const entityWhere: any = { orgId }
    if (role === 'inspector') {
      entityWhere.districtId = { in: districtIds }
    }
    if (districtId) {
      if (role === 'inspector' && !districtIds.includes(String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = String(districtId)
    }

    const orgEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      select: { id: true },
    })
    const entityIds = orgEntities.map((e: any) => e.id)

    const blacklist = await (prisma as any).ekoHisobBlacklist.findMany({
      where: { entityId: { in: entityIds } },
      include: {
        entity: {
          select: {
            id: true, name: true, address: true, stir: true, code: true,
            district: { select: { id: true, name: true } },
            mahalla: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { addedAt: 'desc' },
    })

    res.json({ success: true, data: blacklist })
  } catch (err) { next(err) }
}

export async function addToBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId, role, districtIds } = req.ekoUser!
    const { entityId, reason, govOrgName, govCaseId } = req.body

    if (!entityId || !reason || !String(reason).trim()) {
      res.status(400).json({ success: false, error: 'entityId va reason talab qilinadi' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    // Check if already in blacklist
    const existing = await (prisma as any).ekoHisobBlacklist.findUnique({ where: { entityId } })
    if (existing) {
      res.status(409).json({ success: false, error: 'Bu tashkilot allaqachon qora ro\'yxatda' })
      return
    }

    // Use transaction to update entity status and create blacklist entry
    const [blacklistEntry] = await (prisma as any).$transaction([
      (prisma as any).ekoHisobBlacklist.create({
        data: {
          entityId,
          reason: String(reason).trim(),
          addedBy: userId,
          govOrgName: govOrgName ? String(govOrgName).trim() : null,
          govCaseId: govCaseId ? String(govCaseId).trim() : null,
        },
      }),
      (prisma as any).ekoHisobLegalEntity.update({
        where: { id: entityId },
        data: { status: 'blacklisted' },
      }),
    ])

    res.status(201).json({ success: true, data: blacklistEntry })
  } catch (err) { next(err) }
}

export async function updateBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { status, reason, govOrgName, govCaseId } = req.body

    const entry = await (prisma as any).ekoHisobBlacklist.findUnique({
      where: { id },
      include: { entity: { select: { orgId: true } } },
    })
    if (!entry || entry.entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Qora ro\'yxat yozuvi topilmadi' })
      return
    }

    const data: any = {}
    if (status !== undefined) {
      const allowed = ['active', 'resolved']
      if (!allowed.includes(status)) {
        res.status(400).json({ success: false, error: 'Status noto\'g\'ri. Mumkin: active, resolved' })
        return
      }
      data.status = status
    }
    if (reason !== undefined) data.reason = String(reason).trim()
    if (govOrgName !== undefined) data.govOrgName = govOrgName ? String(govOrgName).trim() : null
    if (govCaseId !== undefined) data.govCaseId = govCaseId ? String(govCaseId).trim() : null

    const updated = await (prisma as any).ekoHisobBlacklist.update({
      where: { id },
      data,
    })

    // If resolved, update entity status back to active
    if (status === 'resolved') {
      await (prisma as any).ekoHisobLegalEntity.update({
        where: { id: entry.entityId },
        data: { status: 'active' },
      })
    }

    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

export async function removeFromBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params

    const entry = await (prisma as any).ekoHisobBlacklist.findUnique({
      where: { id },
      include: { entity: { select: { orgId: true, id: true } } },
    })
    if (!entry || entry.entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Qora ro\'yxat yozuvi topilmadi' })
      return
    }

    await (prisma as any).$transaction([
      (prisma as any).ekoHisobBlacklist.delete({ where: { id } }),
      (prisma as any).ekoHisobLegalEntity.update({
        where: { id: entry.entity.id },
        data: { status: 'active' },
      }),
    ])

    res.json({ success: true, data: null, message: 'Qora ro\'yxatdan olib tashlandi' })
  } catch (err) { next(err) }
}
