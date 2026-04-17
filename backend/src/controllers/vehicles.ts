import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'
import { getOrgFilter, applyBranchFilter, applyNarrowedBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, status, branchId, fuelType, sortBy, sortDir } = req.query as any

    const filter = await getOrgFilter(req.user!)
    const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)

    const where: any = {}
    if (search) {
      const variants = getSearchVariants(search)
      where.OR = variants.flatMap(v => [
        { registrationNumber: { contains: v, mode: 'insensitive' } },
        { brand: { contains: v, mode: 'insensitive' } },
        { model: { contains: v, mode: 'insensitive' } },
      ])
    }
    if (status) where.status = status
    if (fuelType) where.fuelType = fuelType
    if (narrowed !== undefined) where.branchId = narrowed

    const [total, vehicles] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.vehicle.findMany({
        where, skip, take: limit,
        include: { branch: { select: { id: true, name: true } } },
        orderBy: sortBy && ['registrationNumber', 'brand', 'mileage', 'year', 'createdAt'].includes(sortBy)
          ? { [sortBy]: (sortDir === 'asc' ? 'asc' : 'desc') }
          : { createdAt: 'desc' },
      }),
    ])

    res.json({ success: true, data: vehicles, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

/** GET /api/vehicles/stats — filial bo'yicha status soni (bitta groupBy so'rovi) */
export async function getVehicleStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)

    const where: any = {}
    if (narrowed !== undefined) where.branchId = narrowed

    const grouped = await prisma.vehicle.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })

    const stats = { total: 0, active: 0, maintenance: 0, inactive: 0 }
    for (const g of grouped) {
      const count = g._count._all
      stats.total += count
      if (g.status === 'active') stats.active = count
      else if (g.status === 'maintenance') stats.maintenance = count
      else if (g.status === 'inactive') stats.inactive = count
    }
    res.json({ success: true, data: stats })
  } catch (err) { next(err) }
}

export async function getVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: {
        branch: { select: { id: true, name: true } },
        maintenanceRecords: {
          include: { sparePart: true, supplier: true, performedBy: { select: { fullName: true } } },
          orderBy: { installationDate: 'desc' }, take: 20,
        },
        fuelRecords: { orderBy: { refuelDate: 'desc' }, take: 20 },
        expenses: { include: { category: true }, orderBy: { expenseDate: 'desc' }, take: 20 },
      },
    })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }
    res.json(successResponse(vehicle))
  } catch (err) { next(err) }
}

export async function createVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { registrationNumber, model, brand, year, fuelType, branchId, purchaseDate, mileage, status, notes, insuranceExpiry, techInspectionExpiry } = req.body

    if (!registrationNumber?.trim()) throw new AppError('Davlat raqami kiritilmagan', 400)
    if (!brand?.trim()) throw new AppError('Brend kiritilmagan', 400)
    if (!model?.trim()) throw new AppError('Model kiritilmagan', 400)
    if (!branchId) throw new AppError('Filial tanlanmagan', 400)

    const createFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(createFilter, branchId)) {
      throw new AppError('Bu filialga avtomobil qo\'sha olmaysiz', 403)
    }

    const yearNum = parseInt(year)
    const maxYear = new Date().getFullYear() + 1
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > maxYear)
      throw new AppError('Yil noto\'g\'ri (1900–' + maxYear + ')', 400)

    const validFuelTypes = ['petrol', 'diesel', 'gas', 'electric', 'hybrid']
    if (fuelType && !validFuelTypes.includes(fuelType))
      throw new AppError('Yoqilg\'i turi noto\'g\'ri', 400)

    const mileageNum = parseFloat(mileage || '0')
    if (isNaN(mileageNum) || mileageNum < 0) throw new AppError('Probeg manfiy bo\'lmasligi kerak', 400)

    const vehicle = await prisma.vehicle.create({
      data: {
        registrationNumber, model, brand, year: yearNum, fuelType, branchId,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
        mileage: mileageNum, status: status || 'active', notes,
        insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : null,
        techInspectionExpiry: techInspectionExpiry ? new Date(techInspectionExpiry) : null,
      },
      include: { branch: { select: { id: true, name: true } } },
    })
    res.status(201).json(successResponse(vehicle, 'Avtomashina qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { registrationNumber, model, brand, year, fuelType, branchId, purchaseDate, mileage, status, notes, insuranceExpiry, techInspectionExpiry } = req.body

    const existing = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { branchId: true } })
    if (!existing) throw new AppError('Avtomashina topilmadi', 404)
    const updateFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(updateFilter, existing.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }
    if (branchId && branchId !== existing.branchId && !isBranchAllowed(updateFilter, branchId)) {
      throw new AppError('Bu filialga ko\'chira olmaysiz', 403)
    }

    const yearNum = year !== undefined ? parseInt(year) : undefined
    if (yearNum !== undefined && (isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 1))
      throw new AppError('Yil noto\'g\'ri', 400)

    const validFuelTypes = ['petrol', 'diesel', 'gas', 'electric', 'hybrid']
    if (fuelType && !validFuelTypes.includes(fuelType))
      throw new AppError('Yoqilg\'i turi noto\'g\'ri', 400)

    const mileageNum = mileage !== undefined ? parseFloat(mileage) : undefined
    if (mileageNum !== undefined && (isNaN(mileageNum) || mileageNum < 0))
      throw new AppError('Probeg manfiy bo\'lmasligi kerak', 400)

    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: {
        ...(registrationNumber && { registrationNumber }),
        ...(model && { model }),
        ...(brand && { brand }),
        ...(yearNum !== undefined && { year: yearNum }),
        ...(fuelType && { fuelType }),
        ...(branchId && { branchId }),
        ...(purchaseDate && { purchaseDate: new Date(purchaseDate) }),
        ...(mileageNum !== undefined && { mileage: mileageNum }),
        ...(status && { status }),
        notes,
        ...(insuranceExpiry !== undefined && { insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : null }),
        ...(techInspectionExpiry !== undefined && { techInspectionExpiry: techInspectionExpiry ? new Date(techInspectionExpiry) : null }),
      },
      include: { branch: { select: { id: true, name: true } } },
    })
    res.json(successResponse(vehicle, 'Avtomashina yangilandi'))
  } catch (err) { next(err) }
}

