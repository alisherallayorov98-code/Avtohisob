import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse, paginatedResponse, buildDateRangeFilter } from '../types'
import { AppError } from '../middleware/errorHandler'
import bcrypt from 'bcrypt'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getExpenses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, categoryId, from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (categoryId) where.categoryId = categoryId
    const dateRange = buildDateRangeFilter(from, to)
    if (dateRange) where.expenseDate = dateRange
    if (filterVal !== undefined) where.vehicle = { branchId: filterVal }
    else if (branchId) where.vehicle = { branchId }

    const [total, expenses] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where, skip, take: limit,
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
          category: true,
          createdBy: { select: { fullName: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),
    ])
    res.json(paginatedResponse(expenses, total, page, limit))
  } catch (err) { next(err) }
}

export async function createExpense(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, categoryId, amount, description, expenseDate } = req.body
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0)
      throw new AppError('Summa 0 dan katta bo\'lishi kerak', 400)
    if (!vehicleId) throw new AppError('Avtomobil tanlanmagan', 400)
    if (!categoryId) throw new AppError('Kategoriya tanlanmagan', 400)
    if (!expenseDate || isNaN(Date.parse(expenseDate)))
      throw new AppError('Sana noto\'g\'ri formatda', 400)
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, branchId: true } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)
    const expenseFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(expenseFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga xarajat qo\'sha olmaysiz', 403)
    }
    const expense = await prisma.expense.create({
      data: { vehicleId, categoryId, amount: parsedAmount, description, expenseDate: new Date(expenseDate), createdById: req.user!.id },
      include: { vehicle: { select: { registrationNumber: true } }, category: true },
    })
    res.status(201).json(successResponse(expense, "Xarajat qo'shildi"))
  } catch (err) { next(err) }
}

export async function getExpenseCategories(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const categories = await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } })
    res.json(successResponse(categories))
  } catch (err) { next(err) }
}

export async function createExpenseCategory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, description } = req.body
    const category = await prisma.expenseCategory.create({ data: { name, description } })
    res.status(201).json(successResponse(category, "Kategoriya qo'shildi"))
  } catch (err) { next(err) }
}

export async function getUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { role, branchId, isActive } = req.query as any

    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const where: any = {}
    if (role) where.role = role
    if (isActive !== undefined) where.isActive = isActive === 'true'
    if (filterVal !== undefined) where.branchId = filterVal
    else if (branchId) where.branchId = branchId

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where, skip, take: limit,
        include: { branch: { select: { id: true, name: true } } },
        orderBy: { fullName: 'asc' },
      }),
    ])

    const safeUsers = users.map(({ passwordHash: _, ...u }) => u)
    res.json({ success: true, data: safeUsers, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function updateUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fullName, role, branchId, isActive, newPassword } = req.body
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { branchId: true, role: true } })
    if (!target) throw new AppError('Foydalanuvchi topilmadi', 404)
    const uFilter = await getOrgFilter(req.user!)
    const callerIsSuperAdmin = req.user!.role === 'super_admin'

    // Target access check: super_admin bypasses; others need target.branchId in their org
    if (!callerIsSuperAdmin) {
      if (!target.branchId || !isBranchAllowed(uFilter, target.branchId)) {
        throw new AppError('Ruxsat yo\'q', 403)
      }
    }

    // Privilege-escalation guard: only super_admin can grant/revoke super_admin role
    if (role && role !== target.role && !callerIsSuperAdmin) {
      if (role === 'super_admin' || target.role === 'super_admin') {
        throw new AppError('Super admin rolini faqat super admin boshqarishi mumkin', 403)
      }
    }

    // Branch move guard: non-super-admin can only move user within their own org
    if (branchId !== undefined && branchId !== target.branchId && !callerIsSuperAdmin) {
      if (!branchId || !isBranchAllowed(uFilter, branchId)) {
        throw new AppError('Tanlangan filial sizning tashkilotingizda emas', 403)
      }
    }

    const updateData: any = {
      ...(fullName && { fullName }),
      ...(role && { role }),
      ...(branchId !== undefined && { branchId: branchId || null }),
      ...(isActive !== undefined && { isActive }),
    }
    if (newPassword && newPassword.length >= 8) {
      updateData.passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'))
      updateData.passwordChangedAt = new Date()
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      include: { branch: { select: { id: true, name: true } } },
    })
    const { passwordHash: _, ...safeUser } = user
    res.json(successResponse(safeUser, 'Foydalanuvchi yangilandi'))
  } catch (err) { next(err) }
}

export async function blockUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) throw new AppError('O\'zingizni bloklolmaysiz', 400)
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { branchId: true, role: true } })
    if (!target) throw new AppError('Foydalanuvchi topilmadi', 404)
    const bFilter = await getOrgFilter(req.user!)
    const callerIsSuperAdmin = req.user!.role === 'super_admin'
    if (!callerIsSuperAdmin) {
      if (target.role === 'super_admin') throw new AppError('Super adminni bloklay olmaysiz', 403)
      if (!target.branchId || !isBranchAllowed(bFilter, target.branchId)) {
        throw new AppError('Ruxsat yo\'q', 403)
      }
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: { id: true, fullName: true, isActive: true },
    })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'BLOCK_USER', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    })
    res.json(successResponse(user, `${user.fullName} bloklandi`))
  } catch (err) { next(err) }
}

export async function unblockUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { branchId: true, role: true } })
    if (!target) throw new AppError('Foydalanuvchi topilmadi', 404)
    const ubFilter = await getOrgFilter(req.user!)
    const callerIsSuperAdmin = req.user!.role === 'super_admin'
    if (!callerIsSuperAdmin) {
      if (target.role === 'super_admin') throw new AppError('Ruxsat yo\'q', 403)
      if (!target.branchId || !isBranchAllowed(ubFilter, target.branchId)) {
        throw new AppError('Ruxsat yo\'q', 403)
      }
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: true },
      select: { id: true, fullName: true, isActive: true },
    })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'UNBLOCK_USER', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    })
    res.json(successResponse(user, `${user.fullName} faollashtirildi`))
  } catch (err) { next(err) }
}

export async function deleteUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) throw new AppError('O\'zingizni o\'chira olmaysiz', 400)
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true, fullName: true, branchId: true } })
    if (!target) throw new AppError('Foydalanuvchi topilmadi', 404)
    if (target.role === 'super_admin') throw new AppError('Super adminni o\'chirib bo\'lmaydi', 403)
    const callerIsSuperAdmin = req.user!.role === 'super_admin'
    if (!callerIsSuperAdmin) {
      const dFilter = await getOrgFilter(req.user!)
      if (!target.branchId || !isBranchAllowed(dFilter, target.branchId)) {
        throw new AppError('Ruxsat yo\'q', 403)
      }
    }
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'DELETE_USER', entityType: 'User', entityId: req.params.id, newData: { fullName: target.fullName }, ipAddress: req.ip },
    })
    await prisma.user.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, `${target.fullName} o'chirildi`))
  } catch (err) { next(err) }
}
