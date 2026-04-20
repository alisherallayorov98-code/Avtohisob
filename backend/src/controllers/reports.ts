import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { getOrgFilter, applyBranchFilter, applyNarrowedBranchFilter, isBranchAllowed, getOrgWarehouseIds } from '../lib/orgFilter'
import { AppError } from '../middleware/errorHandler'

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined
  const d = new Date(s)
  return isNaN(d.getTime()) ? undefined : d
}
function dateFilter(from?: string, to?: string) {
  const gte = parseDate(from)
  const lte = parseDate(to)
  if (!gte && !lte) return undefined
  return { ...(gte && { gte }), ...(lte && { lte }) }
}

export async function getVehiclesReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)

    const expenseFilter: any = {}
    if (from || to) expenseFilter.expenseDate = dateFilter(from, to)
    if (bv !== undefined) expenseFilter.vehicle = { branchId: bv }

    const vehicles = await prisma.vehicle.findMany({
      where: bv !== undefined ? { branchId: bv } : {},
      include: {
        branch: { select: { name: true } },
        expenses: { where: { ...expenseFilter, category: { name: { not: 'Texnik xizmat' } } }, select: { amount: true } },
        fuelRecords: { where: from || to ? { refuelDate: dateFilter(from, to) } : {}, select: { cost: true, amountLiters: true } },
        maintenanceRecords: { where: from || to ? { installationDate: dateFilter(from, to) } : {}, select: { cost: true, laborCost: true } },
      },
    })

    const report = vehicles.map(v => ({
      id: v.id,
      registrationNumber: v.registrationNumber,
      brand: v.brand,
      model: v.model,
      branch: v.branch.name,
      status: v.status,
      mileage: Number(v.mileage),
      totalExpenses: v.expenses.reduce((s, e) => s + Number(e.amount), 0),
      totalFuelCost: v.fuelRecords.reduce((s, f) => s + Number(f.cost), 0),
      totalFuelLiters: v.fuelRecords.reduce((s, f) => s + Number(f.amountLiters), 0),
      totalMaintenanceCost: v.maintenanceRecords.reduce((s, m) => s + Number(m.cost) + Number(m.laborCost), 0),
    })).sort((a, b) =>
      (b.totalExpenses + b.totalFuelCost + b.totalMaintenanceCost) -
      (a.totalExpenses + a.totalFuelCost + a.totalMaintenanceCost)
    )

    res.json(successResponse(report))
  } catch (err) { next(err) }
}

export async function getExpensesReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)

    const where: any = {}
    if (from || to) where.expenseDate = dateFilter(from, to)
    if (bv !== undefined) where.vehicle = { branchId: bv }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        category: { select: { name: true } },
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
      },
      orderBy: { expenseDate: 'desc' },
    })

    const byCategory: Record<string, number> = {}
    expenses.forEach(e => {
      byCategory[e.category.name] = (byCategory[e.category.name] || 0) + Number(e.amount)
    })

    res.json(successResponse({
      total: expenses.reduce((s, e) => s + Number(e.amount), 0),
      count: expenses.length,
      byCategory,
      expenses,
    }))
  } catch (err) { next(err) }
}

export async function getFuelReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)

    const where: any = {}
    if (from || to) where.refuelDate = dateFilter(from, to)
    if (bv !== undefined) where.vehicle = { branchId: bv }

    const records = await prisma.fuelRecord.findMany({
      where,
      include: { vehicle: { select: { registrationNumber: true, brand: true, model: true } } },
      orderBy: { refuelDate: 'desc' },
    })

    const byFuelType: Record<string, { cost: number; liters: number }> = {}
    records.forEach(r => {
      if (!byFuelType[r.fuelType]) byFuelType[r.fuelType] = { cost: 0, liters: 0 }
      byFuelType[r.fuelType].cost += Number(r.cost)
      byFuelType[r.fuelType].liters += Number(r.amountLiters)
    })

    res.json(successResponse({
      totalCost: records.reduce((s, r) => s + Number(r.cost), 0),
      totalLiters: records.reduce((s, r) => s + Number(r.amountLiters), 0),
      count: records.length,
      byFuelType,
      records,
    }))
  } catch (err) { next(err) }
}

