import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'
import { getVehicleTrackPoints } from '../../../services/wialonService'

// Haversine — ikki GPS nuqta orasidagi masofa metrda
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Berilgan mashina + sana uchun GPS trek nuqtalarini qaytaradi.
 * Wialon orqali jonli olib keladi (kesh qilinmaydi).
 *
 * Multi-tenant: foydalanuvchining tashkilot doirasidagi mashina va GPS credi bo'lsa ishlaydi.
 */
export async function getVehicleTrack(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, date, dateTo, timeFrom, timeTo } = req.query as any
    if (!vehicleId) throw new AppError('vehicleId talab qilinadi', 400)

    // Mashina foydalanuvchi doirasidami?
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        ...(branchFilter ? { branchId: branchFilter } : {}),
      },
      select: { id: true, registrationNumber: true, gpsUnitName: true, brand: true, model: true, branchId: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    // Mashina tashkiloti uchun faol GPS cred topish
    let credId: string | null = null
    if (vehicle.branchId) {
      const branch = await (prisma as any).branch.findUnique({
        where: { id: vehicle.branchId },
        select: { organizationId: true },
      })
      const orgId = branch?.organizationId ?? vehicle.branchId
      const cred = await (prisma as any).gpsCredential.findFirst({
        where: { OR: [{ orgId }, { orgId: vehicle.branchId }], isActive: true },
        select: { id: true },
      })
      credId = cred?.id ?? null
    }

    if (!credId) {
      return res.json({
        success: true,
        data: { vehicle, points: [], stats: null, error: 'GPS ulanish topilmadi' },
      })
    }

    // Sana oralig'i → UZT vaqt (UTC ga +5)
    const fromDate = new Date((date ? String(date) : new Date().toISOString().split('T')[0]) + 'T00:00:00.000Z')
    const toDate = new Date((dateTo ? String(dateTo) : (date ? String(date) : new Date().toISOString().split('T')[0])) + 'T00:00:00.000Z')
    const [fH, fM] = (timeFrom ? String(timeFrom) : '00:00').split(':').map(Number)
    const [tH, tM] = (timeTo ? String(timeTo) : '23:59').split(':').map(Number)
    const fromTs = Math.floor(fromDate.getTime() / 1000) - 5 * 3600 + (fH || 0) * 3600 + (fM || 0) * 60
    const toTs = Math.floor(toDate.getTime() / 1000) - 5 * 3600 + (tH || 23) * 3600 + (tM || 59) * 60 + 59

    const lookupKey = (vehicle.gpsUnitName || vehicle.registrationNumber).trim().toUpperCase()
    const points = await getVehicleTrackPoints(credId, lookupKey, fromTs, toTs)

    if (points.length === 0) {
      return res.json({
        success: true,
        data: {
          vehicle,
          points: [],
          stats: null,
          error: 'Bu sanada GPS ma\'lumotlari yo\'q',
        },
      })
    }

    // Statistika: jami masofa, maksimal tezlik, boshlanish/tugash vaqtlari, harakat vaqti
    let totalKm = 0
    let maxSpeed = 0
    let prev = points[0]
    for (let i = 1; i < points.length; i++) {
      const p = points[i]
      const distM = haversineM(prev.lat, prev.lon, p.lat, p.lon)
      // 50km dan kattalik — GPS xato (artefakt), o'tkazib yuboramiz
      if (distM < 50000) totalKm += distM / 1000
      if (p.speed > maxSpeed) maxSpeed = p.speed
      prev = p
    }

    const startTs = points[0].ts
    const endTs = points[points.length - 1].ts

    res.json({
      success: true,
      data: {
        vehicle,
        points,
        stats: {
          pointCount: points.length,
          totalKm: Math.round(totalKm * 10) / 10,
          maxSpeedKmh: Math.round(maxSpeed),
          startTs,
          endTs,
          durationHours: Math.round(((endTs - startTs) / 3600) * 10) / 10,
        },
      },
    })
  } catch (err) { next(err) }
}
