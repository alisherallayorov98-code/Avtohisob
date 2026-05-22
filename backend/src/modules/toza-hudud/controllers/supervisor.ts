/**
 * Supervisor portal — super_admin uchun barcha tashkilotlar statistikasi
 * Har bir org uchun: bugungi qamrov, faol mashinalar, kechikkan konteynerlar
 */

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'
import { getLivePositions } from '../services/thLiveCache'

// ── Polygon centroid hisoblash ─────────────────────────────────────────────────
function polygonCentroid(polygon: any): [number, number] | null {
  try {
    const coords: number[][] = polygon?.geometry?.coordinates?.[0] ?? polygon?.coordinates?.[0] ?? []
    if (!Array.isArray(coords) || coords.length === 0) return null
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
    const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length
    return [lat, lon]
  } catch { return null }
}

/**
 * Supervisor: bitta tashkilot uchun kunlik hisobot (mashina bo'yicha breakdown)
 */
export async function getSupervisorDaily(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'super_admin') throw new AppError('Faqat super_admin uchun', 403)

    const { orgId, date } = req.query as any
    if (!orgId) throw new AppError('orgId talab qilinadi', 400)

    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true, name: true },
    })
    const branchIds = branches.map((b: any) => b.id)
    const orgName = branches[0]?.name || orgId.slice(0, 8)

    if (branchIds.length === 0) return res.json({ success: true, data: [], orgName, date: dateOnly })

    const vehicles = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    const vIds = vehicles.map(v => v.id)

    if (vIds.length === 0) return res.json({ success: true, data: [], orgName, date: dateOnly })

    const trips = await (prisma as any).thServiceTrip.findMany({
      where: { date: dateOnly, vehicleId: { in: vIds } },
      select: {
        vehicleId: true, status: true, suspicious: true,
        mfy: { select: { name: true, district: { select: { name: true } } } },
      },
    })

    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
    const grouped: Record<string, any> = {}

    for (const t of trips) {
      if (!grouped[t.vehicleId]) {
        grouped[t.vehicleId] = {
          vehicle: vehicleMap.get(t.vehicleId),
          visited: 0, notVisited: 0, noGps: 0, suspicious: 0, trips: [],
        }
      }
      const g = grouped[t.vehicleId]
      if (t.status === 'visited') g.visited++
      else if (t.status === 'not_visited') g.notVisited++
      else if (t.status === 'no_gps') g.noGps++
      if (t.suspicious) g.suspicious++
      g.trips.push({ status: t.status, mfyName: t.mfy?.name, districtName: t.mfy?.district?.name })
    }

    // Tripı bo'lmagan vehicleler ham ko'rsatilsin
    for (const v of vehicles) {
      if (!grouped[v.id]) {
        grouped[v.id] = { vehicle: v, visited: 0, notVisited: 0, noGps: 0, suspicious: 0, trips: [] }
      }
    }

    const data = Object.values(grouped).map((g: any) => ({
      ...g,
      total: g.visited + g.notVisited + g.noGps,
      coveragePct: g.visited + g.notVisited > 0
        ? Math.round(g.visited / (g.visited + g.notVisited) * 100)
        : null,
    })).sort((a: any, b: any) =>
      (b.coveragePct ?? -1) - (a.coveragePct ?? -1)
    )

    res.json({ success: true, data, orgName, date: dateOnly })
  } catch (err) { next(err) }
}