export async function getMaintenanceReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)

    const where: any = {}
    if (from || to) where.installationDate = dateFilter(from, to)
    if (bv !== undefined) where.vehicle = { branchId: bv }

    const records = await prisma.maintenanceRecord.findMany({
      where,
      include: {
        vehicle: { select: { registrationNumber: true } },
        sparePart: { select: { name: true, category: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    const byCategory: Record<string, number> = {}
    records.forEach(r => {
      const cat = r.sparePart?.category || 'Boshqa'
      byCategory[cat] = (byCategory[cat] || 0) + Number(r.cost) + Number(r.laborCost)
    })

    res.json(successResponse({
      totalCost: records.reduce((s, r) => s + Number(r.cost) + Number(r.laborCost), 0),
      count: records.length,
      byCategory,
      records,
    }))
  } catch (err) { next(err) }
}

export async function getInventoryReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const wareIds = await getOrgWarehouseIds(filter)

    const where: any = {}
    if (wareIds !== null) {
      where.warehouseId = { in: wareIds }
    } else if ((req.query as any).warehouseId) {
      where.warehouseId = (req.query as any).warehouseId
    }

    const inventory = await prisma.inventory.findMany({
      where,
      include: {
        sparePart: { select: { name: true, category: true, unitPrice: true } },
        warehouse: { select: { name: true } },
      },
    })

    const totalValue = (inventory as any[]).reduce((s, i) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0)
    const lowStock = (inventory as any[]).filter(i => i.quantityOnHand <= i.reorderLevel)
    const byCategory: Record<string, { count: number; value: number }> = {}
    ;(inventory as any[]).forEach(i => {
      const cat = i.sparePart.category
      if (!byCategory[cat]) byCategory[cat] = { count: 0, value: 0 }
      byCategory[cat].count += i.quantityOnHand
      byCategory[cat].value += Number(i.quantityOnHand) * Number(i.sparePart.unitPrice)
    })

    res.json(successResponse({ totalValue, totalItems: inventory.length, lowStockCount: lowStock.length, byCategory, inventory }))
  } catch (err) { next(err) }
}

export async function getBranchReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const branchWhere: any = { isActive: true }
    if (bv !== undefined) branchWhere.id = bv

    const branches = await prisma.branch.findMany({
      where: branchWhere,
      include: {
        vehicles: { select: { id: true, status: true } },
        warehouse: { include: { inventory: { include: { sparePart: { select: { unitPrice: true } } } } } },
        _count: { select: { users: true } },
      },
    })

    const expenseFilter: any = {}
    if (from || to) expenseFilter.expenseDate = dateFilter(from, to)

    const report = await Promise.all(branches.map(async (b) => {
      const [expenses, fuel] = await Promise.all([
        prisma.expense.aggregate({ where: { vehicle: { branchId: b.id }, ...expenseFilter }, _sum: { amount: true } }),
        prisma.fuelRecord.aggregate({ where: { vehicle: { branchId: b.id }, ...(from || to ? { refuelDate: dateFilter(from, to) } : {}) }, _sum: { cost: true } }),
      ])
      return {
        id: b.id,
        name: b.name,
        location: b.location,
        activeVehicles: b.vehicles.filter(v => v.status === 'active').length,
        totalVehicles: b.vehicles.length,
        totalUsers: b._count.users,
        inventoryValue: (b as any).warehouse?.inventory?.reduce((s: number, i: any) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0) || 0,
        totalExpenses: Number(expenses._sum.amount) || 0,
        totalFuelCost: Number(fuel._sum.cost) || 0,
      }
    }))

    res.json(successResponse(report))
  } catch (err) { next(err) }
}

