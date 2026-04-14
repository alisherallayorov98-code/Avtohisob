import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getFuelRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, fuelType, from, to, branchId } = req.query as any

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

    res.json({ success: true, data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
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

    res.status(201).json(successResponse(record, 'Yoqilg\'i to\'ldirish qayd etildi'))
  } catch (err) { next(err) }
}

export async function updateFuelRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { notes, cost, amountLiters } = req.body
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
    const record = await prisma.fuelRecord.findUnique({ where: { id: req.params.id } })
    if (!record) throw new AppError('Yozuv topilmadi', 404)

    await prisma.fuelRecord.delete({ where: { id: req.params.id } })

    // O'chirilgan yozuvdan oldingi yozuv bo'yicha vehicle.mileage ni tiklash
    const prevRecord = await prisma.fuelRecord.findFirst({
      where: { vehicleId: record.vehicleId },
      orderBy: { odometerReading: 'desc' },
    })
    await prisma.vehicle.update({
      where: { id: record.vehicleId },
      data: { mileage: prevRecord ? Number(prevRecord.odometerReading) : 0 },
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
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId
    const where: any = {}
    if (from || to) where.refuelDate = (() => {
        const gte = from ? new Date(from) : undefined
        const lte = to   ? new Date(to)   : undefined
        return { ...(gte && !isNaN(gte.getTime()) && { gte }), ...(lte && !isNaN(lte.getTime()) && { lte }) }
      })()
    if (effectiveBranchId) where.vehicle = { branchId: effectiveBranchId }

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
