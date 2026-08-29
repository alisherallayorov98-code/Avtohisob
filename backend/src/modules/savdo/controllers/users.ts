import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { normalizeLogin } from '../lib/normalizeLogin'

const ALLOWED_ROLES = ['admin', 'manager', 'cashier', 'staff']

export async function listUsers(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const users = await (prisma as any).savdoUser.findMany({
      // isMirror — asosiy AutoHisob hisobi bilan kirganlar uchun texnik soya yozuv
      // (FK talabi). Ular xodimlar ro'yxatida ko'rinmasligi kerak.
      where: { orgId, isMirror: false },
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: users })
  } catch (err) { next(err) }
}

export async function createUser(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { email, password, fullName, role } = req.body

    if (!email || !password || !fullName) {
      res.status(400).json({ success: false, error: 'Login (email yoki telefon), parol va ism talab qilinadi' })
      return
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ success: false, error: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak' })
      return
    }
    if (role && !ALLOWED_ROLES.includes(role)) {
      res.status(400).json({ success: false, error: `Rol noto'g'ri. Mumkin: ${ALLOWED_ROLES.join(', ')}` })
      return
    }

    const login = normalizeLogin(email)
    const existing = await (prisma as any).savdoUser.findFirst({ where: { email: login, orgId } })
    if (existing) {
      res.status(409).json({ success: false, error: 'Bu login allaqachon ro\'yxatdan o\'tgan' })
      return
    }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    const user = await (prisma as any).savdoUser.create({
      data: {
        email: login, passwordHash, fullName: String(fullName).trim(),
        role: role || 'staff', orgId,
      },
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, createdAt: true, updatedAt: true,
      },
    })
    res.status(201).json({ success: true, data: user, message: 'Xodim qo\'shildi' })
  } catch (err) { next(err) }
}

export async function updateUser(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { fullName, role, isActive, email } = req.body

    const existing = await (prisma as any).savdoUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const data: any = {}
    if (fullName !== undefined) data.fullName = String(fullName).trim()
    if (email !== undefined) {
      const login = normalizeLogin(email)
      if (!login) {
        res.status(400).json({ success: false, error: 'Login (email yoki telefon) noto\'g\'ri' })
        return
      }
      const dup = await (prisma as any).savdoUser.findFirst({ where: { email: login, orgId, NOT: { id } } })
      if (dup) {
        res.status(409).json({ success: false, error: 'Bu login allaqachon boshqa foydalanuvchida bor' })
        return
      }
      data.email = login
    }
    if (role !== undefined) {
      if (!ALLOWED_ROLES.includes(role)) {
        res.status(400).json({ success: false, error: 'Rol noto\'g\'ri' })
        return
      }
      data.role = role
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive)

    const user = await (prisma as any).savdoUser.update({
      where: { id },
      data,
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, createdAt: true, updatedAt: true,
      },
    })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function resetPassword(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { newPassword } = req.body

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ success: false, error: 'Yangi parol kamida 6 ta belgidan iborat bo\'lishi kerak' })
      return
    }

    const existing = await (prisma as any).savdoUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    await (prisma as any).savdoUser.update({ where: { id }, data: { passwordHash } })
    res.json({ success: true, data: null, message: 'Parol yangilandi' })
  } catch (err) { next(err) }
}

export async function deactivateUser(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: callerId } = req.savdoUser!
    const { id } = req.params

    if (id === callerId) {
      res.status(400).json({ success: false, error: 'O\'zingizni o\'chira olmaysiz' })
      return
    }

    const existing = await (prisma as any).savdoUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    await (prisma as any).savdoUser.update({ where: { id }, data: { isActive: false } })
    res.json({ success: true, data: null, message: 'Xodim deaktiv qilindi' })
  } catch (err) { next(err) }
}
