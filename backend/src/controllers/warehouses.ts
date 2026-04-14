import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter } from '../lib/orgFilter'

export async function getWarehouses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = {}

    if (filter.type === 'single') {
      // branch_manager / operator: only their branch's warehouse
      const branch = await prisma.branch.findUnique({
        where: { id: filter.branchId }, select: { warehouseId: true }
      })
      if (!branch?.warehouseId) return res.json(successResponse([]))
      where.id = branch.warehouseId
    } else if (filter.type === 'org') {
      // org admin: all warehouses linked to any of their org's branches
      const branches = await prisma.branch.findMany({
        where: { id: { in: filter.orgBranchIds } }, select: { warehouseId: true }
      })
      const wIds = [...new Set(branches.map(b => b.warehouseId).filter(Boolean))] as string[]
      if (wIds.length === 0) return res.json(successResponse([]))
      where.id = { in: wIds }
    }
    // filter.type === 'none': super_admin / global admin sees all

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
    const whFilter = await getOrgFilter(req.user!)
    if (whFilter.type === 'single') {
      const branch = await prisma.branch.findUnique({ where: { id: whFilter.branchId }, select: { warehouseId: true } })
      if (branch?.warehouseId !== warehouse.id) throw new AppError('Bu sklad sizga ruxsat etilmagan', 403)
    } else if (whFilter.type === 'org') {
      const orgBranches = await prisma.branch.findMany({
        where: { id: { in: whFilter.orgBranchIds } }, select: { warehouseId: true }
      })
      const wIds = new Set(orgBranches.map(b => b.warehouseId).filter(Boolean))
      if (!wIds.has(warehouse.id)) throw new AppError('Bu sklad sizga ruxsat etilmagan', 403)
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
