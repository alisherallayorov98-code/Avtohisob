import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import bcrypt from 'bcrypt'

export async function getExpenses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, categoryId, from, to, branchId } = req.query as any
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (categoryId) where.categoryId = categoryId
    if (from || to) where.expenseDate = (() => {
        const gte = from ? new Date(from) : undefined
        const lte = to   ? new Date(to)   : undefined
        return { ...(gte && !isNaN(gte.getTime()) && { gte }), ...(lte && !isNaN(lte.getTime()) && { lte }) }
      })()
    if (effectiveBranchId) where.vehicle = { branchId: effectiveBranchId }

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
    res.json({ success: true, data: expenses, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
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
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomobil topilmadi', 404)
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

    const where: any = {}
    if (role) where.role = role
    if (branchId) where.branchId = branchId
    if (isActive !== undefined) where.isActive = isActive === 'true'

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
