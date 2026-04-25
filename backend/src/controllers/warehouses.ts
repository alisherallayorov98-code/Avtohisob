import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

/** Returns true if the warehouse is accessible to the current user's org */
async function assertWarehouseAccess(filter: Awaited<ReturnType<typeof getOrgFilter>>, warehouseId: string): Promise<void> {
  if (filter.type === 'none') return
  if (filter.type === 'org' && filter.orgBranchIds.length === 0) return

  // Check if warehouse is linked to any branch at all — unlinked warehouses are accessible to org admins
  const anyBranch = await prisma.branch.findFirst({ where: { warehouseId }, select: { id: true } })
  if (!anyBranch) return // unlinked warehouse — org admin can manage it

  const bv = applyBranchFilter(filter)
  const linked = await prisma.branch.findFirst({
    where: { warehouseId, ...(bv !== undefined && { id: bv }) },
    select: { id: true },
  })
  if (!linked) throw new AppError('Bu sklad sizga ruxsat etilmagan', 403)
}

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
      // org admin: warehouses linked to any org branch, OR not yet linked to any branch
      const branches = await prisma.branch.findMany({
        where: { id: { in: filter.orgBranchIds } }, select: { warehouseId: true }
      })
      const wIds = [...new Set(branches.map(b => b.warehouseId).filter(Boolean))] as string[]
      where.OR = [
        ...(wIds.length > 0 ? [{ id: { in: wIds } }] : []),
        { branches: { none: {} } },
      ]
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
    } else if (whFilter.type === 'org' && whFilter.orgBranchIds.length > 0) {
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
    const uwFilter = await getOrgFilter(req.user!)
    await assertWarehouseAccess(uwFilter, req.params.id)
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
    const dwFilter = await getOrgFilter(req.user!)
    await assertWarehouseAccess(dwFilter, req.params.id)
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
