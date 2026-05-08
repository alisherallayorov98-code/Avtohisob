import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'
import { getWialonGeozones, syncMfyPolygonsFromGps, syncContainersFromGps, getOrgVehiclePositions } from '../../../services/wialonService'

export async function getGeozones(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const zones = await getWialonGeozones(orgId)
    res.json({ success: true, data: zones })
  } catch (err) { next(err) }
}

// Geozona polygon → MFY ga yozish (gpsZoneName ham saqlanadi → keyingi sinx avto-yangilash uchun)
export async function linkGeozoneMfy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { mfyId, points, zoneName } = req.body
    if (!mfyId || !Array.isArray(points) || points.length < 3) {
      return res.status(400).json({ success: false, error: 'mfyId va kamida 3 nuqta talab qilinadi' })
    }

    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thMfy.findUnique({ where: { id: mfyId } })
    if (!existing) throw new AppError('MFY topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const coords = [...points.map((p: any) => [p.lon, p.lat])]
    coords.push(coords[0])
    const polygon = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: {},
    }

    await (prisma as any).thMfy.update({
      where: { id: mfyId },
      data: {
        polygon,
        ...(zoneName?.trim() && { gpsZoneName: zoneName.trim() }),
      },
    })

    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}

// SmartGPS geozonaları asosida MFYlarni avtomatik yaratish
export async function importMfysFromGeozones(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { districtId } = req.body
    if (!districtId) {
      return res.status(400).json({ success: false, error: 'districtId talab qilinadi' })
    }

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const district = await (prisma as any).thDistrict.findUnique({ where: { id: districtId } })
    if (!district) throw new AppError('Tuman topilmadi', 404)
    if (district.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)

    const zones = await getWialonGeozones(orgId)
    if (zones.length === 0) {
      return res.json({ success: true, data: { created: 0, skipped: 0, total: 0 } })
    }

    const existing = await (prisma as any).thMfy.findMany({
      where: { districtId },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((m: any) => m.name.trim().toLowerCase()))

    let created = 0
    let skipped = 0

    for (const zone of zones) {
      const nameLower = zone.name.trim().toLowerCase()
      if (existingNames.has(nameLower)) { skipped++; continue }

      const coords = [...zone.points.map(p => [p.lon, p.lat])]
      coords.push(coords[0])
      const polygon = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {},
      }

      await (prisma as any).thMfy.create({
        data: {
          name: zone.name.trim(),
          gpsZoneName: zone.name.trim(),
          districtId,
          organizationId: orgId,
          polygon,
        },
      })
      existingNames.add(nameLower)
      created++
    }

    res.json({ success: true, data: { created, skipped, total: zones.length } })
  } catch (err) { next(err) }
}

// SmartGPS dan to'g'ridan-to'g'ri MFY polygonlarini sinxronlash (bitta tugma)
export async function syncPolygonsFromGps(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const result = await syncMfyPolygonsFromGps(orgId)
    res.json({
      success: true,
      data: result,
      message: `${result.updated} ta MFY yangilandi, ${result.notFound} ta nom topilmadi (${result.total} polygon)`,
    })
  } catch (err) { next(err) }
}

// Org mashinalarining joriy GPS pozitsiyalari (xaritada jonli ko'rsatish uchun)
export async function getVehiclePositions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const positions = await getOrgVehiclePositions(orgId)

    // Bugun jadvalda bo'lgan mashinalar va trip holati
    const today = new Date()
    const uzDow = (today.getUTCDay() + 6) % 7
    const dateOnly = new Date(today.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const vehicleIds = positions.map((p: any) => p.vehicleId).filter(Boolean)

    const [scheduledRows, trips] = vehicleIds.length ? await Promise.all([
      (prisma as any).thSchedule.findMany({
        where: { vehicleId: { in: vehicleIds }, dayOfWeek: { has: uzDow } },
        select: { vehicleId: true },
      }).catch(() => [] as any[]),
      (prisma as any).thServiceTrip.findMany({
        where: { vehicleId: { in: vehicleIds }, date: dateOnly },
        select: { vehicleId: true, status: true, coveragePct: true },
      }).catch(() => [] as any[]),
    ]) : [[], []]

    const scheduledSet = new Set<string>(scheduledRows.map((s: any) => s.vehicleId as string))

    // Vehicle bo'yicha trip holatini guruhlaymiz
    const tripMap = new Map<string, { visited: number; total: number; avgPct: number }>()
    for (const t of trips) {
      const entry = tripMap.get(t.vehicleId) ?? { visited: 0, total: 0, avgPct: 0 }
      entry.total++
      if (t.status === 'visited') { entry.visited++; entry.avgPct += t.coveragePct ?? 0 }
      tripMap.set(t.vehicleId, entry)
    }

    const enriched = positions.map((p: any) => {
      const scheduled = scheduledSet.has(p.vehicleId)
      const tripInfo = tripMap.get(p.vehicleId)
      const hasVisits = (tripInfo?.visited ?? 0) > 0
      const coveragePct = hasVisits ? Math.round(tripInfo!.avgPct / tripInfo!.visited) : null

      // Rang logikasi: yashil → faol + GPS; sariq → jadvalda, lekin hali boshlamagan; qizil → GPS yo'q / jadvalda yo'q
      const liveStatus: 'active' | 'scheduled' | 'idle' =
        hasVisits ? 'active' :
        scheduled ? 'scheduled' : 'idle'

      return { ...p, scheduled, liveStatus, coveragePct, visitedToday: tripInfo?.visited ?? 0, totalToday: tripInfo?.total ?? 0 }
    })

    res.json({ success: true, data: enriched })
  } catch (err) { next(err) }
}

// SmartGPS circle zonalardan konteynerlarni sinxronlash
export async function syncContainersGps(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const result = await syncContainersFromGps(orgId)
    res.json({
      success: true,
      data: result,
      message: `${result.created} ta yangi konteyner, ${result.updated} ta yangilandi (${result.total} circle)`,
    })
  } catch (err) { next(err) }
}
