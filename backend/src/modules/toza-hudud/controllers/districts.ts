import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

export async function getDistricts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { regionId, page = '1', limit = '50' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const orgId = await resolveOrgId(req.user!)
    const where: any = {}
    if (orgId) where.organizationId = orgId
    if (regionId) where.regionId = regionId

    const [total, districts] = await Promise.all([
      (prisma as any).thDistrict.count({ where }),
      (prisma as any).thDistrict.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          region: { select: { id: true, name: true } },
          _count: { select: { mfys: true } },
        },
      }),
    ])
    res.json({ success: true, data: districts, meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function createDistrict(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, regionId } = req.body
    if (!name?.trim()) throw new AppError('Tuman nomi kiritilishi shart', 400)
    if (!regionId) throw new AppError('Viloyat tanlanishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const region = await (prisma as any).thRegion.findUnique({ where: { id: regionId } })
    if (!region || region.organizationId !== orgId) throw new AppError('Viloyat topilmadi', 404)

    const district = await (prisma as any).thDistrict.create({
      data: { name: name.trim(), regionId, organizationId: orgId },
      include: { region: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function updateDistrict(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, regionId } = req.body
    if (!name?.trim()) throw new AppError('Tuman nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thDistrict.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Tuman topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const district = await (prisma as any).thDistrict.update({
      where: { id: req.params.id },
      data: { name: name.trim(), ...(regionId && { regionId }) },
      include: { region: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function deleteDistrict(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thDistrict.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Tuman topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const count = await (prisma as any).thMfy.count({ where: { districtId: req.params.id } })
    if (count > 0) throw new AppError(`Bu tumanda ${count} ta MFY bor. Avval MFYlarni o'chiring.`, 400)
    await (prisma as any).thDistrict.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
