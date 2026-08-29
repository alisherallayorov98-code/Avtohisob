import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../../../lib/prisma'
import { resolveOrgId } from '../../../lib/orgFilter'

export interface SavdoUserPayload {
  id: string
  email: string
  role: string        // 'admin' | 'manager' | 'cashier' | 'staff'
  orgId: string
  savdo: true
}

export interface SavdoRequest extends Request {
  savdoUser?: SavdoUserPayload
}

// O'z Savdo JWT'i (savdo: true bayrog'i bilan)
function verifySavdoToken(token: string): SavdoUserPayload | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    if (!decoded || decoded.savdo !== true) return null
    return decoded as SavdoUserPayload
  } catch {
    return null
  }
}

// Asosiy AutoHisob JWT — faqat admin/super_admin soya-yozuv orqali kiradi
async function verifyMainTokenAsSavdo(token: string): Promise<SavdoUserPayload | null> {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    if (!decoded || decoded.savdo === true) return null   // eski savdo token emas
    if (decoded.role !== 'admin' && decoded.role !== 'super_admin') return null

    const user = await (prisma as any).user.findUnique({
      where: { id: decoded.id, isActive: true },
      select: { id: true, email: true, role: true, branchId: true },
    })
    if (!user) return null

    // resolveOrgId — orgFilter.ts'ning yagona to'g'ri manbai, filialga
    // biriktirilgan admin uchun haqiqiy tashkilot id'sini beradi. Filial yo'q
    // bo'lsa (super_admin yoki filialsiz admin) null qaytaradi — bunday holda
    // ILGARI barcha shu holatdagi adminlar bitta bo'sh orgId=''ga tushib,
    // bir-birining ma'lumotini ko'rar edi (tenant leak). Endi har bir
    // filialsiz admin o'zining user.id'siga bog'langan ALOHIDA maydonga ega
    // bo'ladi — ular hech qachon bir-biriga to'qnashmaydi.
    const orgId = (await resolveOrgId(user)) ?? `savdo-user-${user.id}`

    return {
      id: user.id,
      email: user.email,
      role: 'admin',
      orgId,
      savdo: true,
    }
  } catch {
    return null
  }
}

export function requireSavdoAuth(req: SavdoRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token talab qilinadi' })
    return
  }
  const token = authHeader.split(' ')[1]

  const savdoPayload = verifySavdoToken(token)
  if (savdoPayload) { req.savdoUser = savdoPayload; next(); return }

  verifyMainTokenAsSavdo(token).then(mainPayload => {
    if (mainPayload) { req.savdoUser = mainPayload; next(); return }
    res.status(401).json({ success: false, error: 'Token noto\'g\'ri yoki muddati o\'tgan' })
  }).catch(() => {
    res.status(401).json({ success: false, error: 'Token tekshirishda xato' })
  })
}

export function requireSavdoAdmin(req: SavdoRequest, res: Response, next: NextFunction): void {
  if (!req.savdoUser) {
    res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' })
    return
  }
  if (req.savdoUser.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Faqat admin uchun' })
    return
  }
  next()
}
