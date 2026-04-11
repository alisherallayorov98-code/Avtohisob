import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'

export async function createOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orgName, location, adminName, adminEmail, adminPassword } = req.body
    if (!orgName || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({ success: false, error: "Barcha maydonlar to'ldirilishi shart" })
    }
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (existing) return res.status(400).json({ success: false, error: "Bu email allaqachon ro'yxatdan o'tgan" })

    const passwordHash = await bcrypt.hash(adminPassword, 12)
    const result = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { name: orgName, location: location || '' } })
      const user = await tx.user.create({
        data: { email: adminEmail, passwordHash, fullName: adminName, role: 'admin', branchId: branch.id },
      })
      return { branch, user }
    })

    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_create_org', entityType: 'Branch', entityId: result.branch.id, ipAddress: req.ip },
    }).catch(() => {})

    res.status(201).json({ success: true, data: { id: result.user.id, name: orgName, adminEmail } })
  } catch (err) { next(err) }
}

export async function listOrganizations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, status, page = '1', limit = '20' } = req.query
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: any = { role: 'admin' }
    if (search) {
      where.OR = [
        { fullName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    if (status === 'active') where.isActive = true
    if (status === 'inactive') where.isActive = false

    const [orgAdmins, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          branch: {
            include: {
              _count: { select: { vehicles: true, users: true } },
            },
          },
          subscription: { include: { plan: true } },
        },
      }),
      prisma.user.count({ where }),
    ])

    res.json({
      success: true,
      data: orgAdmins.map(u => ({
        id: u.id,
        name: u.branch?.name || u.fullName,
        adminName: u.fullName,
        adminEmail: u.email,
        branchId: u.branchId,
        location: u.branch?.location || '—',
        vehicleCount: u.branch?._count.vehicles || 0,
        userCount: u.branch?._count.users || 0,
        status: u.isActive ? 'active' : 'inactive',
        plan: u.subscription?.plan?.name || 'Bepul',
        planType: u.subscription?.plan?.type || 'free',
        subscriptionStatus: u.subscription?.status || 'none',
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
      pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string), pages: Math.ceil(total / parseInt(limit as string)) },
    })
  } catch (err) { next(err) }
}

export async function getOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id, role: 'admin' },
      include: {
        branch: {
          include: {
            vehicles: { select: { status: true } },
            users: { select: { id: true, fullName: true, role: true, isActive: true, lastLoginAt: true } },
            inventories: { include: { sparePart: { select: { unitPrice: true } } } },
          },
        },
        subscription: { include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 12 } } },
      },
    })
    if (!user) return res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })

    const branch = user.branch
    const totalVehicles = branch?.vehicles.length || 0
    const activeVehicles = branch?.vehicles.filter(v => v.status === 'active').length || 0
    const totalRevenue = user.subscription?.invoices
      .filter(i => i.status === 'paid')
      .reduce((s, i) => s + Number(i.amount), 0) || 0

    let fuelCost = 0, maintCost = 0
    if (branch) {
      const [fuel, maint] = await Promise.all([
        prisma.fuelRecord.aggregate({
          _sum: { cost: true },
          where: { vehicle: { branchId: branch.id } },
        }),
        prisma.maintenanceRecord.aggregate({
          _sum: { cost: true },
          where: { vehicle: { branchId: branch.id } },
        }),
      ])
      fuelCost = Number(fuel._sum.cost || 0)
      maintCost = Number(maint._sum.cost || 0)
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        name: branch?.name || user.fullName,
        adminName: user.fullName,
        adminEmail: user.email,
        status: user.isActive ? 'active' : 'inactive',
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        branch,
        stats: { totalVehicles, activeVehicles, totalUsers: branch?.users.length || 0, fuelCost, maintCost, totalRevenue },
        subscription: user.subscription,
        users: branch?.users || [],
      },
    })
  } catch (err) { next(err) }
}

export async function suspendOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_suspend_org', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function activateOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: true } })
    res.json({ success: true })
  } catch (err) { next(err) }
}
