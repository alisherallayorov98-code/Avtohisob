import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { getOrgFilter, applyBranchFilter, applyNarrowedBranchFilter, isBranchAllowed, getOrgWarehouseIds, resolveOrgId } from '../lib/orgFilter'
import { isSimplifiedView } from '../services/orgSettingsService'
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

    const report = vehicles.map(v => {
      const totalExpenses = v.expenses.reduce((s, e) => s + Number(e.amount), 0)
      const totalFuelCost = v.fuelRecords.reduce((s, f) => s + Number(f.cost), 0)
      const totalFuelLiters = v.fuelRecords.reduce((s, f) => s + Number(f.amountLiters), 0)
      const totalMaintenanceCost = v.maintenanceRecords.reduce((s, m) => s + Number(m.cost) + Number(m.laborCost), 0)
      const mileage = Number(v.mileage)
      const kmL = totalFuelLiters > 0 && mileage > 0 ? Number((mileage / totalFuelLiters).toFixed(1)) : null
      return {
        id: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        branch: v.branch.name,
        status: v.status,
        mileage,
        totalExpenses,
        totalFuelCost,
        totalFuelLiters: Number(totalFuelLiters.toFixed(1)),
        totalMaintenanceCost,
        grandTotal: totalExpenses + totalFuelCost + totalMaintenanceCost,
        kmL,
      }
    }).sort((a, b) => b.grandTotal - a.grandTotal)

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
    const byMonth: Record<string, { cost: number; liters: number; count: number }> = {}
    const byVehicle: Record<string, { registrationNumber: string; cost: number; liters: number }> = {}

    records.forEach(r => {
      // byFuelType
      if (!byFuelType[r.fuelType]) byFuelType[r.fuelType] = { cost: 0, liters: 0 }
      byFuelType[r.fuelType].cost += Number(r.cost)
      byFuelType[r.fuelType].liters += Number(r.amountLiters)
      // byMonth
      const m = new Date(r.refuelDate).toISOString().slice(0, 7)
      if (!byMonth[m]) byMonth[m] = { cost: 0, liters: 0, count: 0 }
      byMonth[m].cost += Number(r.cost)
      byMonth[m].liters += Number(r.amountLiters)
      byMonth[m].count++
      // byVehicle
      const vid = r.vehicle.registrationNumber
      if (!byVehicle[vid]) byVehicle[vid] = { registrationNumber: vid, cost: 0, liters: 0 }
      byVehicle[vid].cost += Number(r.cost)
      byVehicle[vid].liters += Number(r.amountLiters)
    })

    const topVehicles = Object.values(byVehicle)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
      .map(v => ({ ...v, cost: Math.round(v.cost), liters: Number(v.liters.toFixed(1)) }))

    const monthTrend = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        label: new Date(month + '-01').toLocaleDateString('uz-UZ', { month: 'short', year: '2-digit' }),
        cost: Math.round(d.cost),
        liters: Number(d.liters.toFixed(1)),
        count: d.count,
      }))

    const totalCost = records.reduce((s, r) => s + Number(r.cost), 0)
    const totalLiters = records.reduce((s, r) => s + Number(r.amountLiters), 0)

    res.json(successResponse({
      totalCost,
      totalLiters,
      avgPricePerLiter: totalLiters > 0 ? Number((totalCost / totalLiters).toFixed(0)) : 0,
      count: records.length,
      byFuelType,
      monthTrend,
      topVehicles,
      records,
    }))
  } catch (err) { next(err) }
}

/**
 * GET /reports/fuel-daily?month=&year=&branchId=
 * Oydagi har bir kun bo'yicha umumiy yoqilg'i sarfi (barcha mashinalar jami).
 * Maqsad: gaz zapravka cheklari bilan solishtirish (01.06=2000, 02.06=2500 ...).
 */
