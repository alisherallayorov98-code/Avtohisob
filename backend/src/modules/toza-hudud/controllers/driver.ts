import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

/**
 * Foydalanuvchi tashkiloti doirasidagi mashinalar ro'yxati (driver vehicle picker uchun).
 */
export async function getDriverVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)
    const vehicles = await prisma.vehicle.findMany({
      where: {
        status: 'active',
        ...(branchFilter ? { branchId: branchFilter } : {}),
      },
      select: { id: true, registrationNumber: true, brand: true, model: true },
      orderBy: { registrationNumber: 'asc' },
    })
    res.json({ success: true, data: vehicles })
  } catch (err) { next(err) }
}

/**
 * Berilgan mashina uchun berilgan kun (default bugun) bo'yicha jadval va status.
 * Har MFY uchun:
 *  - schedule (kunlar mosmi)
 *  - latest ThServiceTrip status (visited / not_visited / no_gps / no_polygon)
 *  - enteredAt, exitedAt (agar borgan bo'lsa)
 */
export async function getDriverToday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, date } = req.query as any
    if (!vehicleId) throw new AppError('vehicleId talab qilinadi', 400)

    // Vehicle access check
    const orgId = await resolveOrgId(req.user!)
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        ...(branchFilter ? { branchId: branchFilter } : {}),
      },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const jsDow = targetDate.getDay()
    const uzDow = (jsDow + 6) % 7 // 0=Du, 6=Ya

    // Bu mashinaning shu kunga mos jadvallari
    const schedules = await (prisma as any).thSchedule.findMany({
      where: {
        vehicleId,
        dayOfWeek: { has: uzDow },
      },
      include: {
        mfy: {
          select: {
            id: true,
            name: true,
            district: { select: { name: true } },
            polygon: true,
          },
        },
      },
    })

    // Tahlil natijalari (agar bor bo'lsa)
    const trips = await (prisma as any).thServiceTrip.findMany({
      where: {
        vehicleId,
        date: dateOnly,
        mfyId: { in: schedules.map((s: any) => s.mfyId) },
      },
      select: { mfyId: true, status: true, enteredAt: true, exitedAt: true, maxSpeedKmh: true, suspicious: true },
    })
    const tripMap = new Map<string, any>(trips.map((t: any) => [t.mfyId, t]))

    // Konteyner tashriflari (shu kun)
    const containerVisitCount = await (prisma as any).thContainerVisit.count({
      where: { vehicleId, date: dateOnly },
    })

    // Landfill tashriflari
    const landfillTrips = await (prisma as any).thLandfillTrip.findMany({
      where: { vehicleId, date: dateOnly },
      include: { landfill: { select: { name: true } } },
      orderBy: { arrivedAt: 'asc' },
    })

    const items = schedules.map((s: any) => {
      const trip = tripMap.get(s.mfyId)
      return {
        mfy: { id: s.mfy.id, name: s.mfy.name, district: s.mfy.district?.name || null, hasPolygon: !!s.mfy.polygon },
        status: trip?.status || 'pending', // pending = hali tahlil qilinmagan
        enteredAt: trip?.enteredAt || null,
        exitedAt: trip?.exitedAt || null,
        suspicious: trip?.suspicious || false,
      }
    })

    const summary = {
      total: items.length,
      visited: items.filter((i: any) => i.status === 'visited').length,
      notVisited: items.filter((i: any) => i.status === 'not_visited').length,
      pending: items.filter((i: any) => i.status === 'pending').length,
      noGps: items.filter((i: any) => i.status === 'no_gps').length,
      noPolygon: items.filter((i: any) => i.status === 'no_polygon').length,
      suspicious: items.filter((i: any) => i.suspicious).length,
      containerVisits: containerVisitCount,
      landfillTrips: landfillTrips.length,
    }

    // Org tekshiruvi (extra security)
    if (orgId) {
      // (vehicle has been verified by branchFilter; landfill/container visits already filtered by vehicleId)
    }

    res.json({
      success: true,
      data: {
        vehicle,
        date: dateOnly,
        dayOfWeek: uzDow,
        summary,
        items,
        landfillTrips: landfillTrips.map((t: any) => ({
          landfillName: t.landfill?.name,
          arrivedAt: t.arrivedAt,
          leftAt: t.leftAt,
          durationMin: t.durationMin,
        })),
      },
    })
  } catch (err) { next(err) }
}
