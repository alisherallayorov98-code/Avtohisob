import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

export async function getLandfills(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const landfills = await (prisma as any).thLandfill.findMany({
      where: orgId ? { organizationId: orgId } : {},
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: landfills })
  } catch (err) { next(err) }
}

export async function createLandfill(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, polygon } = req.body
    if (!name?.trim()) throw new AppError('Poligon nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const landfill = await (prisma as any).thLandfill.create({
      data: {
        name: name.trim(),
        location: location?.trim() || null,
        organizationId: orgId,
        polygon: polygon || null,
      },
    })
    res.status(201).json({ success: true, data: landfill })
  } catch (err) { next(err) }
}

export async function updateLandfill(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, polygon } = req.body
    if (!name?.trim()) throw new AppError('Poligon nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thLandfill.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Poligon topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const landfill = await (prisma as any).thLandfill.update({
      where: { id: req.params.id },
      data: {
        name: name.trim(),
        location: location?.trim() || null,
        ...(polygon !== undefined && { polygon: polygon || null }),
      },
    })
    res.json({ success: true, data: landfill })
  } catch (err) { next(err) }
}

export async function deleteLandfill(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thLandfill.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Poligon topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)
    await (prisma as any).thLandfill.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
