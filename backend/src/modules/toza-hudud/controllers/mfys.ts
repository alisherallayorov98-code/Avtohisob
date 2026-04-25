import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

export async function getMfys(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { districtId, regionId, page = '1', limit = '50' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const orgId = await resolveOrgId(req.user!)
    const where: any = {}
    if (orgId) where.organizationId = orgId
    if (districtId) where.districtId = districtId
    if (regionId) where.district = { regionId }

    const [total, mfys] = await Promise.all([
      (prisma as any).thMfy.count({ where }),
      (prisma as any).thMfy.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          district: { include: { region: { select: { id: true, name: true } } } },
        },
      }),
    ])
    res.json({ success: true, data: mfys, meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function createMfy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, districtId, polygon, gpsZoneName } = req.body
    if (!name?.trim()) throw new AppError('MFY nomi kiritilishi shart', 400)
    if (!districtId) throw new AppError('Tuman tanlanishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const district = await (prisma as any).thDistrict.findUnique({ where: { id: districtId } })
    if (!district || district.organizationId !== orgId) throw new AppError('Tuman topilmadi', 404)

    const mfy = await (prisma as any).thMfy.create({
      data: {
        name: name.trim(),
        districtId,
        organizationId: orgId,
        polygon: polygon || null,
        gpsZoneName: gpsZoneName?.trim() || null,
      },
      include: { district: { include: { region: { select: { id: true, name: true } } } } },
    })
    res.status(201).json({ success: true, data: mfy })
  } catch (err) { next(err) }
}

export async function updateMfy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, districtId, polygon, gpsZoneName } = req.body
    if (!name?.trim()) throw new AppError('MFY nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thMfy.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('MFY topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const mfy = await (prisma as any).thMfy.update({
      where: { id: req.params.id },
      data: {
        name: name.trim(),
        ...(districtId && { districtId }),
        ...(polygon !== undefined && { polygon: polygon || null }),
        ...(gpsZoneName !== undefined && { gpsZoneName: gpsZoneName?.trim() || null }),
      },
      include: { district: { include: { region: { select: { id: true, name: true } } } } },
    })
    res.json({ success: true, data: mfy })
  } catch (err) { next(err) }
}

export async function deleteMfy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thMfy.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('MFY topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)
    await (prisma as any).thMfy.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