export async function getSupervisorOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'super_admin') throw new AppError('Faqat super_admin uchun', 403)

    const today = new Date()
    const todayDate = new Date(today.toISOString().split('T')[0] + 'T00:00:00.000Z')

    // Toza-Hudud obunali tashkilotlar
    const subs = await (prisma as any).subscription.findMany({
      where: { status: 'active', features: { has: 'tozahudud_module' } },
      select: { organizationId: true },
    }).catch(() => [] as { organizationId: string }[])

    if (subs.length === 0) {
      // Single-tenant mode
      const [visited, notVisited, noGps] = await Promise.all([
        (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'visited' } }),
        (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'not_visited' } }),
        (prisma as any).thServiceTrip.count({ where: { date: todayDate, status: 'no_gps' } }),
      ])
      const total = visited + notVisited + noGps
      return res.json({
        success: true,
        data: [{
          orgId: null,
          orgName: 'Umumiy',
          today: { visited, notVisited, noGps, total, coveragePct: total > 0 ? Math.round(visited / total * 100) : null },
        }],
      })
    }

    const orgIds = subs.map((s: any) => s.organizationId)

    // Har org uchun branch → vehicle mapni quramiz
    const results = await Promise.all(orgIds.map(async (orgId: string) => {
      try {
        // Bitta so'rovda org nomi va branch IDlarni olamiz
        const branches = await (prisma as any).branch.findMany({
          where: { OR: [{ id: orgId }, { organizationId: orgId }] },
          select: { id: true, name: true },
        }).catch(() => [] as { id: string; name: string }[])
        const branchIds = branches.map((b: any) => b.id)
        const orgName = branches[0]?.name || orgId.slice(0, 8)

        if (branchIds.length === 0) return null

        const vIds = await prisma.vehicle.findMany({
          where: { branchId: { in: branchIds }, status: 'active' },
          select: { id: true },
        }).then(vs => vs.map(v => v.id)).catch(() => [] as string[])

        if (vIds.length === 0) return null

        const scope = { date: todayDate, vehicleId: { in: vIds } }

        const [visited, notVisited, noGps, suspicious, overdueCount] = await Promise.all([
          (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'visited' } }).catch(() => 0),
          (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'not_visited' } }).catch(() => 0),
          (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'no_gps' } }).catch(() => 0),
          (prisma as any).thServiceTrip.count({ where: { ...scope, suspicious: true } }).catch(() => 0),
          // Kechikkan konteynerlar (taxminiy — oxirgi 30 kunda tashrif bo'lmaganlar)
          (prisma as any).thContainer.count({
            where: {
              organizationId: orgId,
              visits: {
                none: {
                  date: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) },
                },
              },
            },
          }).catch(() => 0),
        ])

        const total = visited + notVisited + noGps

        return {
          orgId,
          orgName,
          today: {
            visited,
            notVisited,
            noGps,
            suspicious,
            total,
            coveragePct: total > 0 ? Math.round(visited / total * 100) : null,
          },
          vehicles: vIds.length,
          overdueContainers: overdueCount,
        }
      } catch {
        return null
      }
    }))

    res.json({ success: true, data: results.filter(Boolean) })
  } catch (err) { next(err) }
}

/**
 * Supervisor Live Xarita — org uchun barcha mashinalar jonli holati + bugungi MFY statusi
 * GET /th/supervisor/map
 */
export async function getSupervisorMap(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const today = new Date()
    const todayDate = new Date(today.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const nowHour = today.getUTCHours() + 5 // UTC+5 Toshkent

    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    }).catch(() => [] as { id: string }[])
    const branchIds = [orgId, ...branches.map((b: any) => b.id)]

    const vehicles = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    const vIds = vehicles.map(v => v.id)

    const positions = await getLivePositions(orgId)
    const posMap = new Map(positions.map(p => [p.vehicleId, p]))

    const jsDow = today.getDay()
    const uzDow = jsDow === 0 ? 7 : jsDow

    const schedules = await (prisma as any).thSchedule.findMany({
      where: { vehicleId: { in: vIds }, dayOfWeek: { has: uzDow } },
      select: {
        vehicleId: true, mfyId: true,
        mfy: { select: { id: true, name: true, polygon: true } },
      },
    })

    const trips: Array<{ vehicleId: string; mfyId: string; status: string }> = await (prisma as any).thServiceTrip.findMany({
      where: { vehicleId: { in: vIds }, date: todayDate },
      select: { vehicleId: true, mfyId: true, status: true },
    })
    const tripMap = new Map(trips.map(t => [`${t.vehicleId}::${t.mfyId}`, t]))

    const vehicleMfys: Record<string, any[]> = {}
    const mfyPool = new Map<string, any>()

    for (const s of schedules) {
      const trip = tripMap.get(`${s.vehicleId}::${s.mfyId}`)
      const status = trip?.status === 'visited' ? 'done'
        : (!trip && nowHour >= 14) ? 'overdue'
        : 'pending'

      if (!vehicleMfys[s.vehicleId]) vehicleMfys[s.vehicleId] = []
      vehicleMfys[s.vehicleId].push({ mfyId: s.mfyId, mfyName: s.mfy.name, status })

      if (!mfyPool.has(s.mfyId)) {
        const center = polygonCentroid(s.mfy.polygon)
        mfyPool.set(s.mfyId, {
          mfyId: s.mfyId, mfyName: s.mfy.name,
          lat: center?.[0] ?? null, lon: center?.[1] ?? null,
          polygon: s.mfy.polygon, status: 'pending',
        })
      }
      const mfy = mfyPool.get(s.mfyId)!
      if (status === 'done') mfy.status = 'done'
      else if (status === 'overdue' && mfy.status !== 'done') mfy.status = 'overdue'
    }

    const vehicleData = vehicles.map(v => {
      const pos = posMap.get(v.id)
      const mfys = vehicleMfys[v.id] || []
      return {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        brand: (v as any).brand || '',
        model: (v as any).model || '',
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        speedKmh: pos?.speed ?? 0,
        lastSeenAt: pos?.capturedAt ?? null,
        todayMfys: mfys,
        hasOverdue: mfys.some(m => m.status === 'overdue'),
        isActive: pos != null && (pos.speed ?? 0) > 0,
      }
    })

    const mfyList = [...mfyPool.values()]
    res.json({
      success: true,
      data: {
        vehicles: vehicleData, mfys: mfyList,
        stats: {
          totalVehicles: vehicles.length,
          activeVehicles: vehicleData.filter(v => v.isActive).length,
          overdueMfyCount: mfyList.filter(m => m.status === 'overdue').length,
          doneMfyCount: mfyList.filter(m => m.status === 'done').length,
          totalMfys: mfyList.length,
        },
      },
    })
  } catch (err) { next(err) }
}

