import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { calculateHealthScore, getLatestHealthScores } from '../services/healthScoreService'
import { detectVehicleAnomalies } from '../services/anomalyDetectionService'
import { generateRecommendations } from '../services/recommendationsEngine'
import { predictNextMaintenance } from '../services/forecastingService'
import { computeFuelMetrics, getFleetFuelTrends, getTopFuelConsumers } from '../services/fuelAnalyticsService'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

async function assertVehicleAccess(req: AuthRequest, vehicleId: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, branchId: true } })
  if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, vehicle.branchId)) throw new AppError("Ruxsat yo'q", 403)
  return vehicle
}

async function assertAnomalyAccess(req: AuthRequest, id: string) {
  const anomaly = await prisma.anomaly.findUnique({ where: { id }, include: { vehicle: { select: { branchId: true } } } })
  if (!anomaly) throw new AppError('Anomaliya topilmadi', 404)
  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, anomaly.vehicle.branchId)) throw new AppError("Ruxsat yo'q", 403)
  return anomaly
}

async function assertRecommendationAccess(req: AuthRequest, id: string) {
  const rec = await prisma.recommendation.findUnique({ where: { id }, include: { vehicle: { select: { branchId: true } } } })
  if (!rec) throw new AppError('Tavsiya topilmadi', 404)
  const filter = await getOrgFilter(req.user!)
  const branchId = rec.vehicle?.branchId ?? (rec as any).branchId ?? null
  if (branchId && !isBranchAllowed(filter, branchId)) throw new AppError("Ruxsat yo'q", 403)
  // If no branchId at all (legacy global rec), only super_admin may dismiss
  if (!branchId && req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
  return rec
}

async function assertPredictionAccess(req: AuthRequest, id: string) {
  const pred = await prisma.maintenancePrediction.findUnique({ where: { id }, include: { vehicle: { select: { branchId: true } } } })
  if (!pred) throw new AppError('Bashorat topilmadi', 404)
  const filter = await getOrgFilter(req.user!)
  if (!isBranchAllowed(filter, pred.vehicle.branchId)) throw new AppError("Ruxsat yo'q", 403)
  return pred
}

async function assertAlertAccess(req: AuthRequest, id: string) {
  const alert = await prisma.alert.findUnique({ where: { id } })
  if (!alert) throw new AppError('Bildirishnoma topilmadi', 404)
  const filter = await getOrgFilter(req.user!)
  // Owner can always read/mark their own alert; otherwise must be in org scope
  if (alert.userId === req.user!.id) return alert
  if (alert.branchId && !isBranchAllowed(filter, alert.branchId)) throw new AppError("Ruxsat yo'q", 403)
  if (!alert.branchId && req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
  return alert
}

// --- Health Scores ---
export async function getHealthScores(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const scores = await getLatestHealthScores(bv)
    res.json(successResponse(scores))
  } catch (err) { next(err) }
}

export async function getVehicleHealthHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    await assertVehicleAccess(req, vehicleId)
    const history = await prisma.vehicleHealthScore.findMany({
      where: { vehicleId },
      orderBy: { calculatedAt: 'desc' },
      take: 30,
    })
    res.json(successResponse(history))
  } catch (err) { next(err) }
}

export async function recalculateHealth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    await assertVehicleAccess(req, vehicleId)
    const result = await calculateHealthScore(vehicleId)
    res.json(successResponse(result, 'Health score hisoblandi'))
  } catch (err) { next(err) }
}

export async function recalculateAllHealth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const vehicles = await prisma.vehicle.findMany({
      where: { status: 'active', ...(bv !== undefined ? { branchId: bv } : {}) },
      select: { id: true },
    })

    // Batch parallel — chunk by 10 to avoid exhausting the DB pool
    const CHUNK = 10
    let done = 0
    for (let i = 0; i < vehicles.length; i += CHUNK) {
      const batch = vehicles.slice(i, i + CHUNK)
      const results = await Promise.allSettled(batch.map(v => calculateHealthScore(v.id)))
      done += results.filter(r => r.status === 'fulfilled').length
    }
    res.json(successResponse({ recalculated: done }, `${done} ta avtomobil hisoblandi`))
  } catch (err) { next(err) }
}

