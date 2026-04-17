import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyNarrowedBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getFleetRiskDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)

    const vehicleWhere: any = { status: 'active' }
    if (narrowed !== undefined) vehicleWhere.branchId = narrowed

    const vehicles = await prisma.vehicle.findMany({
      where: vehicleWhere,
      select: {
        id: true, registrationNumber: true, brand: true, model: true, year: true,
        branchId: true, mileage: true, lastGpsSignal: true, gpsUnitName: true,
        branch: { select: { name: true } },
      },
      orderBy: { registrationNumber: 'asc' },
    })

    if (vehicles.length === 0) {
      return res.json({ success: true, data: [], summary: { total: 0, high: 0, medium: 0, low: 0 } })
    }

    const vehicleIds = vehicles.map(v => v.id)
    const now = new Date()
    const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(now.getMonth() - 3)
    const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(now.getMonth() - 6)
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear() - 1)

    // ─── 9 ta batch so'rov (parallel) — oldin har mashina uchun 9 ta edi ───────
    const [
      totalInspectionsInSystem,
      healthScores,
      overdueGroups,
      maint3Groups,
      maint12Groups,
      overhaulGroups,
      inspections,
      unresolvedAnomalyGroups,
      highCostMaintGroups,
      fuelAnomalyGroups,
    ] = await Promise.all([
      (prisma as any).techInspection.count(),
      // 1. Health score — har mashina uchun eng so'nggisini JS da ajratib olamiz
      (prisma as any).vehicleHealthScore.findMany({
        where: { vehicleId: { in: vehicleIds } },
        orderBy: { calculatedAt: 'desc' },
        select: { vehicleId: true, score: true },
      }),
      // 2. Muddati o'tgan servislar
      (prisma as any).serviceInterval.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: vehicleIds }, status: 'overdue' },
        _count: { _all: true },
      }),
      // 3. So'nggi 3 oyda ta'mirat soni
      prisma.maintenanceRecord.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: vehicleIds }, installationDate: { gte: threeMonthsAgo } },
        _count: { _all: true },
      }),
      // 4. So'nggi 12 oyda jami ta'mirat
      prisma.maintenanceRecord.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: vehicleIds }, installationDate: { gte: oneYearAgo } },
        _count: { _all: true },
      }),
      // 5. 1 yilda dvigatel yirik ta'miratlari
      (prisma as any).engineRecord.groupBy({
        by: ['vehicleId'],
        where: {
          vehicleId: { in: vehicleIds },
          recordType: { in: ['overhaul', 'major_repair'] },
          date: { gte: oneYearAgo },
        },
        _count: { _all: true },
      }),
      // 6. Oxirgi texnik tekshiruv — har mashina uchun eng so'nggisini JS da ajratamiz
      (prisma as any).techInspection.findMany({
        where: { vehicleId: { in: vehicleIds } },
        orderBy: { inspectionDate: 'desc' },
        select: { vehicleId: true, inspectionDate: true, overallStatus: true },
      }),
      // 7. Hal qilinmagan anomaliyalar
      (prisma as any).anomaly.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: vehicleIds }, isResolved: false },
        _count: { _all: true },
      }).catch(() => [] as any[]),
      // 8. 6 oyda katta xarajatli ta'miratlar (3M+ so'm)
      prisma.maintenanceRecord.groupBy({
        by: ['vehicleId'],
        where: {
          vehicleId: { in: vehicleIds },
          installationDate: { gte: sixMonthsAgo },
          cost: { gte: 3_000_000 },
        },
        _count: { _all: true },
      }),
      // 9. Yoqilg'i sarfi anomaliyalari
      (prisma as any).anomaly.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: vehicleIds }, type: 'fuel_spike', isResolved: false },
        _count: { _all: true },
      }).catch(() => [] as any[]),
    ])

    // ─── Lookup Map'lar (O(1) kirish, default 0) ──────────────────────────────
    const scoreByVehicle = new Map<string, number>()
    for (const s of healthScores) {
      if (!scoreByVehicle.has(s.vehicleId)) scoreByVehicle.set(s.vehicleId, Number(s.score))
    }
    const inspectionByVehicle = new Map<string, { inspectionDate: Date; overallStatus: string }>()
    for (const i of inspections) {
      if (!inspectionByVehicle.has(i.vehicleId)) inspectionByVehicle.set(i.vehicleId, i)
    }
    const toCountMap = (groups: any[]) => {
      const m = new Map<string, number>()
      for (const g of groups) m.set(g.vehicleId, g._count._all)
      return m
    }
    const overdueMap = toCountMap(overdueGroups)
    const maint3Map = toCountMap(maint3Groups)
    const maint12Map = toCountMap(maint12Groups)
    const overhaulMap = toCountMap(overhaulGroups)
    const unresolvedAnomalyMap = toCountMap(unresolvedAnomalyGroups)
    const highCostMap = toCountMap(highCostMaintGroups)
    const fuelAnomalyMap = toCountMap(fuelAnomalyGroups)

    // ─── Har mashina uchun xavf balli (mantiq o'zgarmagan) ────────────────────
    const riskData = vehicles.map(v => {
      const healthScore = scoreByVehicle.get(v.id) ?? null
      const overdueCount = overdueMap.get(v.id) ?? 0
      const recentMaint3 = maint3Map.get(v.id) ?? 0
      const totalMaint12 = maint12Map.get(v.id) ?? 0
      const overhaulCount = overhaulMap.get(v.id) ?? 0
      const lastInspection = inspectionByVehicle.get(v.id) ?? null
      const unresolvedAnomalies = unresolvedAnomalyMap.get(v.id) ?? 0
      const highCostMaint = highCostMap.get(v.id) ?? 0
      const fuelAnomalies = fuelAnomalyMap.get(v.id) ?? 0

      let riskScore = 0
      const factors: string[] = []

      // 1. DVIGATEL YIRIK TA'MIRAT (max 35)
      if (overhaulCount >= 2) {
        riskScore += 35
        factors.push(`Dvigatel ${overhaulCount}x yirik ta'mirat (1 yil)`)
      } else if (overhaulCount === 1) {
        riskScore += 12
        factors.push('Dvigatel yirik ta\'mirat (1 yil)')
      }

      // 2. MUDDATI O'TGAN XIZMATLAR (max 25)
      if (overdueCount >= 3) {
        riskScore += 25
        factors.push(`${overdueCount} ta xizmat muddati o'tib ketgan`)
      } else if (overdueCount === 2) {
        riskScore += 18
        factors.push(`${overdueCount} ta xizmat muddati o'tib ketgan`)
      } else if (overdueCount === 1) {
        riskScore += 10
        factors.push('1 ta xizmat muddati o\'tib ketgan')
      }

      // 3. SO'NGGI 3 OYDA KO'P TA'MIRAT (max 20)
      if (recentMaint3 >= 5) {
        riskScore += 20
        factors.push(`3 oyda ${recentMaint3} ta ta'mirat — juda ko'p`)
      } else if (recentMaint3 >= 3) {
        riskScore += 12
        factors.push(`3 oyda ${recentMaint3} ta ta'mirat`)
      } else if (recentMaint3 === 2) {
        riskScore += 5
        factors.push('3 oyda 2 ta ta\'mirat')
      }

      // 4. HAL QILINMAGAN ANOMALIYALAR (max 15)
      if (unresolvedAnomalies >= 3) {
        riskScore += 15
        factors.push(`${unresolvedAnomalies} ta hal qilinmagan anomaliya`)
      } else if (unresolvedAnomalies >= 1) {
        riskScore += 8
        factors.push(`${unresolvedAnomalies} ta hal qilinmagan anomaliya`)
      }

      // 5. KATTA XARAJATLI TA'MIRATLAR (max 15)
      if (highCostMaint >= 3) {
        riskScore += 15
        factors.push(`6 oyda ${highCostMaint} ta katta xarajatli ta'mirat`)
      } else if (highCostMaint === 2) {
        riskScore += 8
        factors.push('6 oyda 2 ta katta ta\'mirat')
      }

      // 6. HEALTH SCORE past bo'lsa (max 15)
      if (healthScore !== null) {
        if (healthScore < 30) {
          riskScore += 15
          factors.push(`Texnik holat bahosi juda past: ${healthScore}`)
        } else if (healthScore < 50) {
          riskScore += 8
          factors.push(`Texnik holat bahosi past: ${healthScore}`)
        }
      }

      // 7. TEXNIK TEKSHIRUV kritik (max 10) — faqat tizimda ma'lumot bo'lsa
      if (totalInspectionsInSystem > 0 && lastInspection) {
        if (lastInspection.overallStatus === 'critical') {
          riskScore += 10
          factors.push('Oxirgi tekshiruv: KRITIK holat')
        } else if (lastInspection.overallStatus === 'warning') {
          riskScore += 5
          factors.push('Oxirgi tekshiruv: ogohlantirish')
        }
      }

      // 8. YOQILG'I ANOMALIYASI (max 5)
      if (fuelAnomalies >= 1) {
        riskScore += 5
        factors.push('Yoqilg\'i sarfida anomaliya')
      }

      // GPS signal faktori
      const gpsSignal = v.lastGpsSignal ? new Date(v.lastGpsSignal) : null
      const hasGpsLinked = !!(v.gpsUnitName || gpsSignal)
      if (hasGpsLinked && gpsSignal) {
        const hoursAgo = (now.getTime() - gpsSignal.getTime()) / 3600000
        if (hoursAgo > 72) {
          riskScore += 15
          factors.push(`GPS signal ${Math.round(hoursAgo / 24)} kun yo'q`)
        } else if (hoursAgo > 24) {
          riskScore += 8
          factors.push(`GPS signal ${Math.round(hoursAgo)} soat yo'q`)
        }
      }

      riskScore = Math.min(riskScore, 100)
      const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 25 ? 'medium' : 'low'

      return {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        branch: v.branch?.name || null,
        riskLevel,
        riskScore,
        healthScore: healthScore ?? 0,
        overdueCount,
        overhaulCount,
        recentMaint: recentMaint3,
        totalMaint12,
        unresolvedAnomalies,
        lastInspection: lastInspection?.inspectionDate || null,
        lastInspectionStatus: lastInspection?.overallStatus || null,
        factors,
      }
    })

    const levelOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    riskData.sort((a, b) => levelOrder[a.riskLevel] - levelOrder[b.riskLevel] || b.riskScore - a.riskScore)

    const summary = {
      total: riskData.length,
      high: riskData.filter(r => r.riskLevel === 'high').length,
      medium: riskData.filter(r => r.riskLevel === 'medium').length,
      low: riskData.filter(r => r.riskLevel === 'low').length,
    }

    res.json({ success: true, data: riskData, summary })
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