/**
 * Supervisor: barcha tashkilotlar bo'yicha AI fingerprint holati
 */
export async function getSupervisorAiOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'super_admin') throw new AppError('Faqat super_admin uchun', 403)

    const subs = await (prisma as any).subscription.findMany({
      where: { status: 'active', features: { has: 'tozahudud_module' } },
      select: { organizationId: true },
    }).catch(() => [] as { organizationId: string }[])

    const orgIds = subs.length > 0
      ? subs.map((s: any) => s.organizationId)
      : [] as string[]

    const results = await Promise.all(orgIds.map(async (orgId: string) => {
      try {
        const branches = await (prisma as any).branch.findMany({
          where: { OR: [{ id: orgId }, { organizationId: orgId }] },
          select: { id: true, name: true },
        }).catch(() => [] as { id: string; name: string }[])
        const branchIds = branches.map((b: any) => b.id)
        const orgName = branches[0]?.name || orgId.slice(0, 8)

        const vIds = await prisma.vehicle.findMany({
          where: { branchId: { in: branchIds }, status: 'active' },
          select: { id: true },
        }).then(vs => vs.map(v => v.id)).catch(() => [] as string[])

        if (vIds.length === 0) return null

        // thCoverageFingerprint BITTA so'rovda olamiz — oldin 2 marta so'ranar edi
        const [scheduleCount, trainedPairs, allSchedules, latestFp] = await Promise.all([
          (prisma as any).thSchedule.count({ where: { vehicleId: { in: vIds } } }).catch(() => 0),
          (prisma as any).thCoverageFingerprint.findMany({
            where: { vehicleId: { in: vIds } },
            select: { vehicleId: true, mfyId: true, updatedAt: true },
            distinct: ['vehicleId', 'mfyId'],
            orderBy: { updatedAt: 'desc' },
          }).catch(() => [] as any[]),
          (prisma as any).thSchedule.findMany({
            where: { vehicleId: { in: vIds } },
            select: { vehicleId: true, mfyId: true },
          }).catch(() => [] as any[]),
          (prisma as any).thCoverageFingerprint.findFirst({
            where: { vehicleId: { in: vIds } },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
          }).catch(() => null),
        ])

        // O'rganilmagan juftliklar — trainedPairs ni qayta ishlatamiz
        const trainedKeys = new Set(trainedPairs.map((t: any) => `${t.vehicleId}::${t.mfyId}`))
        const untrainedPairs = allSchedules.filter((s: any) => !trainedKeys.has(`${s.vehicleId}::${s.mfyId}`)).length
        const trainedPct = scheduleCount > 0 ? Math.round(trainedPairs.length / scheduleCount * 100) : 0

        return {
          orgId,
          orgName,
          trainedPct,
          trained: trainedPairs.length,
          total: scheduleCount,
          untrainedPairs,
          lastTrainedAt: latestFp?.updatedAt ?? null,
        }
      } catch {
        return null
      }
    }))

    res.json({ success: true, data: results.filter(Boolean) })
  } catch (err) { next(err) }
}
