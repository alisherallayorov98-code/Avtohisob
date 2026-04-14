import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getWarehouses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const where: any = {}

    // branch_manager / operator — faqat o'z filialining omborini ko'radi
    if (['branch_manager', 'operator'].includes(req.user!.role) && req.user!.branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: req.user!.branchId },
        select: { warehouseId: true },
      })
      if (branch?.warehouseId) {
        where.id = branch.warehouseId
      } else {
        // branchga sklad biriktirilmagan — bo'sh qaytarish
        return res.json(successResponse([]))
      }
    }

    const warehouses = await prisma.warehouse.findMany({
      where,
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
    // branch_manager / operator — faqat o'z filiali ombori
    if (['branch_manager', 'operator'].includes(req.user!.role) && req.user!.branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: req.user!.branchId }, select: { warehouseId: true } })
      if (branch?.warehouseId !== warehouse.id) throw new AppError('Bu sklad sizga ruxsat etilmagan', 403)
    }
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
        branches: { select: { id: true, name: true } },
        _count: { select: { inventory: true } },
      },
    })
    if (!warehouse) throw new AppError('Sklad topilmadi', 404)
    if (warehouse.branches.length > 0) {
      const names = warehouse.branches.map(b => b.name).join(', ')
      return res.status(400).json({
        success: false,
        error: `Bu sklad quyidagi guruhlarga biriktirilgan: ${names}. Avval ularni boshqa skladga o'tkazing.`,
        details: { type: 'BRANCHES_LINKED', branches: warehouse.branches },
      })
    }
    if (warehouse._count.inventory > 0)
      throw new AppError(`Skladda ${warehouse._count.inventory} ta ehtiyot qism bor. Avval inventarni tozalang.`, 400)
    await prisma.warehouse.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'Sklad o\'chirildi'))
  } catch (err) { next(err) }
}
