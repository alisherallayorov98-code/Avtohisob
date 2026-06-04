import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../../../lib/prisma'

export interface EkoUserPayload {
  id: string
  email: string
  role: string       // 'admin' | 'inspector'
  orgId: string
  districtIds: string[]
  eko: true
}

export interface EkoRequest extends Request {
  ekoUser?: EkoUserPayload
}

// Eski EkoHisob JWT (eko: true flag bilan)
function verifyOldEkoToken(token: string): EkoUserPayload | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    if (!decoded || decoded.eko !== true) return null
    return decoded as EkoUserPayload
  } catch {
    return null
  }
}

// Asosiy AutoHisob JWT (role: 'ekohisob_user')
async function verifyMainTokenAsEko(token: string): Promise<EkoUserPayload | null> {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    if (!decoded || decoded.eko === true) return null   // eski eko token emas
    const allowedRoles = ['ekohisob_user', 'admin', 'super_admin']
    if (!allowedRoles.includes(decoded.role)) return null

    // DB dan foydalanuvchini va uning orgId, districtIds ni olamiz
    const user = await (prisma as any).user.findUnique({
      where: { id: decoded.id, isActive: true },
      select: {
        id: true, email: true, ekoDistrictIds: true,
        branch: { select: { organizationId: true } },
      },
    })
    if (!user) return null

    const orgId = user.branch?.organizationId ?? decoded.branchId ?? ''
    // admin/super_admin → EkoHisob admin, ekohisob_user → inspector
    const ekoRole = (decoded.role === 'admin' || decoded.role === 'super_admin') ? 'admin' : 'inspector'
    return {
      id: user.id,
      email: user.email,
      role: ekoRole,
      orgId,
      districtIds: user.ekoDistrictIds ?? [],
      eko: true,
    }
  } catch {
    return null
  }
}

export function requireEkoAuth(req: EkoRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token talab qilinadi' })
    return
  }
  const token = authHeader.split(' ')[1]

  // 1. Eski EkoHisob token tekshiruvi (sync, tez)
  const oldPayload = verifyOldEkoToken(token)
  if (oldPayload) { req.ekoUser = oldPayload; next(); return }

  // 2. Asosiy AutoHisob token tekshiruvi (async, DB so'rov)
  verifyMainTokenAsEko(token).then(mainPayload => {
    if (mainPayload) { req.ekoUser = mainPayload; next(); return }
    res.status(401).json({ success: false, error: 'Token noto\'g\'ri yoki muddati o\'tgan' })
  }).catch(() => {
    res.status(401).json({ success: false, error: 'Token tekshirishda xato' })
  })
}

export function requireEkoAdmin(req: EkoRequest, res: Response, next: NextFunction): void {
  if (!req.ekoUser) {
    res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' })
    return
  }
  if (req.ekoUser.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Faqat admin uchun' })
    return
  }
  next()
}
