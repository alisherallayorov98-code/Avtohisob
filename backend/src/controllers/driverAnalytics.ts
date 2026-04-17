import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

/**
 * GET /api/analytics/drivers
 * Haydovchilar bo'yicha: km, yoqilg'i sarfi, sayohatlar soni, xavf skori
 */
export async function getDriverStats(req: AuthRequest, res: Response) {
  const { from, to, branchId } = req.query as Record<string, string>
  const filter = await getOrgFilter(req.user!)
  const bv = applyBranchFilter(filter)

  const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000)
  const toDate = to ? new Date(to) : new Date()
  toDate.setHours(23, 59, 59, 999)

  const where: any = {
    status: { in: ['completed', 'active'] },
    plannedDeparture: { gte: fromDate, lte: toDate },
  }
  if (bv !== undefined) where.branchId = bv
  else if (branchId) where.branchId = branchId

  const waybills = await prisma.waybill.findMany({
    where,
    select: {
      id: true,
      driverId: true,
      vehicleId: true,
      distanceTraveled: true,
      fuelConsumed: true,
      fuelIssued: true,
      plannedDeparture: true,
      actualDeparture: true,
      actualReturn: true,
      driver: { select: { id: true, fullName: true, role: true } },
    },
  })

  // Haydovchi bo'yicha guruhlashtirish
  const driverMap = new Map<string, {
    driverId: string
    driverName: string
    trips: number
    totalKm: number
    totalFuelIssued: number
    totalFuelConsumed: number
    vehicleIds: Set<string>
    tripDurations: number[]  // soatlarda
  }>()

  for (const wb of waybills) {
    const key = wb.driverId
    if (!driverMap.has(key)) {
      driverMap.set(key, {
        driverId: wb.driverId,
        driverName: wb.driver?.fullName ?? 'Noma\'lum',
        trips: 0,
        totalKm: 0,
        totalFuelIssued: 0,
        totalFuelConsumed: 0,
        vehicleIds: new Set(),
        tripDurations: [],
      })
    }
    const d = driverMap.get(key)!
    d.trips++
    d.totalKm += wb.distanceTraveled ?? 0
    d.totalFuelIssued += Number(wb.fuelIssued ?? 0)
    d.totalFuelConsumed += Number(wb.fuelConsumed ?? 0)
    if (wb.vehicleId) d.vehicleIds.add(wb.vehicleId)
    if (wb.actualDeparture && wb.actualReturn) {
      const hours = (new Date(wb.actualReturn).getTime() - new Date(wb.actualDeparture).getTime()) / 3600000
      if (hours > 0 && hours < 72) d.tripDurations.push(hours)
    }
  }

  // Har bir haydovchi uchun ta'mirlash bog'liqligi (yo'lxatlar vaqtida mashinada ta'mirlash bor edi)
  const vehicleIdSet = new Set(waybills.map(w => w.vehicleId))
  const maintenances = vehicleIdSet.size > 0 ? await prisma.maintenanceRecord.findMany({
    where: {
      vehicleId: { in: [...vehicleIdSet] },
      installationDate: { gte: fromDate, lte: toDate },
    },
    select: { vehicleId: true, cost: true, laborCost: true },
  }) : []

  // Haydovchi → qaysi mashinalarda ishladim → o'sha mashina ta'mirlash xarajatlarini bog'lash
  const driverVehicleMap = new Map<string, Set<string>>()
  for (const wb of waybills) {
    if (!driverVehicleMap.has(wb.driverId)) driverVehicleMap.set(wb.driverId, new Set())
    driverVehicleMap.get(wb.driverId)!.add(wb.vehicleId)
  }

  const result = [...driverMap.values()].map(d => {
    const avgKmPerTrip = d.trips > 0 ? Math.round(d.totalKm / d.trips) : 0
    const avgFuelPer100Km = d.totalKm > 0 ? Math.round((d.totalFuelConsumed / d.totalKm) * 100 * 10) / 10 : null
    const avgTripHours = d.tripDurations.length > 0
      ? Math.round(d.tripDurations.reduce((s, v) => s + v, 0) / d.tripDurations.length * 10) / 10
      : null

    // Haydovchi mashinalaridagi ta'mirlash xarajati
    const myVehicles = driverVehicleMap.get(d.driverId) ?? new Set()
    const maintenanceCost = maintenances
      .filter(m => myVehicles.has(m.vehicleId))
      .reduce((s, m) => s + Number(m.cost) + Number(m.laborCost), 0)

    // Xavf skori: yuqori yoqilg'i sarfi + ko'p ta'mirlash + ko'p mashina
    let riskScore = 0
    if (avgFuelPer100Km !== null && avgFuelPer100Km > 15) riskScore += 30
    else if (avgFuelPer100Km !== null && avgFuelPer100Km > 12) riskScore += 15
    if (maintenanceCost > 5000000) riskScore += 25
    else if (maintenanceCost > 1000000) riskScore += 10
    if (d.vehicleIds.size > 5) riskScore += 15
    const riskLevel = riskScore >= 40 ? 'high' : riskScore >= 20 ? 'medium' : 'low'

    return {
      driverId: d.driverId,
      driverName: d.driverName,
      trips: d.trips,
      totalKm: d.totalKm,
      avgKmPerTrip,
      totalFuelIssued: Math.round(d.totalFuelIssued),
      totalFuelConsumed: Math.round(d.totalFuelConsumed),
      avgFuelPer100Km,
      avgTripHours,
      vehicleCount: d.vehicleIds.size,
      maintenanceCost: Math.round(maintenanceCost),
      riskScore,
      riskLevel,
    }
  })

  result.sort((a, b) => b.riskScore - a.riskScore)

  res.json({
    drivers: result,
    period: { from: fromDate, to: toDate },
    totalTrips: waybills.length,
    totalKm: result.reduce((s, d) => s + d.totalKm, 0),
  })
}
