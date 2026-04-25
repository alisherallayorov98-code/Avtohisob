import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { runDailyMonitoring } from '../services/thMonitor'

export async function getServiceTrips(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, branchId, status } = req.query as any

    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const where: any = { date: dateOnly }
    if (status) where.status = status
    if (branchId) where.vehicle = { branchId }

    const trips = await (prisma as any).thServiceTrip.findMany({
      where,
      include: {
        mfy: {
          select: {
            id: true,
            name: true,
            district: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { vehicleId: 'asc' },
    })

    // Vehicle ma'lumotlarini alohida olish (Prisma relation yo'q)
    const vehicleIds: string[] = [...new Set<string>(trips.map((t: any) => t.vehicleId as string))]
    const vehicles = vehicleIds.length
      ? await prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true },
        })
      : []
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    const data = trips.map((t: any) => ({
      ...t,
      vehicle: vehicleMap.get(t.vehicleId) || null,
    }))

    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export async function getLandfillTrips(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, vehicleId, branchId } = req.query as any

    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const where: any = { date: dateOnly }
    if (vehicleId) where.vehicleId = vehicleId

    const trips = await (prisma as any).thLandfillTrip.findMany({
      where,
      include: {
        landfill: { select: { id: true, name: true, location: true } },
      },
      orderBy: [{ vehicleId: 'asc' }, { arrivedAt: 'asc' }],
    })

    const vehicleIds: string[] = [...new Set<string>(trips.map((t: any) => t.vehicleId as string))]
    const vehicles = vehicleIds.length
      ? await prisma.vehicle.findMany({
          where: {
            id: { in: vehicleIds },
            ...(branchId ? { branchId } : {}),
          },
          select: { id: true, registrationNumber: true, brand: true, model: true },
        })
      : []
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    const data = trips
      .filter((t: any) => !branchId || vehicleMap.has(t.vehicleId))
      .map((t: any) => ({ ...t, vehicle: vehicleMap.get(t.vehicleId) || null }))

    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export async function triggerMonitoring(req: Request, res: Response, next: NextFunction) {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0]
    const date = new Date(dateStr + 'T12:00:00.000Z')

    const result = await runDailyMonitoring(date)
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

// Kunlik umumiy statistika
export async function getServiceStats(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, branchId } = req.query as any

    const targetDate = date ? new Date(date) : new Date()
    const dateOnly = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const where: any = { date: dateOnly }
    if (branchId) where.vehicle = { branchId }

    const [visited, notVisited, noGps, noPolygon, suspicious] = await Promise.all([
      (prisma as any).thServiceTrip.count({ where: { ...where, status: 'visited' } }),
      (prisma as any).thServiceTrip.count({ where: { ...where, status: 'not_visited' } }),
      (prisma as any).thServiceTrip.count({ where: { ...where, status: 'no_gps' } }),
      (prisma as any).thServiceTrip.count({ where: { ...where, status: 'no_polygon' } }),
      (prisma as any).thServiceTrip.count({ where: { ...where, suspicious: true } }),
    ])

    const total = visited + notVisited + noGps + noPolygon
    const landfillCount = await (prisma as any).thLandfillTrip.count({ where: { date: dateOnly } })

    res.json({
      success: true,
      data: { total, visited, notVisited, noGps, noPolygon, suspicious, landfillTrips: landfillCount },
    })
  } catch (err) { next(err) }
}
