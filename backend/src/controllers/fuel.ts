import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse, paginatedResponse, buildDateRangeFilter } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'
import { checkFuelConsumptionAnomaly } from '../lib/smartAlerts'

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * GET /fuel-records/norm-analysis?from&to&branchId
 * Har mashina uchun norma (L/100km) bilan haqiqiy sarfni taqqoslaydi.
 * Haqiqiy sarf: fill-to-fill usuli (birinchi quyilgan litrsiz) / probeg.
 */
export async function getFuelNormAnalysis(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const vehWhere: any = {}
    if (filterVal !== undefined) vehWhere.branchId = filterVal
    else if (branchId) vehWhere.branchId = branchId

    const toDate = to ? new Date(to) : new Date()
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 90 * 24 * 3600 * 1000)

    const vehicles = await prisma.vehicle.findMany({
      where: vehWhere,
      select: { id: true, registrationNumber: true, brand: true, model: true, fuelNormPer100km: true, fuelType: true },
      orderBy: { registrationNumber: 'asc' },
    })
    const vehicleIds = vehicles.map((v) => v.id)

    const records = await prisma.fuelRecord.findMany({
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: fromDate, lte: toDate } },
      select: { vehicleId: true, amountLiters: true, cost: true, odometerReading: true, refuelDate: true },
      orderBy: [{ vehicleId: 'asc' }, { refuelDate: 'asc' }],
    })

    const byV = new Map<string, typeof records>()
    for (const r of records) {
      const arr = byV.get(r.vehicleId) || []
      arr.push(r)
      byV.set(r.vehicleId, arr)
    }

    const rows = vehicles.map((v) => {
      const recs = byV.get(v.id) || []
      const norm = v.fuelNormPer100km != null ? Number(v.fuelNormPer100km) : null
      const base = {
        vehicleId: v.id, registrationNumber: v.registrationNumber, brand: v.brand, model: v.model,
        fuelType: v.fuelType, norm, refuelCount: recs.length,
      }
      if (recs.length < 2) return { ...base, status: 'no_data' as const }

      const odos = recs.map((r) => Number(r.odometerReading)).filter((o) => o > 0)
      const km = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : 0
      const totalLiters = recs.reduce((s, r) => s + Number(r.amountLiters), 0)
      const totalCost = recs.reduce((s, r) => s + Number(r.cost), 0)
      const consumedLiters = totalLiters - Number(recs[0].amountLiters) // fill-to-fill
      if (km <= 0 || consumedLiters <= 0) return { ...base, status: 'no_data' as const }

      const actual = (consumedLiters / km) * 100
      const avgPrice = totalLiters > 0 ? totalCost / totalLiters : 0
      let expectedLiters: number | null = null
      let excessLiters: number | null = null
      let excessCost: number | null = null
      let status: 'over' | 'ok' | 'under' | 'no_norm' = 'no_norm'
      if (norm != null && norm > 0) {
        expectedLiters = (km / 100) * norm
        excessLiters = consumedLiters - expectedLiters
        excessCost = excessLiters * avgPrice
        status = actual > norm * 1.05 ? 'over' : actual < norm * 0.95 ? 'under' : 'ok'
      }
      return {
        ...base, status, actual: round1(actual), km: Math.round(km),
        consumedLiters: round1(consumedLiters), avgPrice: Math.round(avgPrice),
        expectedLiters: expectedLiters != null ? round1(expectedLiters) : null,
        excessLiters: excessLiters != null ? round1(excessLiters) : null,
        excessCost: excessCost != null ? Math.round(excessCost) : null,
      }
    })

    rows.sort((a, b) => {
      const av = a.status === 'over' ? ((a as any).excessCost || 0) : -1
      const bv = b.status === 'over' ? ((b as any).excessCost || 0) : -1
      return bv - av
    })

    const overCount = rows.filter((r) => r.status === 'over').length
    const totalExcessCost = rows.reduce((s, r) => s + (r.status === 'over' ? ((r as any).excessCost || 0) : 0), 0)
    const noNormCount = rows.filter((r) => r.status === 'no_norm').length

    res.json(successResponse({
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      rows,
      summary: { total: rows.length, overCount, totalExcessCost, noNormCount },
    }))
  } catch (err) { next(err) }
}

