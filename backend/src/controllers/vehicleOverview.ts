import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { getOrgFilter, isBranchAllowed, resolveOrgId } from '../lib/orgFilter'
import { isSimplifiedView } from '../services/orgSettingsService'
import { AppError } from '../middleware/errorHandler'
import { buildMonthlySeries, computeConsumption, docStatus } from '../lib/vehicleOverviewMath'

// GET /reports/vehicle/:id/overview — mashina sahifasining "Umumiy" tabi uchun jamlangan ma'lumot.
// Faqat o'qiydi. Faqat tasdiqlangan (approved) ta'mirlar hisoblanadi.
export async function getVehicleOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const filter = await getOrgFilter(req.user!)
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      select: { id: true, branchId: true, fuelNormPer100km: true, insuranceExpiry: true, techInspectionExpiry: true },
    })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)
    if (filter.type !== 'none' && !isBranchAllowed(filter, vehicle.branchId)) {
      return res.status(403).json({ success: false, error: "Ruxsat yo'q" })
    }

    const now = new Date()
    const since = new Date(now.getTime() - 200 * 86400000)
    const simplified = await isSimplifiedView(await resolveOrgId(req.user!))

    const [maint, fuel, exp, fuelForCons] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where: { vehicleId: id, status: 'approved', installationDate: { gte: since }, ...(simplified ? { isOfficial: true } : {}) },
        select: {
          id: true, installationDate: true, cost: true, laborCost: true,
          sparePart: { select: { name: true } },
          items: { select: { sparePart: { select: { name: true } } } },
        },
        orderBy: { installationDate: 'desc' },
      }),
      prisma.fuelRecord.findMany({
        where: { vehicleId: id, refuelDate: { gte: since } },
        select: { id: true, refuelDate: true, cost: true, amountLiters: true },
        orderBy: { refuelDate: 'desc' },
      }),
      prisma.expense.findMany({
        where: { vehicleId: id, expenseDate: { gte: since }, category: { name: { not: 'Texnik xizmat' } } },
        select: { id: true, expenseDate: true, amount: true, description: true },
        orderBy: { expenseDate: 'desc' },
      }),
      prisma.fuelRecord.findMany({
        where: { vehicleId: id },
        select: { refuelDate: true, amountLiters: true, odometerReading: true },
        orderBy: { refuelDate: 'desc' },
        take: 12,
      }),
    ])

    const monthly = buildMonthlySeries(now, 6, {
      maintenance: maint.map(m => ({ date: m.installationDate, amount: Number(m.cost) + Number(m.laborCost) })),
      fuel: fuel.map(f => ({ date: f.refuelDate, amount: Number(f.cost) })),
      expenses: exp.map(e => ({ date: e.expenseDate, amount: Number(e.amount) })),
    })

    const consumption = computeConsumption(
      fuelForCons.map(f => ({ liters: Number(f.amountLiters), odometer: Number(f.odometerReading), date: f.refuelDate })),
      vehicle.fuelNormPer100km ? Number(vehicle.fuelNormPer100km) : null,
    )

    const events = [
      ...maint.slice(0, 5).map(m => ({
        type: 'maintenance' as const, id: m.id, date: m.installationDate, amount: Number(m.cost) + Number(m.laborCost),
        title: (m.items.length ? m.items.map(i => i.sparePart?.name).filter(Boolean).join(', ') : m.sparePart?.name) || "Ta'mirlash",
      })),
      ...fuel.slice(0, 5).map(f => ({
        type: 'fuel' as const, id: f.id, date: f.refuelDate, amount: Number(f.cost),
        title: `${Number(f.amountLiters).toFixed(0)} litr yoqilg'i`,
      })),
      ...exp.slice(0, 5).map(e => ({
        type: 'expense' as const, id: e.id, date: e.expenseDate, amount: Number(e.amount), title: e.description || 'Xarajat',
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6)

    res.json(successResponse({
      monthly,
      consumption,
      events,
      docs: {
        insurance: docStatus(vehicle.insuranceExpiry, now),
        techInspection: docStatus(vehicle.techInspectionExpiry, now),
      },
    }))
  } catch (err) { next(err) }
}
