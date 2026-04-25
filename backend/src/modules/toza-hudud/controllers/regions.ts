import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

export async function getRegions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const regions = await (prisma as any).thRegion.findMany({
      where: orgId ? { organizationId: orgId } : {},
      orderBy: { name: 'asc' },
      include: { _count: { select: { districts: true } } },
    })
    res.json({ success: true, data: regions })
  } catch (err) { next(err) }
}

export async function createRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name } = req.body
    if (!name?.trim()) throw new AppError('Viloyat nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)
    const region = await (prisma as any).thRegion.create({
      data: { name: name.trim(), organizationId: orgId },
    })
    res.status(201).json({ success: true, data: region })
  } catch (err) { next(err) }
}

export async function updateRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name } = req.body
    if (!name?.trim()) throw new AppError('Viloyat nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thRegion.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Viloyat topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const region = await (prisma as any).thRegion.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    })
    res.json({ success: true, data: region })
  } catch (err) { next(err) }
}

export async function deleteRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thRegion.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Viloyat topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const count = await (prisma as any).thDistrict.count({ where: { regionId: req.params.id } })
    if (count > 0) throw new AppError(`Bu viloyatda ${count} ta tuman bor. Avval tumanlarni o'chiring.`, 400)
    await (prisma as any).thRegion.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
