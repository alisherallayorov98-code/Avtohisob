import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface EkoUserPayload {
  id: string
  email: string
  role: string
  orgId: string
  districtIds: string[]
  eko: true
}

export interface EkoRequest extends Request {
  ekoUser?: EkoUserPayload
}

export function verifyEkoToken(token: string): EkoUserPayload | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    if (!decoded || decoded.eko !== true) return null
    return decoded as EkoUserPayload
  } catch {
    return null
  }
}

export function requireEkoAuth(req: EkoRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token talab qilinadi' })
    return
  }
  const token = authHeader.split(' ')[1]
  const payload = verifyEkoToken(token)
  if (!payload) {
    res.status(401).json({ success: false, error: 'Token noto\'g\'ri yoki muddati o\'tgan' })
    return
  }
  req.ekoUser = payload
  next()
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
