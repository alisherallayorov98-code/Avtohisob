import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'
import bcrypt from 'bcrypt'
import { getSearchVariants } from '../../lib/transliterate'

export async function listAdminUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, role, status, page = '1', limit = '20' } = req.query
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: any = {}
    if (search) {
      const variants = getSearchVariants(search as string)
      where.OR = variants.flatMap(v => [
        { email: { contains: v, mode: 'insensitive' } },
        { fullName: { contains: v, mode: 'insensitive' } },
      ])
    }
    if (role) where.role = role
    if (status === 'active') where.isActive = true
    if (status === 'inactive') where.isActive = false

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          branch: { select: { name: true } },
          subscription: { include: { plan: { select: { name: true, type: true } } } },
          _count: { select: { supportTickets: true } },
        },
      }),
      prisma.user.count({ where }),
    ])

    res.json({
      success: true,
      data: users.map(u => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        isActive: u.isActive,
        branchName: u.branch?.name,
        branchId: u.branchId,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        emailVerified: u.emailVerified,
        twoFactorEnabled: u.twoFactorEnabled,
        planName: u.subscription?.plan?.name,
        planType: u.subscription?.plan?.type,
        ticketCount: u._count.supportTickets,
      })),
      pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string), pages: Math.ceil(total / parseInt(limit as string)) },
    })
  } catch (err) { next(err) }
}

export async function getAdminUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        branch: true,
        subscription: { include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 5 } } },
        supportTickets: { orderBy: { createdAt: 'desc' }, take: 5 },
        _count: { select: { supportTickets: true, tokenBlacklists: true } },
      },
    })
    if (!user) return res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })

    const auditLogs = await prisma.auditLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        branchId: user.branchId,
        branch: user.branch,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        subscription: user.subscription,
        recentTickets: user.supportTickets,
        auditLogs,
        stats: { ticketCount: user._count.supportTickets },
      },
    })
  } catch (err) { next(err) }
}

export async function updateAdminUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fullName, role, isActive, branchId } = req.body
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { fullName, role, isActive, branchId: branchId || null },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    })
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'admin_update_user',
        entityType: 'User',
        entityId: req.params.id,
        newData: { fullName, role, isActive },
        ipAddress: req.ip,
      },
    })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function suspendAdminUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) return res.status(400).json({ success: false, error: 'O\'zingizni suspendlay olmaysiz' })
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: { id: true, fullName: true, isActive: true },
    })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_suspend_user', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function activateAdminUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: true },
      select: { id: true, fullName: true, isActive: true },
    })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function deleteAdminUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) return res.status(400).json({ success: false, error: 'O\'zingizni o\'chira olmaysiz' })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_delete_user', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    })
    await prisma.user.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function resetAdminUserPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, error: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak' })
    const hash = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: hash, passwordChangedAt: new Date() } })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_reset_password', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    })
    res.json({ success: true, message: 'Parol yangilandi' })
  } catch (err) { next(err) }
}
