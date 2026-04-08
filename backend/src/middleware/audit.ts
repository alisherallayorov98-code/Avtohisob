import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { prisma } from '../lib/prisma'

const AUDITED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

export function auditLog(entityType: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!AUDITED_METHODS.includes(req.method)) return next()

    const originalJson = res.json.bind(res)
    res.json = function (body: any) {
      if (res.statusCode < 400 && req.user) {
        const entityId = req.params.id || body?.data?.id || null
        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: req.method,
            entityType,
            entityId,
            newData: req.body || null,
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers['user-agent'] || null,
          },
        }).catch(() => {}) // non-blocking
      }
      return originalJson(body)
    }
    next()
  }
}
