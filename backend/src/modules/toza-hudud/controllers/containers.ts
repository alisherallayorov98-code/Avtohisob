import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

export async function getContainers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { mfyId, page = '1', limit = '100' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const orgId = await resolveOrgId(req.user!)
    const where: any = {}
    if (orgId) where.organizationId = orgId
    if (mfyId) where.mfyId = mfyId

    const [total, containers] = await Promise.all([
      (prisma as any).thContainer.count({ where }),
      (prisma as any).thContainer.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: { mfy: { select: { id: true, name: true, district: { select: { name: true } } } } },
      }),
    ])
    res.json({
      success: true, data: containers,
      meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    })
  } catch (err) { next(err) }
}

export async function createContainer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, latitude, longitude, radiusM, mfyId, gpsZoneName } = req.body
    if (!name?.trim()) throw new AppError('Konteyner nomi kiritilishi shart', 400)
    if (latitude == null || longitude == null) throw new AppError('Koordinata talab qilinadi', 400)
    if (radiusM == null || radiusM <= 0) throw new AppError('Radius musbat son bo\'lishi kerak', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    if (mfyId) {
      const mfy = await (prisma as any).thMfy.findUnique({ where: { id: mfyId } })
      if (!mfy || mfy.organizationId !== orgId) throw new AppError('MFY topilmadi', 404)
    }

    const c = await (prisma as any).thContainer.create({
      data: {
        name: name.trim(),
        organizationId: orgId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        radiusM: Number(radiusM),
        mfyId: mfyId || null,
        gpsZoneName: gpsZoneName?.trim() || null,
      },
      include: { mfy: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: c })
  } catch (err) { next(err) }
}

export async function updateContainer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, latitude, longitude, radiusM, mfyId, gpsZoneName } = req.body
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thContainer.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Konteyner topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    if (mfyId) {
      const mfy = await (prisma as any).thMfy.findUnique({ where: { id: mfyId } })
      if (!mfy || (orgId && mfy.organizationId !== orgId)) throw new AppError('MFY topilmadi', 404)
    }

    const data: any = {}
    if (name?.trim()) data.name = name.trim()
    if (latitude != null) data.latitude = Number(latitude)
    if (longitude != null) data.longitude = Number(longitude)
    if (radiusM != null) data.radiusM = Number(radiusM)
    if (mfyId !== undefined) data.mfyId = mfyId || null
    if (gpsZoneName !== undefined) data.gpsZoneName = gpsZoneName?.trim() || null

    const c = await (prisma as any).thContainer.update({
      where: { id: req.params.id },
      data,
      include: { mfy: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: c })
  } catch (err) { next(err) }
}

export async function deleteContainer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thContainer.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Konteyner topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)
    await (prisma as any).thContainer.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
