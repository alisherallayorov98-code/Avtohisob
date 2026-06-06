import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { normalizeLogin } from '../lib/normalizeLogin'

export async function listUsers(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const users = await (prisma as any).ekoHisobUser.findMany({
      where: { orgId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        orgId: true,
        createdAt: true,
        updatedAt: true,
        districts: {
          include: { district: { select: { id: true, name: true } } },
        },
        botLink: {
          select: { chatId: true, tgUsername: true, tgFirstName: true, linkedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: users })
  } catch (err) { next(err) }
}

export async function createUser(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    // 'email' maydoni endi email YOKI telefon bo'lishi mumkin (login identifikatori)
    const { email, password, fullName, role } = req.body
    if (!email || !password || !fullName) {
      res.status(400).json({ success: false, error: 'Login (email yoki telefon), parol va ism talab qilinadi' })
      return
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ success: false, error: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak' })
      return
    }
    const allowed = ['admin', 'inspector', 'supervisor']
    if (role && !allowed.includes(role)) {
      res.status(400).json({ success: false, error: 'Rol noto\'g\'ri. Mumkin: admin, inspector, supervisor' })
      return
    }

    const login = normalizeLogin(email)
    const existing = await (prisma as any).ekoHisobUser.findFirst({
      where: { email: login, orgId },
    })
    if (existing) {
      res.status(409).json({ success: false, error: 'Bu login allaqachon ro\'yxatdan o\'tgan' })
      return
    }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    const user = await (prisma as any).ekoHisobUser.create({
      data: {
        email: login,
        passwordHash,
        fullName: String(fullName).trim(),
        role: role || 'inspector',
        orgId,
      },
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, orgId: true, createdAt: true, updatedAt: true,
      },
    })
    res.status(201).json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function updateUser(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { fullName, role, isActive } = req.body

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const data: any = {}
    if (fullName !== undefined) data.fullName = String(fullName).trim()
    if (role !== undefined) {
      const allowed = ['admin', 'inspector', 'supervisor']
      if (!allowed.includes(role)) {
        res.status(400).json({ success: false, error: 'Rol noto\'g\'ri' })
        return
      }
      data.role = role
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive)

    const user = await (prisma as any).ekoHisobUser.update({
      where: { id },
      data,
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, orgId: true, createdAt: true, updatedAt: true,
      },
    })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function assignDistricts(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { districtIds } = req.body

    if (!Array.isArray(districtIds)) {
      res.status(400).json({ success: false, error: 'districtIds massiv bo\'lishi kerak' })
      return
    }

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    // Delete existing and create new assignments
    await (prisma as any).ekoHisobUserDistrict.deleteMany({ where: { userId: id } })

    if (districtIds.length > 0) {
      await (prisma as any).ekoHisobUserDistrict.createMany({
        data: districtIds.map((districtId: string) => ({ userId: id, districtId })),
        skipDuplicates: true,
      })
    }

    const updated = await (prisma as any).ekoHisobUser.findUnique({
      where: { id },
      include: {
        districts: { include: { district: { select: { id: true, name: true } } } },
      },
    })
    const { passwordHash: _, ...safeUser } = updated
    res.json({ success: true, data: safeUser })
  } catch (err) { next(err) }
}

export async function resetPassword(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { newPassword } = req.body

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ success: false, error: 'Yangi parol kamida 6 ta belgidan iborat bo\'lishi kerak' })
      return
    }

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    await (prisma as any).ekoHisobUser.update({ where: { id }, data: { passwordHash } })
    res.json({ success: true, data: null, message: 'Parol yangilandi' })
  } catch (err) { next(err) }
}

export async function deactivateUser(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: callerId } = req.ekoUser!
    const { id } = req.params

    if (id === callerId) {
      res.status(400).json({ success: false, error: 'O\'zingizni o\'chira olmaysiz' })
      return
    }

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    await (prisma as any).ekoHisobUser.update({
      where: { id },
      data: { isActive: false },
    })
    res.json({ success: true, data: null, message: 'Foydalanuvchi deaktiv qilindi' })
  } catch (err) { next(err) }
}
