import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AuthRequest } from '../types'
import { AppError } from './errorHandler'
import { prisma } from '../lib/prisma'
import { getOrgFilter } from '../lib/orgFilter'
import { runWithOrgContext } from '../lib/orgContext'

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Autentifikatsiya talab qilinadi', 401))
  }

  const token = authHeader.split(' ')[1]
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any

    // Check token blacklist
    const blacklisted = await prisma.tokenBlacklist.findUnique({ where: { token } })
    if (blacklisted) {
      return next(new AppError('Token bekor qilingan', 401))
    }

    // Fresh DB lookup: branchId yoki rol o'zgargan bo'lsa JWT payload eskirgan bo'ladi.
    // isActive tekshiruvi: bloklangan foydalanuvchi mavjud tokenlar bilan kirib qolmasin.
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, role: true, branchId: true, fullName: true, isActive: true, maxPlanType: true },
    })
    if (!dbUser || !dbUser.isActive) {
      return next(new AppError('Foydalanuvchi topilmadi yoki bloklangan', 401))
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      branchId: dbUser.branchId,
      fullName: dbUser.fullName,
      maxPlanType: (dbUser as any).maxPlanType || 'free',
    }

    // Compute org filter once per request and bind to async context.
    // All subsequent controller code and Prisma queries share this filter
    // via AsyncLocalStorage — no repeated DB lookups.
    const filter = await getOrgFilter(req.user)
    runWithOrgContext(filter, next)
  } catch {
    next(new AppError('Token noto\'g\'ri yoki muddati tugagan', 401))
  }
}
