import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getVehicleTracksBatch } from '../../../services/wialonService'

/** Ikki koordinata orasidagi masofa (metr). */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // metr
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * GET /entities/:id/service-proof?date=YYYY-MM-DD&radiusM=150
 *
 * Tashkilot "xizmat ko'rsatilmadi" desa — chiqindi mashinasining GPS treki uning
 * manzilidan o'tganini isbotlaydi. Org mashinalarining o'sha kungi treklarini olib
 * (asosiy ilovaning Wialon kredensiali orqali, FAQAT o'qish), tashkilot koordinatasidan
 * radiusM ichidagi nuqtalarni topadi.
 *
 * Sozlama: EkoHisob orgId = asosiy ilova organization (root Branch) id bo'lishi kerak —
 * GPS kredensiali (GpsCredential.orgId) va mashinalar shu org bo'yicha topiladi.
 */
export async function getServiceProof(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params
    const dateStr = String(req.query.date || '')
    const radiusM = Math.min(Math.max(parseInt(String(req.query.radiusM || '150')) || 150, 20), 1000)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ success: false, error: 'date formati: "YYYY-MM-DD"' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      select: { id: true, name: true, orgId: true, districtId: true, lat: true, lon: true, address: true },
    })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }
    if (entity.lat == null || entity.lon == null) {
      res.status(400).json({ success: false, error: 'Tashkilot koordinatasi belgilanmagan' })
      return
    }

    // GPS kredensiali (asosiy ilova, org bo'yicha)
    const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
    if (!cred || !cred.isActive) {
      res.json({ success: true, data: { available: false, reason: 'GPS ulanmagan', date: dateStr } })
      return
    }

    // Org mashinalari (asosiy ilovadan o'qish): root branch yoki uning sub-branchlari
    const branches = await prisma.branch.findMany({
      where: { OR: [{ organizationId: orgId }, { id: orgId }] },
      select: { id: true },
    })
    const branchIds = branches.map((b) => b.id)
    const vehicles = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds } },
      select: { id: true, registrationNumber: true, gpsUnitName: true },
    })
    if (vehicles.length === 0) {
      res.json({ success: true, data: { available: false, reason: 'Mashinalar topilmadi', date: dateStr } })
      return
    }

    // Mahalliy kun (UTC+5) → unix sekund
    const fromTs = Math.floor(new Date(`${dateStr}T00:00:00+05:00`).getTime() / 1000)
    const toTs = Math.floor(new Date(`${dateStr}T23:59:59+05:00`).getTime() / 1000)

    const lookup = vehicles.map((v) => ({
      vehicleId: v.id,
      lookupKey: v.gpsUnitName || v.registrationNumber,
    }))
    const tracks = await getVehicleTracksBatch(cred.id, lookup, fromTs, toTs)

    // Har mashina uchun eng yaqin nuqta + radius ichidagi nuqtalar
    const regMap = new Map(vehicles.map((v) => [v.id, v.registrationNumber]))
    const passing: any[] = []
    for (const [vehicleId, points] of tracks) {
      if (!points || points.length === 0) continue
      let closest = Infinity
      let closestTs = 0
      const nearby: Array<{ lat: number; lon: number; ts: number }> = []
      for (const p of points) {
        const d = haversineMeters(entity.lat, entity.lon, p.lat, p.lon)
        if (d < closest) { closest = d; closestTs = p.ts }
        if (d <= radiusM) nearby.push({ lat: p.lat, lon: p.lon, ts: p.ts })
      }
      if (closest <= radiusM) {
        passing.push({
          vehicleId,
          registrationNumber: regMap.get(vehicleId) || '',
          closestMeters: Math.round(closest),
          passedAt: new Date(closestTs * 1000).toISOString(),
          nearbyCount: nearby.length,
          nearbyPoints: nearby.slice(0, 200),
        })
      }
    }

    passing.sort((a, b) => a.closestMeters - b.closestMeters)

    res.json({
      success: true,
      data: {
        available: true,
        date: dateStr,
        radiusM,
        entity: { id: entity.id, name: entity.name, address: entity.address, lat: entity.lat, lon: entity.lon },
        served: passing.length > 0,
        passingVehicles: passing,
      },
    })
  } catch (err) { next(err) }
}
