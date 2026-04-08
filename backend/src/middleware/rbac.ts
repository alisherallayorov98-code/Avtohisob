import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { AppError } from './errorHandler'

export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Autentifikatsiya talab qilinadi', 401))
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Bu amalni bajarish uchun ruxsat yo\'q', 403))
    }
    next()
  }
}

export function branchFilter(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError('Autentifikatsiya talab qilinadi', 401))
  if (['branch_manager', 'operator'].includes(req.user.role) && req.user.branchId) {
    req.query.branchId = req.user.branchId
  }
  next()
}
