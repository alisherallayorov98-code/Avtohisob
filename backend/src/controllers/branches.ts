import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getBranches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { isActive } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const where: any = {}
    if (isActive !== undefined) where.isActive = isActive === 'true'
    const filterVal = applyBranchFilter(filter)
    if (filterVal !== undefined) where.id = filterVal
    const branches = await prisma.branch.findMany({
      where,
      include: {
        manager: { select: { id: true, fullName: true, email: true } },
        warehouse: { select: { id: true, name: true } },
        _count: { select: { vehicles: true, users: true } },
      },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: branches })
  } catch (err) { next(err) }
}

export async function getBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, req.params.id)) {
      throw new AppError('Bu filialga kirish huquqingiz yo\'q', 403)
    }
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, fullName: true, email: true } },
        warehouse: { select: { id: true, name: true } },
        users: { select: { id: true, fullName: true, role: true, isActive: true } },
        vehicles: { select: { id: true, registrationNumber: true, brand: true, model: true, status: true } },
      },
    })
    if (!branch) throw new AppError('Guruh topilmadi', 404)
    res.json(successResponse(branch))
  } catch (err) { next(err) }
}

export async function createBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, managerId, warehouseCapacity, contactPhone, warehouseId, newManager } = req.body

    // Org admin creating a branch: inherit their organizationId
    let inheritedOrgId: string | null = null
    if (req.user!.role === 'admin' && req.user!.branchId) {
      const adminBranch = await (prisma.branch as any).findUnique({
        where: { id: req.user!.branchId },
        select: { organizationId: true },
      })
      inheritedOrgId = adminBranch?.organizationId ?? req.user!.branchId
    }

    if (newManager?.login && newManager?.password && newManager?.fullName) {
      const isPhone = /^\+?[0-9]{9,15}$/.test(newManager.login.replace(/\s/g, ''))
      const email = isPhone ? `${newManager.login.replace(/\D/g, '')}@avtohisob.internal` : newManager.login.toLowerCase()
      const phone = isPhone ? newManager.login.replace(/\s/g, '') : null

      const existing = await (prisma as any).user.findFirst({
        where: isPhone ? { OR: [{ phone }, { email }] } : { email },
        select: { id: true, isActive: true },
      })
      if (existing) {
        if (!existing.isActive) throw new AppError("Bu login bloklangan. Avval foydalanuvchini blokdan chiqaring.", 409)
        throw new AppError("Bu login allaqachon ro'yxatdan o'tgan", 409)
      }

      const passwordHash = await bcrypt.hash(newManager.password, 12)
      const result = await prisma.$transaction(async (tx) => {
        const branch = await (tx.branch as any).create({
          data: { name, location, warehouseCapacity: parseFloat(warehouseCapacity || '0'), contactPhone, warehouseId: warehouseId || null, organizationId: inheritedOrgId },
        })
        const user = await (tx as any).user.create({
          data: { email, phone, passwordHash, fullName: newManager.fullName, role: 'manager', branchId: branch.id },
        })
        return tx.branch.update({
          where: { id: branch.id },
          data: { managerId: user.id },
          include: { manager: { select: { id: true, fullName: true } }, warehouse: { select: { id: true, name: true } } },
        })
      })
      return res.status(201).json(successResponse(result, 'Guruh va menejer qo\'shildi'))
    }

    const branch = await (prisma.branch as any).create({
      data: { name, location, managerId: managerId || null, warehouseCapacity: parseFloat(warehouseCapacity || '0'), contactPhone, warehouseId: warehouseId || null, organizationId: inheritedOrgId },
      include: { manager: { select: { id: true, fullName: true } }, warehouse: { select: { id: true, name: true } } },
    })
    res.status(201).json(successResponse(branch, 'Guruh qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, location, managerId, warehouseCapacity, contactPhone, isActive, warehouseId } = req.body
    const ubFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(ubFilter, req.params.id))
      throw new AppError('Bu filialga kirish huquqingiz yo\'q', 403)
    const branch = await prisma.branch.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }), ...(location && { location }),
        ...(managerId !== undefined && { managerId: managerId || null }),
        ...(warehouseCapacity !== undefined && { warehouseCapacity: parseFloat(warehouseCapacity) }),
        ...(contactPhone && { contactPhone }),
        ...(isActive !== undefined && { isActive: isActive === true || isActive === 'true' }),
        // '' → null (no warehouse), otherwise set the warehouseId
        ...(warehouseId !== undefined && { warehouseId: warehouseId === '' ? null : warehouseId }),
      },
      include: {
        manager: { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true } },
      },
    })
    res.json(successResponse(branch, 'Guruh yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteBranch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const dbFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(dbFilter, req.params.id))
      throw new AppError('Bu filialga kirish huquqingiz yo\'q', 403)
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { vehicles: true, users: true } } },
    })
    if (!branch) throw new AppError('Guruh topilmadi', 404)
    if (branch._count.vehicles > 0)
      throw new AppError(`Guruhda ${branch._count.vehicles} ta avtomobil bor. Avval ularni o'chiring yoki boshqa guruhga o'tkazing.`, 400)
    await prisma.branch.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'Guruh o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getBranchStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const bsFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(bsFilter, id))
      throw new AppError('Bu filialga kirish huquqingiz yo\'q', 403)
    const branch = await prisma.branch.findUnique({ where: { id }, select: { warehouseId: true } })
    const warehouseId = branch?.warehouseId

    const [vehicleCount, inventoryItems, totalExpenses, fuelCost] = await Promise.all([
      prisma.vehicle.count({ where: { branchId: id, status: 'active' } }),
      warehouseId
        ? prisma.inventory.findMany({ where: { warehouseId }, include: { sparePart: { select: { unitPrice: true } } } })
        : Promise.resolve([]),
      prisma.expense.aggregate({ where: { vehicle: { branchId: id } }, _sum: { amount: true } }),
      prisma.fuelRecord.aggregate({ where: { vehicle: { branchId: id } }, _sum: { cost: true } }),
    ])
    const totalInventoryValue = (inventoryItems as any[]).reduce((s, i) => s + Number(i.quantityOnHand) * Number(i.sparePart.unitPrice), 0)
    res.json(successResponse({
      activeVehicles: vehicleCount,
      totalInventoryValue,
      totalExpenses: Number(totalExpenses._sum.amount) || 0,
      totalFuelCost: Number(fuelCost._sum.cost) || 0,
    }))
  } catch (err) { next(err) }
}
