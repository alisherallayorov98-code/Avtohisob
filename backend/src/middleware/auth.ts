import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AuthRequest } from '../types'
import { AppError } from './errorHandler'
import { prisma } from '../lib/prisma'

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

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      branchId: payload.branchId,
      fullName: payload.fullName,
    }
    next()
  } catch {
    next(new AppError('Token noto\'g\'ri yoki muddati tugagan', 401))
  }
}
