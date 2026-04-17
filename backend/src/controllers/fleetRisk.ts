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

    const now = new Date()
    const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(now.getMonth() - 3)
    const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(now.getMonth() - 6)
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear() - 1)

    // Tizimda umuman texnik tekshiruv bormi? (yangi tizim bo'lsa penalti qo'ymaymiz)
    const totalInspectionsInSystem = await (prisma as any).techInspection.count()

    const riskData = await Promise.all(vehicles.map(async (v) => {
      const [
        healthScore,
        overdueCount,
        recentMaint3,     // so'nggi 3 oyda ta'mirat
        totalMaint12,     // so'nggi 12 oyda jami ta'mirat
        overhaulCount,    // 1 yilda dvigatel yirik ta'mirati
        lastInspection,
        unresolvedAnomalies,  // hal qilinmagan anomaliyalar
        highCostMaint,    // so'nggi 6 oyda katta xarajatli ta'miratlar (3 ta va ko'p)
        fuelAnomalies,    // yoqilg'i anomaliyalari
      ] = await Promise.all([
        // 1. Health score (tizim tomonidan hisoblangan)
        (prisma as any).vehicleHealthScore.findFirst({
          where: { vehicleId: v.id },
          orderBy: { calculatedAt: 'desc' },
          select: { score: true },
        }),
        // 2. Muddati o'tgan servis intervallar (real vaqt o'tgan xizmatlar)
        (prisma as any).serviceInterval.count({
          where: { vehicleId: v.id, status: 'overdue' },
        }),
        // 3. So'nggi 3 oyda ta'mirat soni
        prisma.maintenanceRecord.count({
          where: { vehicleId: v.id, installationDate: { gte: threeMonthsAgo } },
        }),
        // 4. So'nggi 12 oyda jami ta'mirat soni
        prisma.maintenanceRecord.count({
          where: { vehicleId: v.id, installationDate: { gte: oneYearAgo } },
        }),
        // 5. 1 yilda dvigatel kapital/yirik ta'mirati
        (prisma as any).engineRecord.count({
          where: { vehicleId: v.id, recordType: { in: ['overhaul', 'major_repair'] }, date: { gte: oneYearAgo } },
        }),
        // 6. Oxirgi texnik tekshiruv (faqat tizim ishlatilayotgan bo'lsa)
        (prisma as any).techInspection.findFirst({
          where: { vehicleId: v.id },
          orderBy: { inspectionDate: 'desc' },
          select: { inspectionDate: true, overallStatus: true },
        }),
        // 7. Hal qilinmagan anomaliyalar
        (prisma as any).anomaly.count({
          where: { vehicleId: v.id, isResolved: false },
        }).catch(() => 0),
        // 8. So'nggi 6 oyda katta xarajatli ta'miratlar (xarajat 3M+ so'm)
        prisma.maintenanceRecord.count({
          where: {
            vehicleId: v.id,
            installationDate: { gte: sixMonthsAgo },
            cost: { gte: 3_000_000 },
          },
        }),
        // 9. Yoqilg'i sarfi anomaliyalari
        (prisma as any).anomaly.count({
          where: { vehicleId: v.id, type: 'fuel_spike', isResolved: false },
        }).catch(() => 0),
      ])

      // ─── Xavf balli hisoblash (0–100) ─────────────────────────────────────
      // Har bir faktor mustaqil baholanadi, yosh/yil hisobga OLINMAYDI
      let riskScore = 0
      const factors: string[] = []

      // 1. DVIGATEL YIRIK TA'MIRAT — eng og'ir signal (max 35)
      //    Yiliga 2+ marta kapital ta'mirlash juda xavfli holat
      if (overhaulCount >= 2) {
        riskScore += 35
        factors.push(`Dvigatel ${overhaulCount}x yirik ta'mirat (1 yil)`)
      } else if (overhaulCount === 1) {
        riskScore += 12
        factors.push('Dvigatel yirik ta\'mirat (1 yil)')
      }

      // 2. MUDDATI O'TGAN XIZMATLAR — rejalashtirilgan TS o'tkazib yuborilgan (max 25)
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

      // 3. SO'NGGI 3 OYDA JUDA KO'P TA'MIRAT — mashina tez-tez buzilmoqda (max 20)
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

      // 4. HAL QILINMAGAN ANOMALIYALAR — AI tomonidan aniqlangan muammolar (max 15)
      if (unresolvedAnomalies >= 3) {
        riskScore += 15
        factors.push(`${unresolvedAnomalies} ta hal qilinmagan anomaliya`)
      } else if (unresolvedAnomalies >= 1) {
        riskScore += 8
        factors.push(`${unresolvedAnomalies} ta hal qilinmagan anomaliya`)
      }

      // 5. KATTA XARAJATLI TA'MIRATLAR — 6 oyda 3+ katta ta'mirat (max 15)
      if (highCostMaint >= 3) {
        riskScore += 15
        factors.push(`6 oyda ${highCostMaint} ta katta xarajatli ta'mirat`)
      } else if (highCostMaint === 2) {
        riskScore += 8
        factors.push('6 oyda 2 ta katta ta\'mirat')
      }

      // 6. HEALTH SCORE — faqat juda past bo'lsa (real muammo belgisi) (max 15)
      //    70 va undan yuqori = normal holat, past = muammo
      const hs = healthScore?.score ? Number(healthScore.score) : null
      if (hs !== null) {
        if (hs < 30) {
          riskScore += 15
          factors.push(`Texnik holat bahosi juda past: ${hs}`)
        } else if (hs < 50) {
          riskScore += 8
          factors.push(`Texnik holat bahosi past: ${hs}`)
        }
        // 50+ normal — penalti yo'q
      }

      // 7. TEXNIK TEKSHIRUV — faqat tizimda ma'lumot bo'lsa va kritik bo'lsa (max 10)
      //    Yangi tizimda hali tekshiruv yo'q → penalti QILMAYMIZ
      if (totalInspectionsInSystem > 0 && lastInspection) {
        if (lastInspection.overallStatus === 'critical') {
          riskScore += 10
          factors.push('Oxirgi tekshiruv: KRITIK holat')
        } else if (lastInspection.overallStatus === 'warning') {
          riskScore += 5
          factors.push('Oxirgi tekshiruv: ogohlantirish')
        }
        // ok → 0
      }

      // 8. YOQILG'I ANOMALIYASI — sarfda muammo (max 5)
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

      // Ball 100 dan oshmasin
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
        healthScore: hs ?? 0,
        overdueCount,
        overhaulCount,
        recentMaint: recentMaint3,
        totalMaint12,
        unresolvedAnomalies,
        lastInspection: lastInspection?.inspectionDate || null,
        lastInspectionStatus: lastInspection?.overallStatus || null,
        factors,
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