export async function getVehicleDetailReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { from, to } = req.query as any

    // Access check
    const filter = await getOrgFilter(req.user!)
    if (filter.type !== 'none') {
      const veh = await prisma.vehicle.findUnique({ where: { id }, select: { branchId: true } })
      if (!veh || !isBranchAllowed(filter, veh.branchId)) {
        return res.status(403).json({ success: false, error: 'Ruxsat yo\'q' })
      }
    }

    const dateRange = from || to ? dateFilter(from, to) : undefined

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: { branch: { select: { name: true, location: true } } },
    })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)

    const maintenance = await prisma.maintenanceRecord.findMany({
      where: { vehicleId: id, ...(dateRange ? { installationDate: dateRange } : {}) },
      include: {
        sparePart: { select: { name: true, category: true, articleCode: { select: { code: true } } } },
        performedBy: { select: { fullName: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    const fuelRecords = await prisma.fuelRecord.findMany({
      where: { vehicleId: id, ...(dateRange ? { refuelDate: dateRange } : {}) },
      include: {
        supplier: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { refuelDate: 'desc' },
    })

    const expenses = await prisma.expense.findMany({
      where: {
        vehicleId: id,
        ...(dateRange ? { expenseDate: dateRange } : {}),
        category: { name: { not: 'Texnik xizmat' } },
      },
      include: {
        category: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
    })

    const byWorker: Record<string, { name: string; count: number; totalCost: number; records: any[] }> = {}
    maintenance.forEach(m => {
      const name = m.performedBy.fullName
      if (!byWorker[name]) byWorker[name] = { name, count: 0, totalCost: 0, records: [] }
      byWorker[name].count++
      byWorker[name].totalCost += Number(m.cost) + Number(m.laborCost)
      byWorker[name].records.push({
        date: m.installationDate,
        sparePart: m.sparePart?.name || '—',
        cost: Number(m.cost) + Number(m.laborCost),
      })
    })

    const byPart: Record<string, { name: string; category: string; articleCode: string; count: number; totalCost: number }> = {}
    maintenance.forEach(m => {
      const key = m.sparePartId || m.id
      if (!byPart[key]) byPart[key] = {
        name: m.sparePart?.name || '—',
        category: m.sparePart?.category || 'Boshqa',
        articleCode: m.sparePart?.articleCode?.code || '—',
        count: 0,
        totalCost: 0,
      }
      byPart[key].count += m.quantityUsed
      byPart[key].totalCost += Number(m.cost)
    })

    const totalMaintenance = maintenance.reduce((s, m) => s + Number(m.cost) + Number(m.laborCost), 0)
    const totalFuel = fuelRecords.reduce((s, f) => s + Number(f.cost), 0)
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

    res.json({
      success: true,
      data: {
        vehicle: {
          id: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
          mileage: Number(vehicle.mileage),
          status: vehicle.status,
          branch: vehicle.branch,
        },
        period: { from: from || null, to: to || null },
        summary: {
          totalMaintenance,
          totalFuel,
          totalExpenses,
          grandTotal: totalMaintenance + totalFuel + totalExpenses,
          maintenanceCount: maintenance.length,
          fuelCount: fuelRecords.length,
        },
        byWorker: Object.values(byWorker).sort((a, b) => b.totalCost - a.totalCost),
        byPart: Object.values(byPart).sort((a, b) => b.totalCost - a.totalCost),
        maintenance,
        fuelRecords,
        expenses,
      },
    })
  } catch (err) { next(err) }
}

export async function getMonthlyTrend(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)
    const vehicleFilter = bv !== undefined ? { branchId: bv } : {}
    const months = parseInt((req.query.months as string) || '12', 10)

    const UZ_MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']
    const now = new Date()
    const buckets = Array.from({ length: months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)
      return { year: d.getFullYear(), month: d.getMonth(), label: `${UZ_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }
    })

    const yearStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)

    const [expenses, fuelRecords, maintenance] = await Promise.all([
      prisma.expense.findMany({
        where: { expenseDate: { gte: yearStart }, vehicle: vehicleFilter, category: { name: { not: 'Texnik xizmat' } } },
        select: { amount: true, expenseDate: true },
      }),
      prisma.fuelRecord.findMany({
        where: { refuelDate: { gte: yearStart }, vehicle: vehicleFilter },
        select: { cost: true, refuelDate: true },
      }),
      prisma.maintenanceRecord.findMany({
        where: { installationDate: { gte: yearStart }, vehicle: vehicleFilter },
        select: { cost: true, laborCost: true, installationDate: true },
      }),
    ])

    const trend = buckets.map(b => {
      const mExp = expenses.filter(e => { const d = new Date(e.expenseDate); return d.getFullYear() === b.year && d.getMonth() === b.month })
      const mFuel = fuelRecords.filter(f => { const d = new Date(f.refuelDate); return d.getFullYear() === b.year && d.getMonth() === b.month })
      const mMaint = maintenance.filter(r => { const d = new Date(r.installationDate); return d.getFullYear() === b.year && d.getMonth() === b.month })
      const expensesTotal = mExp.reduce((s, e) => s + Number(e.amount), 0)
      const fuelTotal = mFuel.reduce((s, f) => s + Number(f.cost), 0)
      const maintenanceTotal = mMaint.reduce((s, r) => s + Number(r.cost) + Number(r.laborCost), 0)
      return { label: b.label, expenses: expensesTotal, fuel: fuelTotal, maintenance: maintenanceTotal, total: expensesTotal + fuelTotal + maintenanceTotal }
    })

    res.json(successResponse(trend))
  } catch (err) { next(err) }
}

export async function getDashboardStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)
    const vehicleFilter = bv !== undefined ? { branchId: bv } : {}
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    // Inventory: restrict to org's warehouses
    const wareIds = await getOrgWarehouseIds(filter)
    const inventoryWhere: any = wareIds !== null ? { warehouseId: { in: wareIds } } : {}

    // Warranty scope: tire warranties (vehicleId: null) scoped via tire.branchId
    let warrantyOrgScope: any = {}
    if (bv !== undefined) {
      const orgTires = await (prisma as any).tire.findMany({ where: { branchId: bv }, select: { id: true } })
      const orgTireIds = orgTires.map((t: any) => t.id)
      warrantyOrgScope = {
        OR: [
          { vehicle: { branchId: bv } },
          { AND: [{ vehicleId: null }, { partType: 'tire' }, { partId: { in: orgTireIds } }] },
        ],
      }
    }

    const [
      totalVehicles, activeVehicles, maintenanceVehicles,
      totalExpensesMonth, fuelCostMonth, maintenanceCostMonth,
      prevExpenses, prevFuel, prevMaint,
      inventoryItems, recentMaintenance,
      overdueMaintenanceCount, expiringWarrantiesCount,
      waybillsThisMonth, activeWaybills,
    ] = await Promise.all([
      prisma.vehicle.count({ where: vehicleFilter }),
      prisma.vehicle.count({ where: { ...vehicleFilter, status: 'active' } }),
      prisma.vehicle.count({ where: { ...vehicleFilter, status: 'maintenance' } }),
      prisma.expense.aggregate({ where: { expenseDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { refuelDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { cost: true } }),
      prisma.maintenanceRecord.aggregate({ where: { installationDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { cost: true, laborCost: true } }),
      prisma.expense.aggregate({ where: { expenseDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }, vehicle: vehicleFilter }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { refuelDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }, vehicle: vehicleFilter }, _sum: { cost: true } }),
      prisma.maintenanceRecord.aggregate({ where: { installationDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }, vehicle: vehicleFilter }, _sum: { cost: true, laborCost: true } }),
      prisma.inventory.findMany({
        where: inventoryWhere,
        include: { sparePart: { select: { name: true, partCode: true, unitPrice: true } }, warehouse: { select: { name: true } } },
      }),
      prisma.maintenanceRecord.findMany({
        where: { vehicle: vehicleFilter },
        include: { vehicle: { select: { registrationNumber: true } }, sparePart: { select: { name: true } } },
        orderBy: { installationDate: 'desc' }, take: 5,
      }),
      prisma.maintenancePrediction.count({
        where: { predictedDate: { lt: now }, isAcknowledged: false, vehicle: vehicleFilter },
      }),
      prisma.warranty.count({
        where: { endDate: { gte: now, lte: in30Days }, status: { not: 'expired' }, ...warrantyOrgScope },
      }),
      prisma.waybill.findMany({
        where: { createdAt: { gte: startOfMonth }, ...(bv !== undefined ? { branchId: bv } : {}) },
        select: { status: true, distanceTraveled: true },
      }),
      prisma.waybill.count({ where: { status: 'active', ...(bv !== undefined ? { branchId: bv } : {}) } }),
    ])

    const lowStock = (inventoryItems as any[]).filter(i => i.quantityOnHand <= i.reorderLevel)
    const lowStockItems = lowStock.slice(0, 6).map((i: any) => ({
      name: i.sparePart.name,
      partCode: i.sparePart.partCode,
      quantityOnHand: i.quantityOnHand,
      reorderLevel: i.reorderLevel,
      branch: i.warehouse?.name || '—',
    }))

    const thisMonthExp = Number(totalExpensesMonth._sum.amount) || 0
    const thisMonthFuel = Number(fuelCostMonth._sum.cost) || 0
    const thisMonthMaint = (Number(maintenanceCostMonth._sum.cost) || 0) + (Number(maintenanceCostMonth._sum.laborCost) || 0)
    const prevMonthExp = Number(prevExpenses._sum.amount) || 0
    const prevMonthFuel = Number(prevFuel._sum.cost) || 0
    const prevMonthMaint = (Number(prevMaint._sum.cost) || 0) + (Number(prevMaint._sum.laborCost) || 0)

    const delta = (cur: number, prev: number) => prev === 0 ? null : Math.round(((cur - prev) / prev) * 100)

    const completedWaybills = waybillsThisMonth.filter(w => w.status === 'completed')
    const totalKmMonth = completedWaybills.reduce((s, w) => s + (Number(w.distanceTraveled) || 0), 0)

    res.json(successResponse({
      totalVehicles,
      activeVehicles,
      maintenanceVehicles,
      monthlyExpenses: thisMonthExp,
      monthlyFuelCost: thisMonthFuel,
      monthlyMaintenanceCost: thisMonthMaint,
      prevMonthExpenses: prevMonthExp,
      prevMonthFuelCost: prevMonthFuel,
      prevMonthMaintenanceCost: prevMonthMaint,
      deltaExpenses: delta(thisMonthExp, prevMonthExp),
      deltaFuel: delta(thisMonthFuel, prevMonthFuel),
      deltaMaintenance: delta(thisMonthMaint, prevMonthMaint),
      waybillsThisMonth: waybillsThisMonth.length,
      completedWaybillsThisMonth: completedWaybills.length,
      activeWaybills,
      totalKmMonth,
      lowStockCount: lowStock.length,
      lowStockItems,
      totalInventoryValue: (inventoryItems as any[]).reduce((s, i) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0),
      overdueMaintenanceCount,
      expiringWarrantiesCount,
      recentMaintenance,
    }))
  } catch (err) { next(err) }
}

export async function getCostPerKm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)
    const months = parseInt((req.query.months as string) || '3', 10)
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    const vehicles = await prisma.vehicle.findMany({
      where: { ...(bv !== undefined ? { branchId: bv } : {}), mileage: { gt: 0 } },
      select: {
        id: true, registrationNumber: true, brand: true, model: true, mileage: true,
        fuelRecords: { where: { refuelDate: { gte: since } }, select: { cost: true, amountLiters: true } },
        expenses: { where: { expenseDate: { gte: since }, category: { name: { not: 'Texnik xizmat' } } }, select: { amount: true } },
        maintenanceRecords: { where: { installationDate: { gte: since } }, select: { cost: true, laborCost: true } },
        waybills: { where: { status: 'completed', createdAt: { gte: since } }, select: { distanceTraveled: true } },
      },
    })

    const result = vehicles.map(v => {
      const fuelCost = v.fuelRecords.reduce((s, r) => s + Number(r.cost), 0)
      const fuelLiters = v.fuelRecords.reduce((s, r) => s + Number(r.amountLiters), 0)
      const expCost = v.expenses.reduce((s, e) => s + Number(e.amount), 0)
      const maintCost = v.maintenanceRecords.reduce((s, m) => s + Number(m.cost) + Number(m.laborCost), 0)
      const totalCost = fuelCost + expCost + maintCost
      const totalKm = v.waybills.reduce((s, w) => s + (Number(w.distanceTraveled) || 0), 0)
      const mileage = Number(v.mileage)
      const costPerKm = totalKm > 0 ? totalCost / totalKm : 0
      const lPer100km = totalKm > 0 ? (fuelLiters / totalKm) * 100 : 0
      return {
        id: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand, model: v.model,
        mileage, totalKm, fuelCost, maintCost, expCost, totalCost,
        costPerKm: Math.round(costPerKm),
        lPer100km: Number(lPer100km.toFixed(1)),
        fuelLiters: Math.round(fuelLiters),
      }
    }).filter(v => v.totalCost > 0 || v.totalKm > 0)
      .sort((a, b) => b.totalCost - a.totalCost)

    res.json(successResponse(result))
  } catch (err) { next(err) }
}

export async function getDriverStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)
    const months = parseInt((req.query.months as string) || '3', 10)
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    const waybills = await prisma.waybill.findMany({
      where: {
        status: 'completed',
        createdAt: { gte: since },
        ...(bv !== undefined ? { branchId: bv } : {}),
      },
      select: {
        driverId: true,
        distanceTraveled: true,
        fuelConsumed: true,
        driver: { select: { fullName: true } },
      },
    })

    const map: Record<string, { name: string; trips: number; km: number; fuel: number }> = {}
    waybills.forEach(w => {
      if (!map[w.driverId]) map[w.driverId] = { name: w.driver.fullName, trips: 0, km: 0, fuel: 0 }
      map[w.driverId].trips++
      map[w.driverId].km += Number(w.distanceTraveled) || 0
      map[w.driverId].fuel += Number(w.fuelConsumed) || 0
    })

    const drivers = Object.values(map)
      .map(d => ({
        ...d,
        km: Math.round(d.km),
        fuel: Math.round(d.fuel),
        lPer100km: d.km > 0 ? Number(((d.fuel / d.km) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.km - a.km)
      .slice(0, 10)

    res.json(successResponse(drivers))
  } catch (err) { next(err) }
}
