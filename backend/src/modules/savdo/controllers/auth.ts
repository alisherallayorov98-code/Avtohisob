import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { normalizeLogin } from '../lib/normalizeLogin'

function signSavdoToken(payload: {
  id: string
  email: string
  role: string
  orgId: string
}): string {
  return jwt.sign(
    { ...payload, savdo: true },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' },
  )
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Login va parol talab qilinadi' })
      return
    }

    const candidates = await (prisma as any).savdoUser.findMany({
      where: { email: normalizeLogin(email), isActive: true, isMirror: false },
    })

    let user: any = null
    for (const c of candidates) {
      if (await bcrypt.compare(password, c.passwordHash)) { user = c; break }
    }

    if (!user) {
      res.status(401).json({ success: false, error: 'Login yoki parol noto\'g\'ri' })
      return
    }

    const token = signSavdoToken({
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    })

    const { passwordHash: _, ...safeUser } = user
    res.json({
      success: true,
      data: { token, user: safeUser },
    })
  } catch (err) { next(err) }
}

export async function me(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const user = await (prisma as any).savdoUser.findUnique({ where: { id: actor.id } })

    // Soya-yozuv (mirror) hali yaratilmagan bo'lishi mumkin — asosiy tokendagi
    // ma'lumot bilan javob beramiz, birinchi yozuvchi amalda ensureSavdoActor yaratadi.
    if (!user) {
      res.json({
        success: true,
        data: { id: actor.id, email: actor.email, fullName: actor.email, role: actor.role, orgId: actor.orgId, isMirror: true },
      })
      return
    }

    const { passwordHash: _, ...safeUser } = user
    res.json({ success: true, data: safeUser })
  } catch (err) { next(err) }
}