/**
 * GET /fuel-records/tank-balance?branchId
 * Har mashina uchun: oxirgi quyilishdan keyin taxminiy qoldiq + "qachon tugaydi"
 */
export async function getFuelTankBalance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const vehWhere: any = { status: 'active' }
    if (filterVal !== undefined) vehWhere.branchId = filterVal
    else if (branchId) vehWhere.branchId = branchId

    const vehicles = await prisma.vehicle.findMany({
      where: vehWhere,
      select: {
        id: true, registrationNumber: true, brand: true, model: true,
        mileage: true, fuelNormPer100km: true, tankCapacity: true, fuelType: true,
      },
      orderBy: { registrationNumber: 'asc' },
    })

    const vehicleIds = vehicles.map((v) => v.id)
    const allRecs = await prisma.fuelRecord.findMany({
      where: { vehicleId: { in: vehicleIds } },
      select: { vehicleId: true, amountLiters: true, odometerReading: true, refuelDate: true },
      orderBy: [{ vehicleId: 'asc' }, { refuelDate: 'asc' }],
    })

    const byV = new Map<string, typeof allRecs>()
    for (const r of allRecs) {
      const arr = byV.get(r.vehicleId) || []
      arr.push(r)
      byV.set(r.vehicleId, arr)
    }

    const now = Date.now()
    const rows = vehicles.map((v) => {
      const recs = byV.get(v.id) || []
      const base = {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        brand: v.brand,
        model: v.model,
        fuelType: v.fuelType,
        tankCapacity: v.tankCapacity,
        currentMileage: Number(v.mileage),
      }
      if (recs.length === 0) return { ...base, status: 'no_data' as const, warningLevel: 'unknown' as const }

      const lastRec = recs[recs.length - 1]

      // Consumption rate: norm > avg fill-to-fill
      let rate: number | null = v.fuelNormPer100km != null ? Number(v.fuelNormPer100km) : null
      if (rate == null && recs.length >= 2) {
        const totalKm = Number(recs[recs.length - 1].odometerReading) - Number(recs[0].odometerReading)
        const consumedL = recs.slice(1).reduce((s, r) => s + Number(r.amountLiters), 0)
        if (totalKm > 0 && consumedL > 0) rate = round1((consumedL / totalKm) * 100)
      }

      const kmSince = Math.max(0, Number(v.mileage) - Number(lastRec.odometerReading))
      const estimatedConsumed = rate != null ? round1((kmSince * rate) / 100) : null
      const estimatedRemaining = estimatedConsumed != null
        ? Math.max(0, round1(Number(lastRec.amountLiters) - estimatedConsumed))
        : null

      const daysSince = (now - new Date(lastRec.refuelDate).getTime()) / (1000 * 86400)
      const avgDailyKm = daysSince > 0.5 && kmSince > 0 ? round1(kmSince / daysSince) : null

      const daysToEmpty =
        rate != null && estimatedRemaining != null && avgDailyKm != null && avgDailyKm > 0
          ? Math.round(estimatedRemaining / ((avgDailyKm * rate) / 100))
          : null

      let fillPercent: number | null = null
      let warningLevel: 'ok' | 'low' | 'critical' | 'unknown' = 'unknown'
      if (estimatedRemaining != null) {
        if (v.tankCapacity) {
          fillPercent = Math.min(100, Math.max(0, Math.round((estimatedRemaining / v.tankCapacity) * 100)))
          warningLevel = fillPercent < 10 ? 'critical' : fillPercent < 25 ? 'low' : 'ok'
        } else {
          const frac = Number(lastRec.amountLiters) > 0 ? estimatedRemaining / Number(lastRec.amountLiters) : 0
          warningLevel = frac < 0.15 ? 'critical' : frac < 0.3 ? 'low' : 'ok'
        }
      }

      return {
        ...base,
        status: 'ok' as const,
        lastRefuelDate: lastRec.refuelDate,
        lastRefuelLiters: round1(Number(lastRec.amountLiters)),
        lastRefuelOdometer: Number(lastRec.odometerReading),
        kmSince,
        rate,
        estimatedConsumed,
        estimatedRemaining,
        fillPercent,
        daysToEmpty,
        warningLevel,
      }
    })

    const criticalCount = rows.filter((r) => r.warningLevel === 'critical').length
    const lowCount = rows.filter((r) => r.warningLevel === 'low').length

    res.json(successResponse({ rows, summary: { total: rows.length, criticalCount, lowCount } }))
  } catch (err) { next(err) }
}