// --- Anomalies ---
export async function getAnomalies(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const { isResolved, vehicleId, type, severity } = req.query

    const where: any = {}
    if (isResolved !== undefined) where.isResolved = isResolved === 'true'
    if (vehicleId) where.vehicleId = vehicleId
    if (type) where.type = type
    if (severity) where.severity = severity
    if (bv !== undefined) where.vehicle = { branchId: bv }

    const [data, total] = await Promise.all([
      prisma.anomaly.findMany({
        where,
        include: { vehicle: { select: { registrationNumber: true, brand: true, model: true, branchId: true } } },
        orderBy: { detectedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.anomaly.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function resolveAnomaly(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await assertAnomalyAccess(req, id)
    const anomaly = await prisma.anomaly.update({
      where: { id },
      data: { isResolved: true, resolvedAt: new Date() },
    })
    res.json(successResponse(anomaly, 'Anomaliya hal qilindi'))
  } catch (err) { next(err) }
}

export async function runAnomalyDetection(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    await assertVehicleAccess(req, vehicleId)
    await detectVehicleAnomalies(vehicleId)
    res.json(successResponse(null, 'Anomaliya tekshiruvi bajarildi'))
  } catch (err) { next(err) }
}

// --- Recommendations ---
export async function getRecommendations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const { type, priority } = req.query

    const where: any = { isDismissed: false, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
    if (type) where.type = type
    if (priority) where.priority = priority
    if (bv !== undefined) {
      where.AND = [{ OR: [{ branchId: bv }, { vehicle: { branchId: bv } }, { vehicleId: null, branchId: null }] }]
    }

    const [data, total] = await Promise.all([
      prisma.recommendation.findMany({
        where,
        include: { vehicle: { select: { registrationNumber: true, brand: true, model: true } } },
        orderBy: [
          { priority: 'asc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      prisma.recommendation.count({ where }),
    ])

    res.json(successResponse(data, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function dismissRecommendation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await assertRecommendationAccess(req, id)
    await prisma.recommendation.update({ where: { id }, data: { isDismissed: true, dismissedAt: new Date() } })
    res.json(successResponse(null, 'Tavsiya bekor qilindi'))
  } catch (err) { next(err) }
}

export async function triggerRecommendations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicleId = req.params.vehicleId as string | undefined
    if (vehicleId) {
      await assertVehicleAccess(req, vehicleId)
    } else if (req.user!.role !== 'super_admin') {
      throw new AppError('Avtomashina tanlash shart', 400)
    }
    await generateRecommendations(vehicleId)
    res.json(successResponse(null, 'Tavsiyalar yangilandi'))
  } catch (err) { next(err) }
}

// --- Predictions ---
export async function getPredictions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    await assertVehicleAccess(req, vehicleId)
    const predictions = await prisma.maintenancePrediction.findMany({
      where: { vehicleId, isAcknowledged: false, predictedDate: { gte: new Date() } },
      orderBy: { predictedDate: 'asc' },
    })
    res.json(successResponse(predictions))
  } catch (err) { next(err) }
}

export async function getAllPredictions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    // Muddati o'tganlarni ham ko'rsatamiz (30 kun oldindan — 30 kun keyin)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    const predictions = await prisma.maintenancePrediction.findMany({
      where: {
        isAcknowledged: false,
        predictedDate: { gte: thirtyDaysAgo, lte: thirtyDaysOut },
        ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}),
      },
      include: { vehicle: { select: { registrationNumber: true, brand: true, model: true } } },
      orderBy: { predictedDate: 'asc' },
    })
    res.json(successResponse(predictions))
  } catch (err) { next(err) }
}

export async function runPrediction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    await assertVehicleAccess(req, vehicleId)
    await predictNextMaintenance(vehicleId)
    res.json(successResponse(null, 'Bashorat yangilandi'))
  } catch (err) { next(err) }
}

export async function acknowledgePrediction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await assertPredictionAccess(req, id)
    await prisma.maintenancePrediction.update({ where: { id }, data: { isAcknowledged: true, acknowledgedAt: new Date() } })
    res.json(successResponse(null, 'Bashorat tasdiqlandi'))
  } catch (err) { next(err) }
}

// --- Fuel Analytics ---
export async function getFuelAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const [trends, topConsumers] = await Promise.all([
      getFleetFuelTrends(bv),
      getTopFuelConsumers(bv, 10),
    ])
    res.json(successResponse({ trends, topConsumers }))
  } catch (err) { next(err) }
}

export async function getVehicleFuelMetrics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
    await assertVehicleAccess(req, vehicleId)
    const { days = '30' } = req.query
    await computeFuelMetrics(vehicleId, parseInt(days as string))
    const metrics = await prisma.fuelConsumptionMetric.findMany({
      where: { vehicleId },
      orderBy: { periodStart: 'desc' },
      take: 12,
    })
    res.json(successResponse(metrics))
  } catch (err) { next(err) }
}

