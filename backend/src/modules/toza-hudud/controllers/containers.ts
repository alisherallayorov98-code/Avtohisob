import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId, getOrgFilter, applyNarrowedBranchFilter } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

async function orgVehicleIds(req: AuthRequest, requestedBranchId?: string): Promise<string[]> {
  const filter = await getOrgFilter(req.user!)
  const branchFilter = applyNarrowedBranchFilter(filter, requestedBranchId)
  const vs = await prisma.vehicle.findMany({
    where: branchFilter ? { branchId: branchFilter } : {},
    select: { id: true },
  })
  return vs.map(v => v.id)
}

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

// Berilgan sana uchun konteyner tashriflari ro'yxati (vehicle, container, arrivedAt, durationMin)
export async function getContainerVisits(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { date, branchId, containerId } = req.query as any
    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const vIds = await orgVehicleIds(req, branchId)
    if (vIds.length === 0) return res.json({ success: true, data: [] })

    const where: any = { date: dateOnly, vehicleId: { in: vIds } }
    if (containerId) where.containerId = containerId

    const visits = await (prisma as any).thContainerVisit.findMany({
      where,
      include: {
        container: { select: { id: true, name: true, latitude: true, longitude: true, mfy: { select: { id: true, name: true } } } },
      },
      orderBy: [{ arrivedAt: 'asc' }],
    })

    // Vehicle ma'lumotlarini alohida olish
    const vehicleIds = [...new Set<string>(visits.map((v: any) => v.vehicleId as string))]
    const vehicles = vehicleIds.length
      ? await prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: { id: true, registrationNumber: true, brand: true, model: true },
        })
      : []
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    res.json({
      success: true,
      data: visits.map((v: any) => ({ ...v, vehicle: vehicleMap.get(v.vehicleId) || null })),
    })
  } catch (err) { next(err) }
}

// Berilgan sana yoki davr uchun har konteyner bo'yicha jami tashriflar soni (xulosa)
export async function getContainerVisitStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { date, fromDate, toDate, branchId } = req.query as any
    const orgId = await resolveOrgId(req.user!)
    const vIds = await orgVehicleIds(req, branchId)
    if (vIds.length === 0) return res.json({ success: true, data: [] })

    const dateFilter: any = {}
    if (fromDate || toDate) {
      if (fromDate) dateFilter.gte = new Date(new Date(fromDate as string).toISOString().split('T')[0] + 'T00:00:00.000Z')
      if (toDate) dateFilter.lte = new Date(new Date(toDate as string).toISOString().split('T')[0] + 'T00:00:00.000Z')
    } else if (date) {
      const d = new Date(new Date(date as string).toISOString().split('T')[0] + 'T00:00:00.000Z')
      dateFilter.equals = d
    } else {
      // Default: bugungi kun
      const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z')
      dateFilter.equals = today
    }

    const grouped = await (prisma as any).thContainerVisit.groupBy({
      by: ['containerId'],
      where: { vehicleId: { in: vIds }, date: dateFilter },
      _count: { id: true },
    })

    const containerIds = grouped.map((g: any) => g.containerId)
    const containers = containerIds.length
      ? await (prisma as any).thContainer.findMany({
          where: { id: { in: containerIds }, ...(orgId ? { organizationId: orgId } : {}) },
          select: { id: true, name: true, mfy: { select: { id: true, name: true } } },
        })
      : []
    const cMap = new Map(containers.map((c: any) => [c.id, c]))

    const data = grouped
      .map((g: any) => ({
        container: cMap.get(g.containerId),
        visitCount: g._count.id,
      }))
      .filter((r: any) => r.container)
      .sort((a: any, b: any) => b.visitCount - a.visitCount)

    res.json({ success: true, data })
  } catch (err) { next(err) }
}
