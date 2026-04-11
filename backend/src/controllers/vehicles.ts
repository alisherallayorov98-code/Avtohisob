import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, status, branchId, fuelType, sortBy, sortDir } = req.query as any

    const where: any = {}
    if (search) where.OR = [
      { registrationNumber: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
      { model: { contains: search, mode: 'insensitive' } },
    ]
    if (status) where.status = status
    if (fuelType) where.fuelType = fuelType
    if (branchId && ['super_admin', 'manager'].includes(req.user!.role)) where.branchId = branchId
    else if (req.user!.branchId && ['admin', 'branch_manager', 'operator'].includes(req.user!.role)) {
      where.branchId = req.user!.branchId
    }

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
    res.json(successResponse(vehicle))
  } catch (err) { next(err) }
}

export async function createVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { registrationNumber, model, brand, year, fuelType, branchId, purchaseDate, mileage, status, notes } = req.body
    const vehicle = await prisma.vehicle.create({
      data: { registrationNumber, model, brand, year: parseInt(year), fuelType, branchId, purchaseDate: new Date(purchaseDate), mileage: parseFloat(mileage || '0'), status: status || 'active', notes },
      include: { branch: { select: { id: true, name: true } } },
    })
    res.status(201).json(successResponse(vehicle, 'Avtomashina qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { registrationNumber, model, brand, year, fuelType, branchId, purchaseDate, mileage, status, notes } = req.body
    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: {
        ...(registrationNumber && { registrationNumber }),
        ...(model && { model }),
        ...(brand && { brand }),
        ...(year && { year: parseInt(year) }),
        ...(fuelType && { fuelType }),
        ...(branchId && { branchId }),
        ...(purchaseDate && { purchaseDate: new Date(purchaseDate) }),
        ...(mileage !== undefined && { mileage: parseFloat(mileage) }),
        ...(status && { status }),
        notes,
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
    await prisma.vehicle.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'Avtomashina o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getVehicleHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
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
    const expenses = await prisma.expense.findMany({
      where: { vehicleId: req.params.id },
      include: { category: true, createdBy: { select: { fullName: true } } },
      orderBy: { expenseDate: 'desc' },
    })
    res.json(successResponse(expenses))
  } catch (err) { next(err) }
}
