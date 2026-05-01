import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse, paginatedResponse, buildDateRangeFilter } from '../types'
import { AppError } from '../middleware/errorHandler'
import bcrypt from 'bcrypt'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

export async function getExpenses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, categoryId, from, to, branchId, search } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (categoryId) where.categoryId = categoryId
    const dateRange = buildDateRangeFilter(from, to)
    if (dateRange) where.expenseDate = dateRange
    if (filterVal !== undefined) where.vehicle = { branchId: filterVal }
    else if (branchId) where.vehicle = { branchId }

    // Qidirish: tavsif ichidan, mashina raqamidan, kategoriya nomidan
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim()
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { vehicle: { registrationNumber: { contains: q, mode: 'insensitive' } } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
      ]
    }

    const [total, expenses, totalSumResult] = await Promise.all([
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
      // Filter bo'yicha umumiy jami summa (sahifa emas, hammasi)
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ])
    const totalSum = Number(totalSumResult._sum?.amount || 0)
    res.json({ success: true, data: expenses, meta: { total, page, limit, totalPages: Math.ceil(total / limit), totalSum } })
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
    // Kelajak sana taqiqlanadi (xarajat o'tmishda bo'lishi kerak)
    const expenseDateObj = new Date(expenseDate)
    if (expenseDateObj.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new AppError('Kelajakdagi sanani tanlay olmaysiz', 400)
    }
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, branchId: true } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)
    const expenseFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(expenseFilter, vehicle.branchId)) {
      throw new AppError('Bu avtomobilga xarajat qo\'sha olmaysiz', 403)
    }
    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null
    const expense = await prisma.expense.create({
      data: {
        vehicleId,
        categoryId,
        amount: parsedAmount,
        description: typeof description === 'string' ? description : '',
        expenseDate: expenseDateObj,
        createdById: req.user!.id,
        ...(receiptUrl ? { receiptUrl } : {}),
      },
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
    if (!name?.trim()) throw new AppError('Kategoriya nomi kiritilishi shart', 400)
    // Bir xil nom takrorlanmasin
    const existing = await prisma.expenseCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    })
    if (existing) throw new AppError('Bunday nomli kategoriya allaqachon mavjud', 400)
    const category = await prisma.expenseCategory.create({
      data: { name: name.trim(), description: description?.trim() || null },
    })
    res.status(201).json(successResponse(category, "Kategoriya qo'shildi"))
  } catch (err) { next(err) }
}

// Xarajatni tahrirlash (faqat o'z org doirasidagi)
export async function updateExpense(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const existing = await prisma.expense.findUnique({
      where: { id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Xarajat topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, existing.vehicle.branchId)) {
      throw new AppError('Ruxsat yo\'q', 403)
    }

    const { vehicleId, categoryId, amount, description, expenseDate } = req.body
    const data: any = {}

    if (vehicleId && vehicleId !== existing.vehicleId) {
      const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
      if (!v) throw new AppError('Avtomobil topilmadi', 404)
      if (!isBranchAllowed(filter, v.branchId)) throw new AppError('Bu avtomobil sizning tashkilotingizga tegishli emas', 403)
      data.vehicleId = vehicleId
    }
    if (categoryId) data.categoryId = categoryId
    if (amount !== undefined) {
      const parsed = parseFloat(amount)
      if (isNaN(parsed) || parsed <= 0) throw new AppError('Summa 0 dan katta bo\'lishi kerak', 400)
      data.amount = parsed
    }
    if (description !== undefined) data.description = typeof description === 'string' ? description : ''
    if (expenseDate) {
      if (isNaN(Date.parse(expenseDate))) throw new AppError('Sana noto\'g\'ri formatda', 400)
      const dObj = new Date(expenseDate)
      if (dObj.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new AppError('Kelajakdagi sanani tanlay olmaysiz', 400)
      data.expenseDate = dObj
    }
    if (req.file) {
      data.receiptUrl = `/uploads/${req.file.filename}`
    }

    const updated = await prisma.expense.update({
      where: { id },
      data,
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
        category: true,
        createdBy: { select: { fullName: true } },
      },
    })
    res.json(successResponse(updated, 'Xarajat yangilandi'))
  } catch (err) { next(err) }
}

// Statistika: bu oy, o'tgan oy, kategoriya bo'yicha taqsimot
export async function getExpenseStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)
    const baseWhere: any = {}
    if (filterVal !== undefined) baseWhere.vehicle = { branchId: filterVal }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = monthStart

    const [thisMonth, lastMonth, byCategory] = await Promise.all([
      prisma.expense.aggregate({
        where: { ...baseWhere, expenseDate: { gte: monthStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { ...baseWhere, expenseDate: { gte: lastMonthStart, lt: lastMonthEnd } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.groupBy({
        by: ['categoryId'],
        where: { ...baseWhere, expenseDate: { gte: monthStart } },
        _sum: { amount: true },
        _count: true,
      }),
    ])

    // Kategoriya nomlarini olib qo'shamiz
    const catIds = byCategory.map((c) => c.categoryId)
    const cats = catIds.length
      ? await prisma.expenseCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
      : []
    const catMap = new Map(cats.map(c => [c.id, c.name]))
    const byCategoryNamed = byCategory
      .map(c => ({
        categoryId: c.categoryId,
        name: catMap.get(c.categoryId) || 'Boshqa',
        sum: Number(c._sum.amount || 0),
        count: (c as any)._count ?? 0,
      }))
      .sort((a, b) => b.sum - a.sum)

    const thisMonthSum = Number(thisMonth._sum.amount || 0)
    const lastMonthSum = Number(lastMonth._sum.amount || 0)
    const changePct = lastMonthSum > 0 ? Math.round(((thisMonthSum - lastMonthSum) / lastMonthSum) * 100) : null

    res.json(successResponse({
      thisMonth: { sum: thisMonthSum, count: (thisMonth as any)._count ?? 0 },
      lastMonth: { sum: lastMonthSum, count: (lastMonth as any)._count ?? 0 },
      changePct,
      byCategory: byCategoryNamed,
    }))
  } catch (err) { next(err) }
}

// Xarajatni o'chirish
export async function deleteExpense(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const existing = await prisma.expense.findUnique({
      where: { id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Xarajat topilmadi', 404)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, existing.vehicle.branchId)) {
      throw new AppError('Ruxsat yo\'q', 403)
    }
    await prisma.expense.delete({ where: { id } })
    res.json(successResponse(null, 'Xarajat o\'chirildi'))
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
