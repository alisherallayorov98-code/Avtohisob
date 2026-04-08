import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getBranches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { isActive } = req.query as any
    const where: any = {}
    if (isActive !== undefined) where.isActive = isActive === 'true'
    const branches = await prisma.branch.findMany({
      where,
      include: {
        manager: { select: { id: true, fullName: true, email: true } },
        _count: { select: { vehicles: true, users: true } },
      },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: branches })
  } catch (err) { next(err) }
}

export async function getBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, fullName: true, email: true } },
        users: { select: { id: true, fullName: true, role: true, isActive: true } },
        vehicles: { select: { id: true, registrationNumber: true, brand: true, model: true, status: true } },
      },
    })
    if (!branch) throw new AppError('Filial topilmadi', 404)
    res.json(successResponse(branch))
  } catch (err) { next(err) }
}

export async function createBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, managerId, warehouseCapacity, contactPhone } = req.body
    const branch = await prisma.branch.create({
      data: { name, location, managerId: managerId || null, warehouseCapacity: parseFloat(warehouseCapacity || '0'), contactPhone },
      include: { manager: { select: { id: true, fullName: true } } },
    })
    res.status(201).json(successResponse(branch, 'Filial qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, managerId, warehouseCapacity, contactPhone, isActive } = req.body
    const branch = await prisma.branch.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }), ...(location && { location }),
        ...(managerId !== undefined && { managerId: managerId || null }),
        ...(warehouseCapacity !== undefined && { warehouseCapacity: parseFloat(warehouseCapacity) }),
        ...(contactPhone && { contactPhone }),
        ...(isActive !== undefined && { isActive: isActive === true || isActive === 'true' }),
      },
      include: { manager: { select: { id: true, fullName: true } } },
    })
    res.json(successResponse(branch, 'Filial yangilandi'))
  } catch (err) { next(err) }
}

export async function getBranchStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const [vehicleCount, inventoryItems, totalExpenses, fuelCost] = await Promise.all([
      prisma.vehicle.count({ where: { branchId: id, status: 'active' } }),
      prisma.inventory.findMany({ where: { branchId: id }, include: { sparePart: { select: { unitPrice: true } } } }),
      prisma.expense.aggregate({ where: { vehicle: { branchId: id } }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { vehicle: { branchId: id } }, _sum: { cost: true } }),
    ])
    const totalInventoryValue = inventoryItems.reduce((s: number, i: any) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0)
    res.json(successResponse({
      activeVehicles: vehicleCount,
      totalInventoryValue,
      totalExpenses: Number(totalExpenses._sum.amount) || 0,
      totalFuelCost: Number(fuelCost._sum.cost) || 0,
    }))
  } catch (err) { next(err) }
}