// --- Alerts ---
export async function getAlerts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { isRead, severity } = req.query
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const where: any = {}
    if (isRead !== undefined) where.isRead = isRead === 'true'
    if (severity) where.severity = severity
    if (bv !== undefined) {
      where.OR = [{ userId: req.user!.id }, { branchId: bv }]
    } else {
      where.userId = req.user!.id
    }

    const [data, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: { vehicle: { select: { registrationNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.alert.count({ where }),
    ])

    const unreadCount = await prisma.alert.count({ where: { ...where, isRead: false } })

    res.json(successResponse({ alerts: data, unreadCount }, undefined, { total, page, limit, totalPages: Math.ceil(total / limit) }))
  } catch (err) { next(err) }
}

export async function markAlertRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    if (id === 'all') {
      await prisma.alert.updateMany({
        where: { OR: [{ userId: req.user!.id }, ...(bv !== undefined ? [{ branchId: bv }] : [])], isRead: false },
        data: { isRead: true, readAt: new Date() },
      })
    } else {
      await assertAlertAccess(req, id)
      await prisma.alert.update({ where: { id }, data: { isRead: true, readAt: new Date() } })
    }
    res.json(successResponse(null, 'O\'qildi'))
  } catch (err) { next(err) }
}

// --- Health Trend (last N days) ---
// Fleet avg score + critical/poor count per day. Kunlar ichida bir necha
// hisoblash bo'lsa — so'nggisi olinadi (vehicle bo'yicha latest-per-day).
export async function getHealthTrend(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const days = Math.min(365, Math.max(7, parseInt((req.query.days as string) || '90', 10)))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const scores = await prisma.vehicleHealthScore.findMany({
      where: { calculatedAt: { gte: since }, ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}) },
      select: { vehicleId: true, score: true, grade: true, calculatedAt: true },
      orderBy: { calculatedAt: 'asc' },
    })

    // Day-bucket: kalit YYYY-MM-DD, har vehicle uchun kun ichidagi so'nggi skor.
    const byDay = new Map<string, Map<string, { score: number; grade: string }>>()
    for (const s of scores) {
      const key = s.calculatedAt.toISOString().slice(0, 10)
      if (!byDay.has(key)) byDay.set(key, new Map())
      byDay.get(key)!.set(s.vehicleId, { score: Number(s.score), grade: s.grade })
    }

    const series = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vehMap]) => {
        const vals = Array.from(vehMap.values())
        const avgScore = vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v.score, 0) / vals.length) : 0
        const criticalCount = vals.filter(v => v.grade === 'critical').length
        const poorCount = vals.filter(v => v.grade === 'poor').length
        return { date, avgScore, criticalCount, poorCount, vehicleCount: vals.length }
      })

    res.json(successResponse(series))
  } catch (err) { next(err) }
}