export async function transferVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { toBranchId } = req.body
    if (!toBranchId) throw new AppError('Yangi filial talab qilinadi', 400)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: { branch: { select: { id: true, name: true } } },
    })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)

    // Verify both source and destination belong to the same org
    const transferFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(transferFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }
    if (!isBranchAllowed(transferFilter, toBranchId)) {
      throw new AppError('Maqsad filial sizning tashkilotingizga tegishli emas', 403)
    }

    if (vehicle.branchId === toBranchId) throw new AppError('Mashina allaqachon bu filialda', 400)

    const updated = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: { branchId: toBranchId },
      include: { branch: { select: { id: true, name: true } } },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'TRANSFER',
        entityType: 'Vehicle',
        entityId: vehicle.id,
        newData: { from: vehicle.branch.name, to: updated.branch.name, registrationNumber: vehicle.registrationNumber },
      },
    }).catch(() => {})

    res.json(successResponse(updated, `Avtomashina ko'chirildi: ${updated.branch.name}`))
  } catch (err) { next(err) }
}

export async function deleteVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { registrationNumber: true, brand: true, model: true, branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const deleteFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(deleteFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }

    await prisma.$transaction([
      // Analytics / AI data (vehicleId required)
      prisma.vehicleHealthScore.deleteMany({ where: { vehicleId: id } }),
      prisma.fuelConsumptionMetric.deleteMany({ where: { vehicleId: id } }),
      prisma.maintenancePrediction.deleteMany({ where: { vehicleId: id } }),
      prisma.anomaly.deleteMany({ where: { vehicleId: id } }),
      prisma.alert.deleteMany({ where: { vehicleId: id } }),
      prisma.recommendation.deleteMany({ where: { vehicleId: id } }),
      // Optional vehicleId relations → null (keep the records themselves)
      prisma.tire.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } }),
      prisma.tireEvent.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } }),
      prisma.tireDeduction.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } }),
      prisma.warranty.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } }),
      prisma.fuelImportRow.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } }),
      // Required vehicleId relations → delete
      prisma.waybill.deleteMany({ where: { vehicleId: id } }),
      prisma.maintenanceRecord.deleteMany({ where: { vehicleId: id } }),
      prisma.fuelRecord.deleteMany({ where: { vehicleId: id } }),
      prisma.expense.deleteMany({ where: { vehicleId: id } }),
      // Finally delete the vehicle (ServiceInterval + ServiceRecord cascade automatically)
      prisma.vehicle.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          userId: req.user!.id, action: 'DELETE', entityType: 'Vehicle', entityId: id,
          oldData: { registrationNumber: vehicle.registrationNumber, brand: vehicle.brand, model: vehicle.model },
        },
      }),
    ])
    res.json(successResponse(null, 'Avtomashina o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getVehicleHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const histFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(histFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }
    const [maintenance, fuel] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where: { vehicleId: req.params.id },
        include: { sparePart: true, performedBy: { select: { fullName: true } } },
        orderBy: { installationDate: 'desc' },
      }),
      prisma.fuelRecord.findMany({
        where: { vehicleId: req.params.id },
        orderBy: { refuelDate: 'desc' },
      }),
    ])
    res.json(successResponse({ maintenance, fuel }))
  } catch (err) { next(err) }
}

export async function getVehicleExpenses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const expFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(expFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga kirish huquqingiz yo\'q', 403)
    }
    const expenses = await prisma.expense.findMany({
      where: { vehicleId: req.params.id },
      include: { category: true, createdBy: { select: { fullName: true } } },
      orderBy: { expenseDate: 'desc' },
    })
    res.json(successResponse(expenses))
  } catch (err) { next(err) }
}


export async function getVehicleGpsHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, vehicle.branchId)) throw new AppError('Kirish taqiqlangan', 403)

    const logs = await (prisma as any).gpsMileageLog.findMany({
      where: { vehicleId: req.params.id },
      orderBy: { syncedAt: 'desc' },
      take: 30,
    })
    res.json(successResponse(logs))
  } catch (err) { next(err) }
}