export async function getFuelRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, fuelType, from, to, branchId } = req.query as any

    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (fuelType) where.fuelType = fuelType
    const dateRange = buildDateRangeFilter(from, to)
    if (dateRange) where.refuelDate = dateRange
    if (filterVal !== undefined) where.vehicle = { branchId: filterVal }
    else if (branchId) where.vehicle = { branchId }

    const [total, records] = await Promise.all([
      prisma.fuelRecord.count({ where }),
      prisma.fuelRecord.findMany({
        where, skip, take: limit,
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { refuelDate: 'desc' },
      }),
    ])

    res.json(paginatedResponse(records, total, page, limit))
  } catch (err) { next(err) }
}

export async function getFuelRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.fuelRecord.findUnique({
      where: { id: req.params.id },
      include: { vehicle: true, supplier: true, createdBy: { select: { fullName: true } }, meterReadings: true },
    })
    if (!record) throw new AppError('Yoqilg\'i rekord topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }
    res.json(successResponse(record))
  } catch (err) { next(err) }
}

export async function createFuelRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, fuelType, amountLiters, cost, odometerReading, refuelDate, supplierId, aiExtractedData } = req.body

    if (parseFloat(amountLiters) <= 0) throw new AppError('Miqdor 0 dan katta bo\'lishi kerak', 400)
    if (parseFloat(cost) < 0) throw new AppError('Narx manfiy bo\'lmasligi kerak', 400)
    if (parseFloat(odometerReading) < 0) throw new AppError('Odometr manfiy bo\'lmasligi kerak', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const createFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(createFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomashina sizning tashkilotingizda emas', 403)
    }
    if (vehicle.status === 'inactive') throw new AppError('Avtomashina nofaol', 400)
    if (fuelType && vehicle.fuelType !== fuelType)
      throw new AppError(`Bu mashina ${vehicle.fuelType} turida ishlaydi, ${fuelType} emas`, 400)

    const lastFuel = await prisma.fuelRecord.findFirst({
      where: { vehicleId }, orderBy: { odometerReading: 'desc' },
    })
    if (lastFuel && parseFloat(odometerReading) <= Number(lastFuel.odometerReading)) {
      throw new AppError(`Odometr ko'rsatkichi oxirgi yozuvdan (${lastFuel.odometerReading} km) katta bo'lishi kerak`, 400)
    }

    const receiptImageUrl = req.file ? `/uploads/${req.file.filename}` : undefined

    const record = await prisma.fuelRecord.create({
      data: {
        vehicleId, fuelType, amountLiters: parseFloat(amountLiters), cost: parseFloat(cost),
        odometerReading: parseFloat(odometerReading), refuelDate: new Date(refuelDate),
        supplierId: supplierId || null, receiptImageUrl, aiExtractedData: aiExtractedData || null,
        createdById: req.user!.id,
      },
      include: { vehicle: true, supplier: true },
    })

    await prisma.vehicle.update({ where: { id: vehicleId }, data: { mileage: parseFloat(odometerReading) } })

    // #1 + #7: Yoqilg'i sarfi anomaliyasi — non-blocking
    checkFuelConsumptionAnomaly(
      vehicleId,
      vehicle.branchId,
      parseFloat(amountLiters),
      parseFloat(odometerReading),
      lastFuel ? Number(lastFuel.odometerReading) : null
    ).catch(() => {})

    res.status(201).json(successResponse(record, 'Yoqilg\'i to\'ldirish qayd etildi'))
  } catch (err) { next(err) }
}

export async function updateFuelRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { cost, amountLiters } = req.body
    if (cost !== undefined && parseFloat(cost) < 0) throw new AppError('Narx manfiy bo\'lmasligi kerak', 400)
    if (amountLiters !== undefined && parseFloat(amountLiters) <= 0) throw new AppError('Miqdor 0 dan katta bo\'lishi kerak', 400)
    const existing = await prisma.fuelRecord.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Yoqilg\'i rekord topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, existing.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }
    const record = await prisma.fuelRecord.update({
      where: { id: req.params.id },
      data: {
        ...(cost !== undefined && { cost: parseFloat(cost) }),
        ...(amountLiters !== undefined && { amountLiters: parseFloat(amountLiters) }),
      },
      include: { vehicle: true },
    })
    res.json(successResponse(record, 'Yoqilg\'i rekord yangilandi'))
  } catch (err) { next(err) }
}

