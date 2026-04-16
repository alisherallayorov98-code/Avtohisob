import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getFleetRiskDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const vehicleWhere: any = { status: 'active' }
    if (filterVal !== undefined) vehicleWhere.branchId = filterVal
    else if (branchId) vehicleWhere.branchId = branchId

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: {
        id: true, registrationNumber: true, brand: true, model: true, year: true,
        branchId: true, mileage: true,
        branch: { select: { name: true } },
      },
      orderBy: { registrationNumber: 'asc' },
    })

    const now = new Date()
    const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(now.getMonth() - 3)
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear() - 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const riskData = await Promise.all(vehicles.map(async (v) => {
      const [healthScore, overdueCount, recentMaint, overhaulCount, lastInspection] = await Promise.all([
        // Health score
        (prisma as any).vehicleHealthScore.findFirst({
          where: { vehicleId: v.id },
          orderBy: { calculatedAt: 'desc' },
          select: { score: true, calculatedAt: true },
        }),
        // Muddati o'tgan servis intervallar
        (prisma as any).serviceInterval.count({
          where: { vehicleId: v.id, status: 'overdue' },
        }),
        // So'nggi 3 oyda ta'mirat soni
        prisma.maintenanceRecord.count({
          where: { vehicleId: v.id, installationDate: { gte: threeMonthsAgo } },
        }),
        // 1 yilda dvigatel kapital/yirik ta'mirati
        (prisma as any).engineRecord.count({
          where: { vehicleId: v.id, recordType: { in: ['overhaul', 'major_repair'] }, date: { gte: oneYearAgo } },
        }),
        // Oxirgi texnik tekshiruv
        (prisma as any).techInspection.findFirst({
          where: { vehicleId: v.id },
          orderBy: { inspectionDate: 'desc' },
          select: { inspectionDate: true, overallStatus: true },
        }),
      ])

      // Xavf balli hisoblash
      let riskScore = 0
      const reasons: string[] = []

      // Health score
      const hs = healthScore?.score ? Number(healthScore.score) : 70
      if (hs < 40) { riskScore += 40; reasons.push(`Salomatlik bahosi past: ${hs}`) }
      else if (hs < 60) { riskScore += 20; reasons.push(`Salomatlik bahosi o'rta: ${hs}`) }

      // Muddati o'tgan xizmatlar
      if (overdueCount >= 3) { riskScore += 30; reasons.push(`${overdueCount} ta xizmat muddati o'tgan`) }
      else if (overdueCount > 0) { riskScore += 15; reasons.push(`${overdueCount} ta xizmat muddati o'tgan`) }

      // So'nggi 3 oyda ko'p ta'mirat
      if (recentMaint >= 4) { riskScore += 20; reasons.push(`3 oyda ${recentMaint} ta ta'mirat`) }
      else if (recentMaint >= 2) { riskScore += 10; reasons.push(`3 oyda ${recentMaint} ta ta'mirat`) }

      // Dvigatel yirik ta'miratlari
      if (overhaulCount >= 2) { riskScore += 30; reasons.push(`Dvigatel 1 yilda ${overhaulCount} marta yirik ta'mirat`) }
      else if (overhaulCount === 1) { riskScore += 10; reasons.push('Dvigatel yirik ta\'mirat o\'tdi') }

      // Texnik tekshiruv
      if (!lastInspection) {
        riskScore += 20; reasons.push('Hech qachon texnik tekshiruv o\'tmagan')
      } else if (lastInspection.overallStatus === 'critical') {
        riskScore += 25; reasons.push('Oxirgi texnik tekshiruv: KRITIK')
      } else if (lastInspection.overallStatus === 'warning') {
        riskScore += 10; reasons.push('Oxirgi tekshiruv: OGOHLANTIRISH')
      }
      // Shu oy tekshiruv yo'q
      if (!lastInspection || new Date(lastInspection.inspectionDate) < monthStart) {
        riskScore += 5; reasons.push('Bu oy texnik tekshiruv o\'tkazilmagan')
      }

      const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low'

      return {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        year: v.year,
        branchName: v.branch?.name,
        mileage: Number(v.mileage),
        riskLevel,
        riskScore,
        reasons,
        healthScore: hs,
        overdueServices: overdueCount,
        recentMaintenanceCount: recentMaint,
        engineOverhaulCount: overhaulCount,
        lastInspectionDate: lastInspection?.inspectionDate || null,
        lastInspectionStatus: lastInspection?.overallStatus || null,
      }
    }))

    // Xavf darajasi bo'yicha tartiblash
    const levelOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    riskData.sort((a, b) => levelOrder[a.riskLevel] - levelOrder[b.riskLevel] || b.riskScore - a.riskScore)

    const summary = {
      total: riskData.length,
      high: riskData.filter(r => r.riskLevel === 'high').length,
      medium: riskData.filter(r => r.riskLevel === 'medium').length,
      low: riskData.filter(r => r.riskLevel === 'low').length,
    }

    res.json(successResponse({ vehicles: riskData, summary }))
  } catch (err) { next(err) }
}

export async function getVehicleRiskDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      select: { branchId: true, registrationNumber: true, brand: true, model: true },
    })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    const [engineRecords, inspections, recentMaint] = await Promise.all([
      (prisma as any).engineRecord.findMany({
        where: { vehicleId: req.params.id },
        orderBy: { date: 'desc' },
        take: 20,
      }),
      (prisma as any).techInspection.findMany({
        where: { vehicleId: req.params.id },
        orderBy: { inspectionDate: 'desc' },
        take: 12,
        include: { inspectedBy: { select: { fullName: true } } },
      }),
      prisma.maintenanceRecord.findMany({
        where: { vehicleId: req.params.id, installationDate: { gte: oneYearAgo } },
        select: { id: true, installationDate: true, cost: true, laborCost: true, notes: true },
        orderBy: { installationDate: 'desc' },
      }),
    ])

    res.json(successResponse({ engineRecords, inspections, recentMaintenance: recentMaint }))
  } catch (err) { next(err) }
}
