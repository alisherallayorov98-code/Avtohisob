import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getWarehouses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const warehouses = await prisma.warehouse.findMany({
      include: {
        branches: { select: { id: true, name: true } },
        _count: { select: { inventory: true } },
      },
      orderBy: { name: 'asc' },
    })
    res.json(successResponse(warehouses))
  } catch (err) { next(err) }
}

export async function getWarehouse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
      include: {
        branches: { select: { id: true, name: true, location: true } },
        inventory: {
          include: { sparePart: { select: { name: true, partCode: true, category: true, unitPrice: true } } },
          orderBy: { sparePart: { name: 'asc' } },
        },
      },
    })
    if (!warehouse) throw new AppError('Sklad topilmadi', 404)
    res.json(successResponse(warehouse))
  } catch (err) { next(err) }
}

export async function createWarehouse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location } = req.body
    if (!name?.trim()) throw new AppError('Sklad nomi kiritilishi shart', 400)
    const warehouse = await prisma.warehouse.create({
      data: { name: name.trim(), location: location?.trim() || null },
    })
    res.status(201).json(successResponse(warehouse, 'Sklad qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateWarehouse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, isActive } = req.body
    const warehouse = await prisma.warehouse.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name: name.trim() }),
        ...(location !== undefined && { location: location?.trim() || null }),
        ...(isActive !== undefined && { isActive: isActive === true || isActive === 'true' }),
      },
      include: { branches: { select: { id: true, name: true } } },
    })
    res.json(successResponse(warehouse, 'Sklad yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteWarehouse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { branches: true, inventory: true } },
      },
    })
    if (!warehouse) throw new AppError('Sklad topilmadi', 404)
    if (warehouse._count.branches > 0)
      throw new AppError(`Bu skladga ${warehouse._count.branches} ta guruh biriktirilgan. Avval ularni boshqa skladga o'tkazing.`, 400)
    if (warehouse._count.inventory > 0)
      throw new AppError(`Skladda ${warehouse._count.inventory} ta ehtiyot qism bor. Avval inventarni tozalang.`, 400)
    await prisma.warehouse.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'Sklad o\'chirildi'))
  } catch (err) { next(err) }
}