export async function getVehicleFuelRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }
    const records = await prisma.fuelRecord.findMany({
      where: { vehicleId: req.params.id },
      include: { supplier: true },
      orderBy: { refuelDate: 'desc' },
    })

    const totalLiters = records.reduce((s, r) => s + Number(r.amountLiters), 0)
    const totalCost = records.reduce((s, r) => s + Number(r.cost), 0)

    let avgConsumption = 0
    if (records.length >= 2) {
      // Exclude the oldest fill-up from liters (we don't know what was before that baseline)
      const oldestRecord = records[records.length - 1]
      const totalKm = Number(records[0].odometerReading) - Number(oldestRecord.odometerReading)
      const litersConsumed = totalLiters - Number(oldestRecord.amountLiters)
      avgConsumption = totalKm > 0 && litersConsumed > 0 ? litersConsumed / totalKm * 100 : 0
    }

    res.json(successResponse({ records, stats: { totalLiters, totalCost, avgConsumption: avgConsumption.toFixed(2) } }))
  } catch (err) { next(err) }
}

export async function deleteFuelRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.fuelRecord.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Yozuv topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    await prisma.$transaction(async (tx) => {
      await tx.fuelRecord.delete({ where: { id: req.params.id } })
      const prevRecord = await tx.fuelRecord.findFirst({
        where: { vehicleId: record.vehicleId },
        orderBy: { odometerReading: 'desc' },
      })
      await tx.vehicle.update({
        where: { id: record.vehicleId },
        data: { mileage: prevRecord ? Number(prevRecord.odometerReading) : 0 },
      })
    })

    res.json(successResponse(null, 'Yoqilg\'i yozuvi o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getFuelRecord_stats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, vehicleId, fuelType, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (fuelType) where.fuelType = fuelType
    if (from || to) where.refuelDate = (() => {
        const gte = from ? new Date(from) : undefined
        const lte = to   ? new Date(to)   : undefined
        return { ...(gte && !isNaN(gte.getTime()) && { gte }), ...(lte && !isNaN(lte.getTime()) && { lte }) }
      })()
    if (filterVal !== undefined) where.vehicle = { branchId: filterVal }
    else if (branchId) where.vehicle = { branchId }

    const agg = await prisma.fuelRecord.aggregate({
      where,
      _sum: { amountLiters: true, cost: true },
      _count: { id: true },
    })

    const totalLiters = Number(agg._sum.amountLiters) || 0
    const totalCost = Number(agg._sum.cost) || 0

    res.json(successResponse({
      totalLiters,
      totalCost,
      count: agg._count.id,
      avgCostPerLiter: totalLiters > 0 ? Math.round(totalCost / totalLiters) : 0,
    }))
  } catch (err) { next(err) }
}

export async function getFuelReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)
    const where: any = {}
    if (from || to) where.refuelDate = (() => {
        const gte = from ? new Date(from) : undefined
        const lte = to   ? new Date(to)   : undefined
        return { ...(gte && !isNaN(gte.getTime()) && { gte }), ...(lte && !isNaN(lte.getTime()) && { lte }) }
      })()
    if (filterVal !== undefined) where.vehicle = { branchId: filterVal }
    else if (branchId) where.vehicle = { branchId }

    const records = await prisma.fuelRecord.findMany({ where, include: { vehicle: true } })
    const byFuelType = records.reduce((acc: any, r) => {
      acc[r.fuelType] = (acc[r.fuelType] || 0) + Number(r.cost)
      return acc
    }, {})

    res.json(successResponse({
      totalRecords: records.length,
      totalLiters: records.reduce((s, r) => s + Number(r.amountLiters), 0),
      totalCost: records.reduce((s, r) => s + Number(r.cost), 0),
      byFuelType,
    }))
  } catch (err) { next(err) }
}