// --- Cost Forecast (6 oy actual + N oy bashorat) ---
// Oddiy linear regression: y = a + b*x, 90% confidence (residuals std * 1.645).
export async function getCostForecast(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const vehicleFilter = bv !== undefined ? { branchId: bv } : {}
    const horizon = Math.min(6, Math.max(1, parseInt((req.query.months as string) || '3', 10)))
    const historyMonths = 6

    const UZ_MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth() - (historyMonths - 1), 1)

    const [expenses, fuelRecords, maintenance] = await Promise.all([
      prisma.expense.findMany({
        where: { expenseDate: { gte: startDate }, vehicle: vehicleFilter, category: { name: { not: 'Texnik xizmat' } } },
        select: { amount: true, expenseDate: true },
      }),
      prisma.fuelRecord.findMany({
        where: { refuelDate: { gte: startDate }, vehicle: vehicleFilter },
        select: { cost: true, refuelDate: true },
      }),
      prisma.maintenanceRecord.findMany({
        where: { installationDate: { gte: startDate }, vehicle: vehicleFilter },
        select: { cost: true, laborCost: true, installationDate: true },
      }),
    ])

    const actuals: { year: number; month: number; label: string; total: number }[] = []
    for (let i = 0; i < historyMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (historyMonths - 1 - i), 1)
      const y = d.getFullYear(), m = d.getMonth()
      const label = `${UZ_MONTHS[m]} '${String(y).slice(2)}`
      const expTotal = expenses.filter(e => { const x = new Date(e.expenseDate); return x.getFullYear() === y && x.getMonth() === m }).reduce((s, e) => s + Number(e.amount), 0)
      const fuelTotal = fuelRecords.filter(f => { const x = new Date(f.refuelDate); return x.getFullYear() === y && x.getMonth() === m }).reduce((s, f) => s + Number(f.cost), 0)
      const maintTotal = maintenance.filter(r => { const x = new Date(r.installationDate); return x.getFullYear() === y && x.getMonth() === m }).reduce((s, r) => s + Number(r.cost) + Number(r.laborCost), 0)
      actuals.push({ year: y, month: m, label, total: expTotal + fuelTotal + maintTotal })
    }

    // Linear regression uchun kamida 3 nuqta kerak, aks holda forecast yo'q.
    const result: { label: string; actual: number | null; forecast: number | null; lowBound: number | null; highBound: number | null }[] =
      actuals.map(a => ({ label: a.label, actual: a.total, forecast: null, lowBound: null, highBound: null }))

    if (actuals.length >= 3) {
      const n = actuals.length
      const xs = actuals.map((_, i) => i)
      const ys = actuals.map(a => a.total)
      const meanX = xs.reduce((s, v) => s + v, 0) / n
      const meanY = ys.reduce((s, v) => s + v, 0) / n
      let num = 0, den = 0
      for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2 }
      const slope = den > 0 ? num / den : 0
      const intercept = meanY - slope * meanX

      // Residual standard deviation — confidence interval uchun.
      let sse = 0
      for (let i = 0; i < n; i++) {
        const pred = intercept + slope * xs[i]
        sse += (ys[i] - pred) ** 2
      }
      const resStd = n > 2 ? Math.sqrt(sse / (n - 2)) : 0
      const z = 1.645 // 90% interval

      // Forecast keyingi `horizon` oy uchun.
      for (let i = 0; i < horizon; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1)
        const label = `${UZ_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
        const x = n + i
        const f = Math.max(0, Math.round(intercept + slope * x))
        const margin = Math.round(z * resStd)
        result.push({
          label,
          actual: null,
          forecast: f,
          lowBound: Math.max(0, f - margin),
          highBound: f + margin,
        })
      }
    }

    res.json(successResponse(result))
  } catch (err) { next(err) }
}

// --- Anomaly Stats (last N days) ---
// Type/severity taqsimoti + open/resolved count + o'rtacha yechish vaqti (kun).
export async function getAnomalyStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const days = Math.min(365, Math.max(1, parseInt((req.query.days as string) || '30', 10)))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const anomalies = await prisma.anomaly.findMany({
      where: { detectedAt: { gte: since }, ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}) },
      select: { type: true, severity: true, isResolved: true, detectedAt: true, resolvedAt: true },
    })

    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    const resolveDays: number[] = []
    let openCount = 0, resolvedCount = 0
    for (const a of anomalies) {
      byType[a.type] = (byType[a.type] || 0) + 1
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1
      if (a.isResolved && a.resolvedAt) {
        resolvedCount++
        resolveDays.push((a.resolvedAt.getTime() - a.detectedAt.getTime()) / (24 * 60 * 60 * 1000))
      } else if (!a.isResolved) {
        openCount++
      }
    }
    // Median yechish vaqti — outlier'larga chidamli.
    let medianResolveDays = 0
    if (resolveDays.length > 0) {
      const sorted = [...resolveDays].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      medianResolveDays = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    res.json(successResponse({
      total: anomalies.length,
      byType,
      bySeverity,
      openCount,
      resolvedCount,
      medianResolveDays: Math.round(medianResolveDays * 10) / 10,
    }))
  } catch (err) { next(err) }
}

// --- Overview Stats ---
export async function getAnalyticsOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const branchWhere = bv !== undefined ? { vehicle: { branchId: bv } } : {}
    const vehicleWhere = bv !== undefined ? { branchId: bv } : {}

    const [
      totalVehicles,
      criticalCount,
      openAnomalies,
      activeRecommendations,
      upcomingPredictions,
    ] = await Promise.all([
      prisma.vehicle.count({ where: { ...vehicleWhere, status: 'active' } }),
      prisma.vehicleHealthScore.count({
        where: { ...branchWhere, grade: { in: ['critical', 'poor'] } },
      }),
      prisma.anomaly.count({ where: { ...branchWhere, isResolved: false } }),
      prisma.recommendation.count({ where: { isDismissed: false, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}) } }),
      prisma.maintenancePrediction.count({
        where: { isAcknowledged: false, predictedDate: { gte: new Date(), lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) }, ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}) },
      }),
    ])

    res.json(successResponse({ totalVehicles, criticalCount, openAnomalies, activeRecommendations, upcomingPredictions }))
  } catch (err) { next(err) }
}
