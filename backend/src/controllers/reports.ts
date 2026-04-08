import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'

function dateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined
  return { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) }
}

export async function getVehiclesReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const expenseFilter: any = {}
    if (from || to) expenseFilter.expenseDate = dateFilter(from, to)
    if (effectiveBranchId) expenseFilter.vehicle = { branchId: effectiveBranchId }

    const vehicles = await prisma.vehicle.findMany({
      where: effectiveBranchId ? { branchId: effectiveBranchId } : {},
      include: {
        branch: { select: { name: true } },
        expenses: { where: expenseFilter, select: { amount: true } },
        fuelRecords: { where: from || to ? { refuelDate: dateFilter(from, to) } : {}, select: { cost: true, amountLiters: true } },
        maintenanceRecords: { where: from || to ? { installationDate: dateFilter(from, to) } : {}, select: { cost: true } },
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
      totalMaintenanceCost: v.maintenanceRecords.reduce((s, m) => s + Number(m.cost), 0),
    })).sort((a, b) => (b.totalExpenses + b.totalFuelCost) - (a.totalExpenses + a.totalFuelCost))

    res.json(successResponse(report))
  } catch (err) { next(err) }
}

export async function getExpensesReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (from || to) where.expenseDate = dateFilter(from, to)
    if (effectiveBranchId) where.vehicle = { branchId: effectiveBranchId }

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
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (from || to) where.refuelDate = dateFilter(from, to)
    if (effectiveBranchId) where.vehicle = { branchId: effectiveBranchId }

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
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (from || to) where.installationDate = dateFilter(from, to)
    if (effectiveBranchId) where.vehicle = { branchId: effectiveBranchId }

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
      byCategory[r.sparePart.category] = (byCategory[r.sparePart.category] || 0) + Number(r.cost)
    })

    res.json(successResponse({
      totalCost: records.reduce((s, r) => s + Number(r.cost), 0),
      count: records.length,
      byCategory,
      records,
    }))
  } catch (err) { next(err) }
}

export async function getInventoryReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (effectiveBranchId) where.branchId = effectiveBranchId

    const inventory = await prisma.inventory.findMany({
      where,
      include: {
        sparePart: { select: { name: true, category: true, unitPrice: true } },
        branch: { select: { name: true } },
      },
    })

    const totalValue = inventory.reduce((s, i) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0)
    const lowStock = inventory.filter(i => i.quantityOnHand <= i.reorderLevel)
    const byCategory: Record<string, { count: number; value: number }> = {}
    inventory.forEach(i => {
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

    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      include: {
        vehicles: { select: { id: true, status: true } },
        inventories: { include: { sparePart: { select: { unitPrice: true } } } },
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
        inventoryValue: b.inventories.reduce((s, i) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0),
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

    const dateRange = from || to ? dateFilter(from, to) : undefined

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: { branch: { select: { name: true, location: true } } },
    })
    if (!vehicle) throw new Error('Avtomobil topilmadi')

    // Ehtiyot qismlar va xizmatlar (ta'mirlash yozuvlari)
    const maintenance = await prisma.maintenanceRecord.findMany({
      where: {
        vehicleId: id,
        ...(dateRange ? { installationDate: dateRange } : {}),
      },
      include: {
        sparePart: {
          select: { name: true, category: true, articleCode: { select: { code: true } } },
        },
        performedBy: { select: { fullName: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    // Yoqilg'i yozuvlari
    const fuelRecords = await prisma.fuelRecord.findMany({
      where: {
        vehicleId: id,
        ...(dateRange ? { refuelDate: dateRange } : {}),
      },
      include: {
        supplier: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { refuelDate: 'desc' },
    })

    // Boshqa xarajatlar
    const expenses = await prisma.expense.findMany({
      where: {
        vehicleId: id,
        ...(dateRange ? { expenseDate: dateRange } : {}),
      },
      include: {
        category: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
    })

    // Ustalar bo'yicha xarajat (kim qancha pul oldi)
    const byWorker: Record<string, { name: string; count: number; totalCost: number; records: any[] }> = {}
    maintenance.forEach(m => {
      const name = m.performedBy.fullName
      if (!byWorker[name]) byWorker[name] = { name, count: 0, totalCost: 0, records: [] }
      byWorker[name].count++
      byWorker[name].totalCost += Number(m.cost)
      byWorker[name].records.push({
        date: m.installationDate,
        sparePart: m.sparePart.name,
        cost: Number(m.cost),
      })
    })

    // Ehtiyot qismlar bo'yicha xarajat
    const byPart: Record<string, { name: string; category: string; articleCode: string; count: number; totalCost: number }> = {}
    maintenance.forEach(m => {
      const key = m.sparePartId
      if (!byPart[key]) byPart[key] = {
        name: m.sparePart.name,
        category: m.sparePart.category,
        articleCode: m.sparePart.articleCode?.code || '—',
        count: 0,
        totalCost: 0,
      }
      byPart[key].count += m.quantityUsed
      byPart[key].totalCost += Number(m.cost)
    })

    // Jami summalar
    const totalMaintenance = maintenance.reduce((s, m) => s + Number(m.cost), 0)
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

export async function getDashboardStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : undefined
    const vehicleFilter = branchId ? { branchId } : {}
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalVehicles, activeVehicles, totalExpensesMonth, fuelCostMonth, inventoryItems, recentMaintenance, recentFuel] = await Promise.all([
      prisma.vehicle.count({ where: vehicleFilter }),
      prisma.vehicle.count({ where: { ...vehicleFilter, status: 'active' } }),
      prisma.expense.aggregate({ where: { expenseDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { refuelDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { cost: true } }),
      prisma.inventory.findMany({ where: branchId ? { branchId } : {}, include: { sparePart: { select: { unitPrice: true } } } }),
      prisma.maintenanceRecord.findMany({ where: { vehicle: vehicleFilter }, include: { vehicle: { select: { registrationNumber: true } }, sparePart: { select: { name: true } } }, orderBy: { installationDate: 'desc' }, take: 5 }),
      prisma.fuelRecord.findMany({ where: { vehicle: vehicleFilter }, include: { vehicle: { select: { registrationNumber: true } } }, orderBy: { refuelDate: 'desc' }, take: 5 }),
    ])

    const lowStock = inventoryItems.filter(i => i.quantityOnHand <= i.reorderLevel)

    res.json(successResponse({
      totalVehicles,
      activeVehicles,
      monthlyExpenses: Number(totalExpensesMonth._sum.amount) || 0,
      monthlyFuelCost: Number(fuelCostMonth._sum.cost) || 0,
      lowStockCount: lowStock.length,
      totalInventoryValue: inventoryItems.reduce((s, i) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0),
      recentMaintenance,
      recentFuel,
    }))
  } catch (err) { next(err) }
}
