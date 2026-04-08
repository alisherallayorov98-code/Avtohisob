import { prisma } from '../lib/prisma'

export async function computeFuelMetrics(vehicleId: string, periodDays = 30): Promise<void> {
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
  const periodEnd = new Date()

  const records = await prisma.fuelRecord.findMany({
    where: { vehicleId, refuelDate: { gte: periodStart } },
    orderBy: { odometerReading: 'asc' },
  })

  if (records.length < 2) return

  const totalLiters = records.reduce((s, r) => s + Number(r.amountLiters), 0)
  const totalCost = records.reduce((s, r) => s + Number(r.cost), 0)
  const firstOdometer = Number(records[0].odometerReading)
  const lastOdometer = Number(records[records.length - 1].odometerReading)
  const totalKm = Math.max(0, lastOdometer - firstOdometer)

  if (totalKm < 10) return

  const avgLitersPer100km = (totalLiters / totalKm) * 100

  // Check for anomaly: compare with previous period
  const prevPeriodStart = new Date(periodStart.getTime() - periodDays * 24 * 60 * 60 * 1000)
  const prevMetric = await prisma.fuelConsumptionMetric.findFirst({
    where: { vehicleId, periodStart: { gte: prevPeriodStart, lt: periodStart } },
    orderBy: { periodStart: 'desc' },
  })

  let anomalyFlag = false
  if (prevMetric && Number(prevMetric.avgLitersPer100km) > 0) {
    const diff = Math.abs(avgLitersPer100km - Number(prevMetric.avgLitersPer100km)) / Number(prevMetric.avgLitersPer100km)
    anomalyFlag = diff > 0.20
  }

  await prisma.fuelConsumptionMetric.create({
    data: {
      vehicleId,
      periodStart,
      periodEnd,
      avgLitersPer100km,
      totalLiters,
      totalKm,
      totalCost,
      refuelCount: records.length,
      anomalyFlag,
    },
  })
}

export async function getFleetFuelTrends(branchId?: string) {
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)

  const records = await prisma.fuelRecord.findMany({
    where: {
      refuelDate: { gte: sixMonthsAgo },
      ...(branchId ? { vehicle: { branchId } } : {}),
    },
    include: { vehicle: { select: { registrationNumber: true } } },
    orderBy: { refuelDate: 'asc' },
  })

  // Group by month
  const byMonth = new Map<string, { liters: number; cost: number; count: number }>()
  for (const r of records) {
    const key = `${r.refuelDate.getFullYear()}-${String(r.refuelDate.getMonth() + 1).padStart(2, '0')}`
    if (!byMonth.has(key)) byMonth.set(key, { liters: 0, cost: 0, count: 0 })
    const m = byMonth.get(key)!
    m.liters += Number(r.amountLiters)
    m.cost += Number(r.cost)
    m.count++
  }

  return Array.from(byMonth.entries()).map(([month, data]) => ({ month, ...data }))
}

export async function getTopFuelConsumers(branchId?: string, limit = 5) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const result = await prisma.fuelRecord.groupBy({
    by: ['vehicleId'],
    where: {
      refuelDate: { gte: thirtyDaysAgo },
      ...(branchId ? { vehicle: { branchId } } : {}),
    },
    _sum: { cost: true, amountLiters: true },
    orderBy: { _sum: { cost: 'desc' } },
    take: limit,
  })

  const vehicleIds = result.map(r => r.vehicleId)
  const vehicles = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds } },
    select: { id: true, registrationNumber: true, brand: true, model: true },
  })

  return result.map(r => ({
    ...r,
    vehicle: vehicles.find(v => v.id === r.vehicleId),
  }))
}
