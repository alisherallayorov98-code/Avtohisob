import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse, paginate } from '../types'
import { calculateHealthScore, getLatestHealthScores } from '../services/healthScoreService'
import { detectVehicleAnomalies } from '../services/anomalyDetectionService'
import { generateRecommendations } from '../services/recommendationsEngine'
import { predictNextMaintenance } from '../services/forecastingService'
import { computeFuelMetrics, getFleetFuelTrends, getTopFuelConsumers } from '../services/fuelAnalyticsService'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

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
    await prisma.recommendation.update({ where: { id }, data: { isDismissed: true, dismissedAt: new Date() } })
    res.json(successResponse(null, 'Tavsiya bekor qilindi'))
  } catch (err) { next(err) }
}

export async function triggerRecommendations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicleId = req.params.vehicleId as string | undefined
    await generateRecommendations(vehicleId)
    res.json(successResponse(null, 'Tavsiyalar yangilandi'))
  } catch (err) { next(err) }
}

// --- Predictions ---
export async function getPredictions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.params
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
    await predictNextMaintenance(vehicleId)
    res.json(successResponse(null, 'Bashorat yangilandi'))
  } catch (err) { next(err) }
}

export async function acknowledgePrediction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
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
      await prisma.alert.update({ where: { id }, data: { isRead: true, readAt: new Date() } })
    }
    res.json(successResponse(null, 'O\'qildi'))
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
