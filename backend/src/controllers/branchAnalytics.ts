import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

export async function getBranchCostComparison(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const dateFilter: any = {}
    if (from) dateFilter.gte = new Date(from)
    if (to) dateFilter.lte = new Date(to)

    // Barcha filiallarni olish
    const branchWhere: any = {}
    if (filterVal !== undefined) {
      if (typeof filterVal === 'string') branchWhere.id = filterVal
      else branchWhere.id = filterVal
    }
    const branches = await prisma.branch.findMany({
      where: filterVal !== undefined ? (typeof filterVal === 'string' ? { id: filterVal } : { id: filterVal }) : {},
      select: { id: true, name: true, location: true, _count: { select: { vehicles: true } } },
      orderBy: { name: 'asc' },
    })

    const results = await Promise.all(branches.map(async (branch) => {
      const maintenanceWhere: any = { vehicle: { branchId: branch.id } }
      const fuelWhere: any = { vehicle: { branchId: branch.id } }
      if (Object.keys(dateFilter).length > 0) {
        maintenanceWhere.installationDate = dateFilter
        fuelWhere.refuelDate = dateFilter
      }

      const [maintAgg, fuelAgg, maintCount, fuelCount, engineCount, inspCount] = await Promise.all([
        prisma.maintenanceRecord.aggregate({
          where: maintenanceWhere,
          _sum: { cost: true, laborCost: true },
          _count: { id: true },
        }),
        prisma.fuelRecord.aggregate({
          where: fuelWhere,
          _sum: { cost: true, amountLiters: true },
          _count: { id: true },
        }),
        prisma.maintenanceRecord.count({ where: maintenanceWhere }),
        prisma.fuelRecord.count({ where: fuelWhere }),
        (prisma as any).engineRecord.count({
          where: {
            vehicle: { branchId: branch.id },
            recordType: { in: ['overhaul', 'major_repair'] },
            ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
          },
        }),
        (prisma as any).techInspection.count({
          where: {
            branchId: branch.id,
            ...(Object.keys(dateFilter).length > 0 && { inspectionDate: dateFilter }),
          },
        }),
      ])

      const maintCost = Number(maintAgg._sum.cost || 0) + Number(maintAgg._sum.laborCost || 0)
      const fuelCost = Number(fuelAgg._sum.cost || 0)
      const totalCost = maintCost + fuelCost
      const vehicleCount = branch._count.vehicles || 1
      const costPerVehicle = vehicleCount > 0 ? totalCost / vehicleCount : 0

      return {
        branchId: branch.id,
        branchName: branch.name,
        location: branch.location,
        vehicleCount: branch._count.vehicles,
        maintCost,
        fuelCost,
        totalCost,
        costPerVehicle,
        maintCount,
        fuelCount,
        engineOverhaulCount: engineCount,
        inspectionCount: inspCount,
        fuelLiters: Number(fuelAgg._sum.amountLiters || 0),
      }
    }))

    // Flot o'rtachalarini hisoblash
    const avgCostPerVehicle = results.reduce((s, r) => s + r.costPerVehicle, 0) / (results.length || 1)

    const withDeviation = results.map(r => ({
      ...r,
      deviationPct: avgCostPerVehicle > 0
        ? Math.round((r.costPerVehicle / avgCostPerVehicle - 1) * 100)
        : 0,
    }))

    res.json(successResponse({
      branches: withDeviation,
      avgCostPerVehicle: Math.round(avgCostPerVehicle),
      totalFleetCost: results.reduce((s, r) => s + r.totalCost, 0),
    }))
  } catch (err) { next(err) }
}
