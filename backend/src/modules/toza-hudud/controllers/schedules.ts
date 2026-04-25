import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export async function getSchedules(req: Request, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const where: any = {}
    if (branchId) {
      // branchId ga biriktirilgan mashinalar
      where.vehicle = { branchId }
    }
    const schedules = await (prisma as any).thSchedule.findMany({
      where,
      include: {
        mfy: { include: { district: { select: { id: true, name: true } } } },
      },
    })
    res.json({ success: true, data: schedules })
  } catch (err) { next(err) }
}

export async function upsertSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const { vehicleId, mfyId, dayOfWeek } = req.body
    if (!vehicleId || !mfyId) throw new AppError('vehicleId va mfyId talab qilinadi', 400)

    const days = Array.isArray(dayOfWeek) ? dayOfWeek.map(Number).filter(d => d >= 0 && d <= 6) : []

    if (days.length === 0) {
      // Kun yo'q — o'chirish
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

export async function deleteSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    await (prisma as any).thSchedule.deleteMany({
      where: { vehicleId: req.params.vehicleId, mfyId: req.params.mfyId },
    })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