export async function getFuelDailyReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = parseInt(String(req.query.month)) || (new Date().getMonth() + 1)
    const year = parseInt(String(req.query.year)) || new Date().getFullYear()
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)

    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)
    const where: any = { refuelDate: { gte: start, lt: end } }
    if (bv !== undefined) where.vehicle = { branchId: bv }

    const records = await prisma.fuelRecord.findMany({
      where,
      select: { refuelDate: true, amountLiters: true, cost: true },
    })

    const daysInMonth = new Date(year, month, 0).getDate()
    const acc = Array.from({ length: daysInMonth }, () => ({ liters: 0, cost: 0, count: 0 }))
    records.forEach(r => {
      const idx = new Date(r.refuelDate).getDate() - 1
      if (idx < 0 || idx >= daysInMonth) return
      acc[idx].liters += Number(r.amountLiters)
      acc[idx].cost += Number(r.cost)
      acc[idx].count++
    })

    const days = acc.map((d, i) => ({
      day: i + 1,
      date: `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
      liters: Number(d.liters.toFixed(1)),
      cost: Math.round(d.cost),
      count: d.count,
    }))

    res.json(successResponse({
      month,
      year,
      days,
      totalLiters: Number(days.reduce((s, d) => s + d.liters, 0).toFixed(1)),
      totalCost: days.reduce((s, d) => s + d.cost, 0),
      totalCount: days.reduce((s, d) => s + d.count, 0),
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
    // Soddalashtirilgan ko'rinish: faqat rasmiy yozuvlar
    const _orgIdMR = await resolveOrgId(req.user!)
    if (await isSimplifiedView(_orgIdMR)) where.isOfficial = true

    const records = await prisma.maintenanceRecord.findMany({
      where,
      include: {
        vehicle: { select: { registrationNumber: true } },
        sparePart: { select: { id: true, name: true, category: true } },
        performedBy: { select: { fullName: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    const byCategory: Record<string, number> = {}
    const byMonth: Record<string, number> = {}
    const partMap: Record<string, { name: string; category: string; count: number; totalCost: number }> = {}
    const workerMap: Record<string, { name: string; count: number; totalCost: number }> = {}

    records.forEach(r => {
      const cost = Number(r.cost) + Number(r.laborCost)
      // byCategory
      const cat = r.sparePart?.category || 'Boshqa'
      byCategory[cat] = (byCategory[cat] || 0) + cost
      // byMonth
      const m = new Date(r.installationDate).toISOString().slice(0, 7)
      byMonth[m] = (byMonth[m] || 0) + cost
      // topParts
      const pid = r.sparePart?.id || 'other'
      if (!partMap[pid]) partMap[pid] = { name: r.sparePart?.name || 'Boshqa', category: cat, count: 0, totalCost: 0 }
      partMap[pid].count += r.quantityUsed
      partMap[pid].totalCost += cost
      // byWorker
      const wname = r.performedBy?.fullName || 'Noma\'lum'
      if (!workerMap[wname]) workerMap[wname] = { name: wname, count: 0, totalCost: 0 }
      workerMap[wname].count++
      workerMap[wname].totalCost += cost
    })

    const topParts = Object.values(partMap).sort((a, b) => b.totalCost - a.totalCost).slice(0, 10)
    const byWorker = Object.values(workerMap).sort((a, b) => b.totalCost - a.totalCost)

    const monthTrend = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cost]) => ({
        month,
        label: new Date(month + '-01').toLocaleDateString('uz-UZ', { month: 'short', year: '2-digit' }),
        cost: Math.round(cost),
      }))

    const totalCost = records.reduce((s, r) => s + Number(r.cost) + Number(r.laborCost), 0)

    res.json(successResponse({
      totalCost,
      count: records.length,
      avgPerRecord: records.length > 0 ? Math.round(totalCost / records.length) : 0,
      byCategory,
      monthTrend,
      topParts,
      byWorker,
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

    const lowStockItems = lowStock.map((i: any) => ({
      id: i.id,
      name: i.sparePart.name,
      category: i.sparePart.category,
      warehouse: i.warehouse?.name || '—',
      quantityOnHand: i.quantityOnHand,
      reorderLevel: i.reorderLevel,
      unitPrice: Number(i.sparePart.unitPrice),
      totalValue: Number(i.quantityOnHand) * Number(i.sparePart.unitPrice),
    })).sort((a: any, b: any) => (a.quantityOnHand / Math.max(a.reorderLevel, 1)) - (b.quantityOnHand / Math.max(b.reorderLevel, 1)))

    res.json(successResponse({ totalValue, totalItems: inventory.length, lowStockCount: lowStock.length, byCategory, lowStockItems, inventory }))
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

    // Soddalashtirilgan ko'rinish: faqat rasmiy yozuvlar
    const _orgIdVR = await resolveOrgId(req.user!)
    const _simplifiedVR = await isSimplifiedView(_orgIdVR)
    const maintenance = await prisma.maintenanceRecord.findMany({
      where: {
        vehicleId: id,
        ...(dateRange ? { installationDate: dateRange } : {}),
        ...(_simplifiedVR ? { isOfficial: true } : {}),
      },
      include: {
        sparePart: { select: { name: true, category: true, articleCode: { select: { code: true } } } },
        // Bir yozuvda bir nechta ehtiyot qism bo'lsa — har birini alohida ko'rsatish uchun
        items: {
          include: {
            sparePart: { select: { name: true, category: true, articleCode: { select: { code: true } } } },
          },
        },
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
    const addPart = (key: string, name: string, category: string, articleCode: string, count: number, cost: number) => {
      if (!byPart[key]) byPart[key] = { name, category, articleCode, count: 0, totalCost: 0 }
      byPart[key].count += count
      byPart[key].totalCost += cost
    }
    maintenance.forEach((m: any) => {
      // Yangi yozuvlar: har bir qismni ALOHIDA hisoblaymiz (items)
      if (m.items && m.items.length > 0) {
        for (const it of m.items) {
          addPart(
            it.sparePartId,
            it.sparePart?.name || '—',
            it.sparePart?.category || 'Boshqa',
            it.sparePart?.articleCode?.code || '—',
            it.quantityUsed,
            Number(it.unitCost) * it.quantityUsed,
          )
        }
      } else {
        // Eski (legacy) yozuvlar: bitta sparePart
        addPart(
          m.sparePartId || m.id,
          m.sparePart?.name || '—',
          m.sparePart?.category || 'Boshqa',
          m.sparePart?.articleCode?.code || '—',
          m.quantityUsed,
          Number(m.cost),
        )
      }
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
        where: {
          installationDate: { gte: yearStart },
          vehicle: vehicleFilter,
          ...(await isSimplifiedView(await resolveOrgId(req.user!)) ? { isOfficial: true } : {}),
        },
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

    // Onboarding uchun UMR BO'YI mavjudlik bayroqlari (oylik summalar emas —
    // o'tgan oy quyilgan yoqilg'i ham "bajarildi" bo'lishi kerak). Frontend
    // OnboardingChecklist shu aniq bayroqlarni ishlatadi (avval taxminlar xato edi).
    const [fuelEver, maintEver] = await Promise.all([
      prisma.fuelRecord.count({ where: { vehicle: vehicleFilter } }),
      prisma.maintenanceRecord.count({ where: { vehicle: vehicleFilter } }),
    ])
    const onboarding = {
      hasVehicle: totalVehicles > 0,
      hasFuel: fuelEver > 0,
      hasMaintenance: maintEver > 0,
      hasSparePart: (inventoryItems as any[]).length > 0,
    }

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
      onboarding,
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

// ─── Nazorat markazi: barcha mashinalar muammolari agregat ───────────────────
export async function getFleetStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyNarrowedBranchFilter(filter, req.query.branchId as string | undefined)
    const vehicleWhere = branchFilter !== undefined ? { branchId: branchFilter } : {}

    const now = new Date()
    const in14days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    // 1. Barcha mashinalar (scope ichida)
    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true, branch: { select: { name: true } } },
      orderBy: { registrationNumber: 'asc' },
    })
    const vehicleIds = vehicles.map(v => v.id)
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]))

    if (vehicleIds.length === 0) return res.json(successResponse({ summary: { totalVehicles: 0, vehiclesWithIssues: 0, criticalHealth: 0, poorHealth: 0, overduePredictions: 0, upcomingPredictions: 0, expiringWarranties: 0, overdueServices: 0, dueSoonServices: 0 }, issues: [] }))

    // 2. Eng so'nggi health score har mashina uchun (bir so'rovda)
    const allScores = await prisma.vehicleHealthScore.findMany({
      where: { vehicleId: { in: vehicleIds } },
      orderBy: { calculatedAt: 'desc' },
      select: { vehicleId: true, score: true, grade: true, calculatedAt: true },
    })
    const latestScore = new Map<string, { score: any; grade: string; calculatedAt: Date }>()
    for (const s of allScores) {
      if (!latestScore.has(s.vehicleId)) latestScore.set(s.vehicleId, s)
    }

    // 3. Bashoratli xizmatlar (muddati o'tgan yoki 14 kunda)
    const predictions = await prisma.maintenancePrediction.findMany({
      where: { vehicleId: { in: vehicleIds }, isAcknowledged: false, predictedDate: { lte: in14days } },
      orderBy: { predictedDate: 'asc' },
      select: { id: true, vehicleId: true, partCategory: true, predictedDate: true, confidence: true },
    })

    // 4. Eskirayotgan kafolatlar (30 kun ichida)
    const warranties = await prisma.warranty.findMany({
      where: { vehicleId: { in: vehicleIds }, endDate: { lte: in30days, gte: now }, status: { not: 'expired' } },
      select: { id: true, vehicleId: true, partName: true, endDate: true },
    })

    // 5. Xizmat intervallari (muddati o'tgan yoki yaqin)
    const services = await (prisma as any).serviceInterval.findMany({
      where: { vehicleId: { in: vehicleIds }, status: { in: ['overdue', 'due_soon'] } },
      select: { id: true, vehicleId: true, serviceType: true, status: true, nextDueDate: true },
    }).catch(() => [] as any[])

    // Guruhlash
    const predByVehicle = new Map<string, typeof predictions>()
    for (const p of predictions) {
      if (!predByVehicle.has(p.vehicleId)) predByVehicle.set(p.vehicleId, [])
      predByVehicle.get(p.vehicleId)!.push(p)
    }
    const warByVehicle = new Map<string, typeof warranties>()
    for (const w of warranties) {
      if (!w.vehicleId) continue
      if (!warByVehicle.has(w.vehicleId)) warByVehicle.set(w.vehicleId, [])
      warByVehicle.get(w.vehicleId)!.push(w)
    }
    const svcByVehicle = new Map<string, any[]>()
    for (const s of services) {
      if (!svcByVehicle.has(s.vehicleId)) svcByVehicle.set(s.vehicleId, [])
      svcByVehicle.get(s.vehicleId)!.push(s)
    }

    // Muammolar ro'yxatini qurish
    const issues: any[] = []
    for (const vId of vehicleIds) {
      const vehicle = vehicleMap.get(vId)!
      const score = latestScore.get(vId)
      const preds = predByVehicle.get(vId) ?? []
      const wars = warByVehicle.get(vId) ?? []
      const svcs = svcByVehicle.get(vId) ?? []

      const poorHealth = score && (score.grade === 'poor' || score.grade === 'critical')
      if (!poorHealth && preds.length === 0 && wars.length === 0 && svcs.length === 0) continue

      // Og'irlik balli (saralash uchun)
      let severity = 0
      if (score?.grade === 'critical') severity += 100
      else if (score?.grade === 'poor') severity += 50
      const overduePreds = preds.filter(p => new Date(p.predictedDate) < now)
      severity += overduePreds.length * 30 + (preds.length - overduePreds.length) * 10
      severity += svcs.filter((s: any) => s.status === 'overdue').length * 20
      severity += svcs.filter((s: any) => s.status === 'due_soon').length * 5

      issues.push({
        vehicleId: vId,
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        branchName: (vehicle as any).branch?.name ?? null,
        healthScore: score ? { score: Number(score.score), grade: score.grade } : null,
        predictions: preds.map(p => ({
          id: p.id, partCategory: p.partCategory, predictedDate: p.predictedDate,
          isOverdue: new Date(p.predictedDate) < now, confidence: Number(p.confidence),
        })),
        warranties: wars.map(w => ({ id: w.id, partName: w.partName, endDate: w.endDate })),
        services: svcs.map((s: any) => ({ id: s.id, serviceType: s.serviceType, status: s.status, nextDueDate: s.nextDueDate })),
        severity,
      })
    }
    issues.sort((a, b) => b.severity - a.severity)

    const summary = {
      totalVehicles: vehicleIds.length,
      vehiclesWithIssues: issues.length,
      criticalHealth: [...latestScore.values()].filter(s => s.grade === 'critical').length,
      poorHealth: [...latestScore.values()].filter(s => s.grade === 'poor').length,
      overduePredictions: predictions.filter(p => new Date(p.predictedDate) < now).length,
      upcomingPredictions: predictions.filter(p => new Date(p.predictedDate) >= now).length,
      expiringWarranties: warranties.length,
      overdueServices: services.filter((s: any) => s.status === 'overdue').length,
      dueSoonServices: services.filter((s: any) => s.status === 'due_soon').length,
    }

    res.json(successResponse({ summary, issues }))
  } catch (err) { next(err) }
}

// ─── Xulosa hisoboti: bir so'rovda barcha asosiy KPI ──────────────────────────
export async function getSummaryReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)
    const vehicleFilter = bv !== undefined ? { branchId: bv } : {}

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const months12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1)

    const simplified = await isSimplifiedView(await resolveOrgId(req.user!))

    const [
      expenses12, fuel12, maint12,
      expCur, fuelCur, maintCur,
      expPrev, fuelPrev, maintPrev,
      vehicles,
    ] = await Promise.all([
      // 12 oylik trend uchun
      prisma.expense.findMany({
        where: { expenseDate: { gte: months12Start }, vehicle: vehicleFilter, category: { name: { not: 'Texnik xizmat' } } },
        select: { amount: true, expenseDate: true },
      }),
      prisma.fuelRecord.findMany({
        where: { refuelDate: { gte: months12Start }, vehicle: vehicleFilter },
        select: { cost: true, amountLiters: true, refuelDate: true },
      }),
      prisma.maintenanceRecord.findMany({
        where: { installationDate: { gte: months12Start }, vehicle: vehicleFilter, ...(simplified ? { isOfficial: true } : {}) },
        select: { cost: true, laborCost: true, installationDate: true },
      }),
      // Joriy oy
      prisma.expense.aggregate({ where: { expenseDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { refuelDate: { gte: startOfMonth }, vehicle: vehicleFilter }, _sum: { cost: true, amountLiters: true } }),
      prisma.maintenanceRecord.aggregate({ where: { installationDate: { gte: startOfMonth }, vehicle: vehicleFilter, ...(simplified ? { isOfficial: true } : {}) }, _sum: { cost: true, laborCost: true } }),
      // O'tgan oy
      prisma.expense.aggregate({ where: { expenseDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }, vehicle: vehicleFilter }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { refuelDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }, vehicle: vehicleFilter }, _sum: { cost: true } }),
      prisma.maintenanceRecord.aggregate({ where: { installationDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }, vehicle: vehicleFilter, ...(simplified ? { isOfficial: true } : {}) }, _sum: { cost: true, laborCost: true } }),
      // Mashinalar + xarajat
      prisma.vehicle.findMany({
        where: vehicleFilter,
        include: {
          expenses: { where: { expenseDate: { gte: months12Start }, category: { name: { not: 'Texnik xizmat' } } }, select: { amount: true } },
          fuelRecords: { where: { refuelDate: { gte: months12Start } }, select: { cost: true } },
          maintenanceRecords: { where: { installationDate: { gte: months12Start }, ...(simplified ? { isOfficial: true } : {}) }, select: { cost: true, laborCost: true } },
          branch: { select: { name: true } },
        },
      }),
    ])

    // 12 oylik trend
    const UZ_MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
      return { year: d.getFullYear(), month: d.getMonth(), label: `${UZ_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }
    })
    const trend = buckets.map(b => {
      const mExp = expenses12.filter(e => { const d = new Date(e.expenseDate); return d.getFullYear() === b.year && d.getMonth() === b.month })
      const mFuel = fuel12.filter(f => { const d = new Date(f.refuelDate); return d.getFullYear() === b.year && d.getMonth() === b.month })
      const mMaint = maint12.filter(r => { const d = new Date(r.installationDate); return d.getFullYear() === b.year && d.getMonth() === b.month })
      const exp = mExp.reduce((s, e) => s + Number(e.amount), 0)
      const fuel = mFuel.reduce((s, f) => s + Number(f.cost), 0)
      const maint = mMaint.reduce((s, r) => s + Number(r.cost) + Number(r.laborCost), 0)
      return { label: b.label, expenses: exp, fuel, maintenance: maint, total: exp + fuel + maint }
    })

    // Joriy va o'tgan oy
    const curExp = Number(expCur._sum.amount) || 0
    const curFuel = Number(fuelCur._sum.cost) || 0
    const curMaint = (Number(maintCur._sum.cost) || 0) + (Number(maintCur._sum.laborCost) || 0)
    const curTotal = curExp + curFuel + curMaint
    const prevExp = Number(expPrev._sum.amount) || 0
    const prevFuel = Number(fuelPrev._sum.cost) || 0
    const prevMaint = (Number(maintPrev._sum.cost) || 0) + (Number(maintPrev._sum.laborCost) || 0)
    const prevTotal = prevExp + prevFuel + prevMaint
    const delta = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null

    // Top 5 mashina (12 oy xarajat)
    const top5Vehicles = vehicles.map(v => ({
      id: v.id,
      registrationNumber: v.registrationNumber,
      brand: v.brand, model: v.model,
      branch: (v as any).branch?.name || '—',
      totalCost: v.expenses.reduce((s, e) => s + Number(e.amount), 0)
        + v.fuelRecords.reduce((s, f) => s + Number(f.cost), 0)
        + v.maintenanceRecords.reduce((s, m) => s + Number(m.cost) + Number(m.laborCost), 0),
    })).sort((a, b) => b.totalCost - a.totalCost).slice(0, 5)

    res.json(successResponse({
      currentMonth: { total: curTotal, expenses: curExp, fuel: curFuel, maintenance: curMaint },
      prevMonth: { total: prevTotal, expenses: prevExp, fuel: prevFuel, maintenance: prevMaint },
      delta: { total: delta(curTotal, prevTotal), expenses: delta(curExp, prevExp), fuel: delta(curFuel, prevFuel), maintenance: delta(curMaint, prevMaint) },
      trend,
      top5Vehicles,
      totalVehicles: vehicles.length,
    }))
  } catch (err) { next(err) }
}
