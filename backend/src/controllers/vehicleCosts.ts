import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

/**
 * GET /api/analytics/vehicle-costs?year=2026
 * Har bir mashina uchun yillik xarajat tahlili
 */
export async function getVehicleCosts(req: AuthRequest, res: Response) {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()
  const { branchId } = req.query as Record<string, string>

  const filter = await getOrgFilter(req.user!)
  const bv = applyBranchFilter(filter)

  const fromDate = new Date(`${year}-01-01T00:00:00Z`)
  const toDate = new Date(`${year}-12-31T23:59:59Z`)

  const where: any = { status: 'active' }
  if (bv !== undefined) where.branchId = bv
  else if (branchId) where.branchId = branchId

  const vehicles = await prisma.vehicle.findMany({
    where,
    select: {
      id: true,
      registrationNumber: true,
      brand: true,
      model: true,
      year: true,
      fuelType: true,
      mileage: true,
      branchId: true,
    },
  })

  const vehicleIds = vehicles.map(v => v.id)
  if (vehicleIds.length === 0) return res.json({ vehicles: [], year, fleetAvg: null })

  // Parallel queries
  const [maintenances, fuelRecords, expenses, tireEvents] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where: { vehicleId: { in: vehicleIds }, installationDate: { gte: fromDate, lte: toDate } },
      select: { vehicleId: true, cost: true, laborCost: true },
    }),
    prisma.fuelRecord.findMany({
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: fromDate, lte: toDate } },
      select: { vehicleId: true, cost: true, amountLiters: true },
    }),
    prisma.expense.findMany({
      where: { vehicleId: { in: vehicleIds }, expenseDate: { gte: fromDate, lte: toDate } },
      select: { vehicleId: true, amount: true },
    }),
    (prisma as any).tireEvent.findMany({
      where: { vehicleId: { in: vehicleIds }, eventDate: { gte: fromDate, lte: toDate }, eventType: 'purchase' },
      select: { vehicleId: true, cost: true },
    }).catch(() => []),
  ])

  // Xarajatlarni mashina bo'yicha yig'ish
  const costMap: Record<string, { maintenance: number; fuel: number; expense: number; tire: number; fuelLiters: number }> = {}
  for (const id of vehicleIds) costMap[id] = { maintenance: 0, fuel: 0, expense: 0, tire: 0, fuelLiters: 0 }

  for (const m of maintenances) costMap[m.vehicleId].maintenance += Number(m.cost) + Number(m.laborCost)
  for (const f of fuelRecords) { costMap[f.vehicleId].fuel += Number(f.cost); costMap[f.vehicleId].fuelLiters += Number(f.amountLiters) }
  for (const e of expenses) costMap[e.vehicleId].expense += Number(e.amount)
  for (const t of tireEvents) if (costMap[t.vehicleId]) costMap[t.vehicleId].tire += Number(t.cost ?? 0)

  const result = vehicles.map(v => {
    const c = costMap[v.id]
    const total = c.maintenance + c.fuel + c.expense + c.tire
    const currentKm = Number(v.mileage)
    const costPerKm = currentKm > 0 ? Math.round((total / currentKm) * 100) / 100 : null
    const vehicleAge = year - v.year
    // Almashtirilsin tavsiyasi: yoshi > 12 yil VA yillik xarajat 50 mln dan oshsa
    const replaceRecommended = vehicleAge > 12 && total > 50_000_000

    return {
      id: v.id,
      registrationNumber: v.registrationNumber,
      brand: v.brand,
      model: v.model,
      year: v.year,
      age: vehicleAge,
      fuelType: v.fuelType,
      currentKm,
      costs: {
        maintenance: Math.round(c.maintenance),
        fuel: Math.round(c.fuel),
        expense: Math.round(c.expense),
        tire: Math.round(c.tire),
        total: Math.round(total),
      },
      fuelLiters: Math.round(c.fuelLiters),
      costPerKm,
      replaceRecommended,
    }
  })

  result.sort((a, b) => b.costs.total - a.costs.total)

  const totalCost = result.reduce((s, v) => s + v.costs.total, 0)
  const fleetAvg = result.length > 0 ? Math.round(totalCost / result.length) : 0

  res.json({ vehicles: result, year, fleetAvg, totalCost })
}

/**
 * GET /api/analytics/vehicle-costs/:id
 * Bitta mashina uchun oylik xarajat tarixchasi
 */
export async function getVehicleCostDetail(req: AuthRequest, res: Response) {
  const { id: vehicleId } = req.params
  const year = parseInt(req.query.year as string) || new Date().getFullYear()

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' })

  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, vehicle.branchId)) return res.status(403).json({ error: "Ruxsat yo'q" })

  const monthly: Record<number, { maintenance: number; fuel: number; expense: number; tire: number }> = {}
  for (let m = 1; m <= 12; m++) monthly[m] = { maintenance: 0, fuel: 0, expense: 0, tire: 0 }

  const fromDate = new Date(`${year}-01-01T00:00:00Z`)
  const toDate = new Date(`${year}-12-31T23:59:59Z`)

  const [maintenances, fuelRecords, expenses, tireEventsMonthly] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where: { vehicleId, installationDate: { gte: fromDate, lte: toDate } },
      select: { installationDate: true, cost: true, laborCost: true },
    }),
    prisma.fuelRecord.findMany({
      where: { vehicleId, refuelDate: { gte: fromDate, lte: toDate } },
      select: { refuelDate: true, cost: true },
    }),
    prisma.expense.findMany({
      where: { vehicleId, expenseDate: { gte: fromDate, lte: toDate } },
      select: { expenseDate: true, amount: true },
    }),
    (prisma as any).tireEvent.findMany({
      where: { vehicleId, eventDate: { gte: fromDate, lte: toDate }, eventType: 'purchase' },
      select: { eventDate: true, cost: true },
    }).catch(() => []),
  ])

  for (const m of maintenances) {
    const mo = new Date(m.installationDate).getMonth() + 1
    monthly[mo].maintenance += Number(m.cost) + Number(m.laborCost)
  }
  for (const f of fuelRecords) {
    const mo = new Date(f.refuelDate).getMonth() + 1
    monthly[mo].fuel += Number(f.cost)
  }
  for (const e of expenses) {
    const mo = new Date(e.expenseDate).getMonth() + 1
    monthly[mo].expense += Number(e.amount)
  }
  for (const t of tireEventsMonthly) {
    const mo = new Date(t.eventDate).getMonth() + 1
    monthly[mo].tire += Number(t.cost ?? 0)
  }

  const months = Object.entries(monthly).map(([month, c]) => ({
    month: Number(month),
    maintenance: Math.round(c.maintenance),
    fuel: Math.round(c.fuel),
    expense: Math.round(c.expense),
    total: Math.round(c.maintenance + c.fuel + c.expense + c.tire),
  }))

  res.json({ vehicleId, year, months })
}
