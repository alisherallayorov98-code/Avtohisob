import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getOrgFilter, applyNarrowedBranchFilter, resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

// Tashkilot doirasidagi vehicleId larni qaytaradi
async function orgVehicleIds(req: AuthRequest, requestedBranchId?: string): Promise<string[]> {
  const filter = await getOrgFilter(req.user!)
  const branchFilter = applyNarrowedBranchFilter(filter, requestedBranchId)
  const vs = await prisma.vehicle.findMany({
    where: branchFilter ? { branchId: branchFilter } : {},
    select: { id: true },
  })
  return vs.map(v => v.id)
}

export async function getSchedules(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const vIds = await orgVehicleIds(req, branchId)
    if (vIds.length === 0) return res.json({ success: true, data: [] })

    const schedules = await (prisma as any).thSchedule.findMany({
      where: { vehicleId: { in: vIds } },
      include: {
        mfy: { include: { district: { select: { id: true, name: true } } } },
      },
    })
    res.json({ success: true, data: schedules })
  } catch (err) { next(err) }
}

export async function upsertSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, mfyId, dayOfWeek } = req.body
    if (!vehicleId || !mfyId) throw new AppError('vehicleId va mfyId talab qilinadi', 400)

    // Auth: vehicle va mfy shu tashkilotga tegishli ekanligini tekshiramiz
    const orgId = await resolveOrgId(req.user!)
    const vIds = await orgVehicleIds(req)
    if (!vIds.includes(vehicleId)) throw new AppError('Mashina topilmadi', 404)

    const mfy = await (prisma as any).thMfy.findUnique({ where: { id: mfyId } })
    if (!mfy) throw new AppError('MFY topilmadi', 404)
    if (orgId && mfy.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const days = Array.isArray(dayOfWeek) ? dayOfWeek.map(Number).filter(d => d >= 0 && d <= 6) : []

    if (days.length === 0) {
      await (prisma as any).thSchedule.deleteMany({ where: { vehicleId, mfyId } })
      return res.json({ success: true, data: null, message: "Jadvaldan o'chirildi" })
    }

    const schedule = await (prisma as any).thSchedule.upsert({
      where: { vehicleId_mfyId: { vehicleId, mfyId } },
      create: { vehicleId, mfyId, dayOfWeek: days },
      update: { dayOfWeek: days },
      include: { mfy: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: schedule })
  } catch (err) { next(err) }
}

export async function deleteSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vIds = await orgVehicleIds(req)
    if (!vIds.includes(req.params.vehicleId)) throw new AppError('Ruxsat yo\'q', 403)

    await (prisma as any).thSchedule.deleteMany({
      where: { vehicleId: req.params.vehicleId, mfyId: req.params.mfyId },
    })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
