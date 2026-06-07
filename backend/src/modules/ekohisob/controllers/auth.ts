import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { normalizeLogin } from '../lib/normalizeLogin'

function signEkoToken(payload: {
  id: string
  email: string
  role: string
  orgId: string
  districtIds: string[]
}): string {
  return jwt.sign(
    { ...payload, eko: true },
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

    // Login = email yoki telefon. Korxona (orgId) avtomatik aniqlanadi — foydalanuvchi
    // bilishi shart emas. Bir xil login bir nechta korxonada bo'lsa, parol mos kelgani tanlanadi.
    const candidates = await (prisma as any).ekoHisobUser.findMany({
      where: { email: normalizeLogin(email), isActive: true },
      include: {
        districts: { select: { districtId: true } },
      },
    })

    let user: any = null
    for (const c of candidates) {
      if (await bcrypt.compare(password, c.passwordHash)) { user = c; break }
    }

    if (!user) {
      res.status(401).json({ success: false, error: 'Login yoki parol noto\'g\'ri' })
      return
    }

    const districtIds = user.districts.map((d: any) => d.districtId)
    const token = signEkoToken({
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      districtIds,
    })

    const { passwordHash: _, ...safeUser } = user
    res.json({
      success: true,
      data: {
        token,
        user: { ...safeUser, districtIds },
      },
    })
  } catch (err) { next(err) }
}

export async function me(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const ekoUser = req.ekoUser!
    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: ekoUser.id },
      include: {
        districts: {
          include: {
            district: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!user) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const { passwordHash: _, ...safeUser } = user
    res.json({ success: true, data: safeUser })
  } catch (err) { next(err) }
}
