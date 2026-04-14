import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'
import { getSearchVariants } from '../../lib/transliterate'

export async function createOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orgName, location, contactPhone, adminName, adminLogin, adminPassword } = req.body
    if (!orgName || !adminName || !adminLogin || !adminPassword) {
      return res.status(400).json({ success: false, error: "Barcha majburiy maydonlar to'ldirilishi shart" })
    }
    const isPhone = /^\+?[0-9]{9,15}$/.test(adminLogin.replace(/\s/g, ''))
    const adminEmail = isPhone ? `${adminLogin.replace(/\D/g, '')}@avtohisob.internal` : adminLogin.toLowerCase()
    const adminPhone = isPhone ? adminLogin.replace(/\s/g, '') : null

    const existing = await (prisma as any).user.findFirst({
      where: isPhone ? { phone: adminPhone } : { email: adminEmail },
    })
    if (existing) return res.status(400).json({ success: false, error: "Bu login allaqachon ro'yxatdan o'tgan" })

    const passwordHash = await bcrypt.hash(adminPassword, 12)
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: create branch without organizationId (ID not known yet)
      const branch = await tx.branch.create({ data: { name: orgName, location: location || '', contactPhone: contactPhone || '' } })
      // Step 2: set organizationId = branch.id (root branch points to itself)
      await tx.branch.update({ where: { id: branch.id }, data: { organizationId: branch.id } })
      const user = await (tx as any).user.create({
        data: { email: adminEmail, phone: adminPhone, passwordHash, fullName: adminName, role: 'admin', branchId: branch.id },
      })
      return { branch: { ...branch, organizationId: branch.id }, user }
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
      const variants = getSearchVariants(search as string)
      where.OR = variants.flatMap(v => [
        { fullName: { contains: v, mode: 'insensitive' } },
        { email: { contains: v, mode: 'insensitive' } },
      ])
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

export async function setSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { planType, endDate } = req.body
    if (!planType || !endDate) return res.status(400).json({ success: false, error: "planType va endDate talab qilinadi" })

    const admin = await prisma.user.findUnique({ where: { id: req.params.id, role: 'admin' } })
    if (!admin) return res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })

    const plan = await (prisma as any).plan.findFirst({ where: { type: planType } })
    if (!plan) return res.status(404).json({ success: false, error: `"${planType}" tarif topilmadi` })

    const end = new Date(endDate)
    const now = new Date()

    await (prisma as any).subscription.upsert({
      where: { userId: admin.id },
      update: { planId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: end, cancelAtPeriodEnd: false },
      create: { userId: admin.id, planId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: end },
    })

    // Ensure user is active
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: true } })

    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_set_subscription', entityType: 'User', entityId: admin.id, ipAddress: req.ip },
    }).catch(() => {})

    res.json({ success: true })
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

export async function updateOrgAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fullName, newPassword, newLogin } = req.body
    const admin = await prisma.user.findUnique({ where: { id: req.params.id, role: 'admin' } })
    if (!admin) return res.status(404).json({ success: false, error: 'Tashkilot admini topilmadi' })

    const updateData: any = {}
    if (fullName?.trim()) updateData.fullName = fullName.trim()

    if (newLogin?.trim()) {
      const isPhone = /^\+?[0-9]{9,15}$/.test(newLogin.replace(/\s/g, ''))
      const email = isPhone ? `${newLogin.replace(/\D/g, '')}@avtohisob.internal` : newLogin.toLowerCase()
      const phone = isPhone ? newLogin.replace(/\s/g, '') : null
      const existing = await prisma.user.findFirst({
        where: isPhone ? { OR: [{ phone }, { email }], NOT: { id: admin.id } } : { email, NOT: { id: admin.id } },
      })
      if (existing) return res.status(409).json({ success: false, error: 'Bu login allaqachon ishlatilmoqda' })
      if (isPhone) { updateData.phone = phone; updateData.email = email }
      else { updateData.email = email; updateData.phone = null }
    }

    if (newPassword?.length >= 6) {
      updateData.passwordHash = await bcrypt.hash(newPassword, 12)
      updateData.passwordChangedAt = new Date()
    }

    await prisma.user.update({ where: { id: req.params.id }, data: updateData })
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'admin_update_org_admin', entityType: 'User', entityId: req.params.id, ipAddress: req.ip },
    }).catch(() => {})

    res.json({ success: true, message: 'Admin ma\'lumotlari yangilandi' })
  } catch (err) { next(err) }
}
