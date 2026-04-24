import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { AuthRequest, successResponse } from '../types'
import { sendInvoiceEmail } from '../lib/mailer'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

const PLAN_ORDER = ['free', 'starter', 'professional', 'enterprise']
const PLAN_NAMES: Record<string, string> = { free: 'Bepul', starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' }

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function listPlans(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const plans = await (prisma as any).plan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    })
    res.json(successResponse(plans))
  } catch (err) { next(err) }
}

// ─── Resolve org admin's user ID for any role ────────────────────────────────
async function resolveAdminId(userId: string, role: string, branchId?: string | null): Promise<string | null> {
  if (role === 'super_admin') return null
  if (role === 'admin') return userId
  if (!branchId) return null
  const userBranch = await (prisma.branch as any).findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  })
  const orgId = userBranch?.organizationId ?? branchId
  // Admin may be in root branch OR any sub-branch — look up via branch.organizationId too
  const admin = await prisma.user.findFirst({
    where: {
      role: 'admin',
      isActive: true,
      OR: [
        { branchId: orgId },
        { branch: { organizationId: orgId } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })
  return admin?.id ?? null
}

// ─── Current Subscription ─────────────────────────────────────────────────────

export async function getMySubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const adminId = await resolveAdminId(req.user!.id, req.user!.role, req.user!.branchId)
    if (!adminId) return res.json(successResponse(null))

    const [subscription, adminUser] = await Promise.all([
      (prisma as any).subscription.findFirst({
        where: { userId: adminId },
        orderBy: { createdAt: 'desc' },
        include: {
          plan: true,
          invoices: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      }),
      prisma.user.findUnique({
        where: { id: adminId },
        select: { maxPlanType: true },
      }),
    ])
    res.json(successResponse(subscription ? { ...subscription, maxPlanType: (adminUser as any)?.maxPlanType || 'free' } : null))
  } catch (err) { next(err) }
}

// ─── Upgrade Plan ─────────────────────────────────────────────────────────────

export async function upgradePlan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { planId, provider = 'manual', billingCycle = 'monthly' } = req.body
    if (!planId) throw new AppError('planId talab qilinadi', 400)

    const plan = await (prisma as any).plan.findUnique({ where: { id: planId } })
    if (!plan) throw new AppError('Tarif topilmadi', 404)

    // Ceiling check: admin can only select plans ≤ their maxPlanType
    if (req.user!.role === 'admin') {
      const maxIdx = PLAN_ORDER.indexOf(req.user!.maxPlanType || 'free')
      const planIdx = PLAN_ORDER.indexOf(plan.type)
      if (planIdx > maxIdx) {
        const ceilingName = PLAN_NAMES[req.user!.maxPlanType] || 'Bepul'
        throw new AppError(
          `Sizga ruxsat berilgan maksimal tarif: "${ceilingName}". ` +
          `"${plan.name}" tarifiga o'tish uchun super admin bilan bog'laning.`,
          403
        )
      }
    }

    // Downgrade protection: check if current usage exceeds new plan limits
    const usageFilter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(usageFilter)
    const userWhere: any = { role: { not: 'super_admin' } }
    if (usageFilter.type === 'single') userWhere.branchId = (usageFilter as any).branchId
    else if (usageFilter.type === 'org') userWhere.branchId = { in: (usageFilter as any).orgBranchIds }

    if (plan.maxVehicles !== -1) {
      const vehicleCount = await prisma.vehicle.count(bv !== undefined ? { where: { branchId: bv } } : undefined)
      if (vehicleCount > plan.maxVehicles)
        throw new AppError(`Hozir ${vehicleCount} ta avtomobil bor. "${plan.name}" tarifida maksimum ${plan.maxVehicles} ta. Avval avtomobillar sonini kamaytiring.`, 400)
    }
    if (plan.maxBranches !== -1) {
      const branchCount = usageFilter.type === 'org'
        ? (usageFilter as any).orgBranchIds.length
        : usageFilter.type === 'single' ? 1 : await prisma.branch.count()
      if (branchCount > plan.maxBranches)
        throw new AppError(`Hozir ${branchCount} ta filial bor. "${plan.name}" tarifida maksimum ${plan.maxBranches} ta. Avval filiallarni o'chiring.`, 400)
    }
    if (plan.maxUsers !== -1) {
      const userCount = await prisma.user.count({ where: userWhere })
      if (userCount > plan.maxUsers)
        throw new AppError(`Hozir ${userCount} ta foydalanuvchi bor. "${plan.name}" tarifida maksimum ${plan.maxUsers} ta. Avval foydalanuvchilarni o'chiring.`, 400)
    }

    const now = new Date()
    const isFree = Number(plan.priceMonthly) === 0
    // Free plan → active immediately (no payment needed)
    // Paid plans → 30-day trial, blocked after expiry unless super admin confirms payment
    const status = isFree ? 'active' : 'trialing'
    const periodEnd = new Date(now)
    if (isFree) {
      periodEnd.setFullYear(periodEnd.getFullYear() + 10) // free plan — effectively permanent
    } else {
      periodEnd.setDate(periodEnd.getDate() + 30) // 30-day trial window
    }

    const amount = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly

    const existing = await (prisma as any).subscription.findUnique({ where: { userId: req.user!.id } })

    let subscription
    if (existing) {
      subscription = await (prisma as any).subscription.update({
        where: { userId: req.user!.id },
        data: {
          planId,
          status,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          provider,
          updatedAt: now,
        },
        include: { plan: true },
      })
    } else {
      subscription = await (prisma as any).subscription.create({
        data: {
          userId: req.user!.id,
          planId,
          status,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          provider,
        },
        include: { plan: true },
      })
    }

    // Invoice: only create for paid plans (free plan = $0 invoice, skip)
    let invoice = null
    if (!isFree) {
      invoice = await (prisma as any).invoice.create({
        data: {
          subscriptionId: subscription.id,
          amount,
          currency: 'UZS',
          status: 'pending',
          provider,
          paidAt: null,
          dueDate: periodEnd,
        },
      })
    }

    const message = isFree
      ? `"${subscription.plan.name}" tarifi faollashtirildi`
      : `"${subscription.plan.name}" tarifi 30 kunlik sinov rejimida faollashtirildi. To'lovni amalga oshirib, admin tasdiqlashini kuting.`

    res.json(successResponse({ subscription, invoice }, message))
  } catch (err) { next(err) }
}

// ─── Cancel Subscription ──────────────────────────────────────────────────────

export async function cancelSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const subscription = await (prisma as any).subscription.findUnique({ where: { userId: req.user!.id } })
    if (!subscription) throw new AppError('Faol obuna topilmadi', 404)

    await (prisma as any).subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    })
    res.json(successResponse(null, 'Obuna joriy davr oxirida bekor qilinadi'))
  } catch (err) { next(err) }
}

// ─── Invoice History ──────────────────────────────────────────────────────────

export async function getInvoices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const subscription = await (prisma as any).subscription.findUnique({ where: { userId: req.user!.id } })
    if (!subscription) return res.json(successResponse([]))

    const invoices = await (prisma as any).invoice.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json(successResponse(invoices))
  } catch (err) { next(err) }
}

// ─── Usage stats ─────────────────────────────────────────────────────────────

export async function getUsage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const adminId = await resolveAdminId(req.user!.id, req.user!.role, req.user!.branchId)
    const sub = adminId
      ? await (prisma as any).subscription.findFirst({
          where: { userId: adminId },
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        })
      : null
    const plan = sub?.plan

    const usageFilter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(usageFilter)

    const userCountWhere: any = { role: { not: 'super_admin' } }
    if (usageFilter.type === 'single') userCountWhere.branchId = (usageFilter as any).branchId
    else if (usageFilter.type === 'org') userCountWhere.branchId = { in: (usageFilter as any).orgBranchIds }

    const [vehicleCount, branchCount, userCount] = await Promise.all([
      prisma.vehicle.count(bv !== undefined ? { where: { branchId: bv } } : undefined),
      bv !== undefined
        ? prisma.branch.count({ where: { id: bv } })
        : prisma.branch.count(),
      prisma.user.count({ where: userCountWhere }),
    ])

    res.json(successResponse({
      vehicles: { current: vehicleCount, max: plan ? Number(plan.maxVehicles) : 5 },
      branches: { current: branchCount, max: plan ? Number(plan.maxBranches) : 1 },
      users:    { current: userCount,   max: plan ? Number(plan.maxUsers)    : 3 },
      plan:     plan ? { name: plan.name, type: plan.type } : { name: 'Bepul', type: 'free' },
    }))
  } catch (err) { next(err) }
}

// ─── Super Admin: list all subscriptions ─────────────────────────────────────

export async function listAllSubscriptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const subscriptions = await (prisma as any).subscription.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        user: { select: { id: true, fullName: true, email: true, role: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    res.json(successResponse(subscriptions))
  } catch (err) { next(err) }
}

// ─── Super Admin: approve subscription (pending → active) ─────────────────────

export async function approveSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const { id } = req.params
    const sub = await (prisma as any).subscription.findUnique({ where: { id } })
    if (!sub) throw new AppError('Obuna topilmadi', 404)

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1) // default 1 month from approval

    const updated = await (prisma as any).subscription.update({
      where: { id },
      data: { status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd },
      include: { plan: true, user: { select: { fullName: true, email: true } } },
    })

    // Mark latest invoice as paid
    await (prisma as any).invoice.updateMany({
      where: { subscriptionId: id, status: 'pending' },
      data: { status: 'paid', paidAt: now },
    })

    res.json(successResponse(updated, `"${updated.user.fullName}" uchun tarif tasdiqlandi`))
  } catch (err) { next(err) }
}

// ─── Super Admin: grant subscription directly (without upgrade request) ───────

export async function grantSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const { userId, planType, billingCycle = 'monthly' } = req.body
    if (!userId || !planType) throw new AppError('userId va planType talab qilinadi', 400)

    const plan = await (prisma as any).plan.findUnique({ where: { type: planType } })
    if (!plan) throw new AppError(`"${planType}" tarifi topilmadi. Avval /billing/seed-plans chaqiring.`, 404)

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + (billingCycle === 'yearly' ? 12 : 1))

    const existing = await (prisma as any).subscription.findUnique({ where: { userId } })
    const subscription = existing
      ? await (prisma as any).subscription.update({
          where: { userId },
          data: { planId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
          include: { plan: true },
        })
      : await (prisma as any).subscription.create({
          data: { userId, planId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd },
          include: { plan: true },
        })

    // Also update the user's billing ceiling to match the granted plan
    await (prisma as any).user.update({ where: { id: userId }, data: { maxPlanType: plan.type } })

    res.json(successResponse(subscription, `"${plan.name}" tarifi berildi`))
  } catch (err) { next(err) }
}

// ─── Admin: filialga tarif belgilash ──────────────────────────────────────────
// POST /billing/branches/:branchId/plan  { planId } — null/empty = meros olish

export async function setBranchPlan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { role } = req.user!
    if (!['admin', 'super_admin'].includes(role)) throw new AppError("Ruxsat yo'q", 403)

    const { branchId } = req.params
    const { planId } = req.body  // null or empty string = remove branch plan (inherit admin's)

    const branch = await prisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw new AppError('Filial topilmadi', 404)

    // Admin can only set plans on their own org's branches
    if (role === 'admin') {
      const filter = await getOrgFilter(req.user!)
      const allowed = filter.type === 'org'
        ? (filter as any).orgBranchIds.includes(branchId)
        : filter.type === 'single' && (filter as any).branchId === branchId
      if (!allowed) throw new AppError("Bu filial sizning tashkilotingizga tegishli emas", 403)

      if (planId) {
        // Branch plan must be ≤ admin's active subscription plan
        const adminSub = await (prisma as any).subscription.findFirst({
          where: { userId: req.user!.id, status: { in: ['active', 'trialing'] } },
          include: { plan: true },
        })
        const adminPlanType = adminSub?.plan?.type || 'free'
        const adminPlanIdx = PLAN_ORDER.indexOf(adminPlanType)

        const branchPlan = await (prisma as any).plan.findUnique({ where: { id: planId } })
        if (!branchPlan) throw new AppError('Tarif topilmadi', 404)
        if (PLAN_ORDER.indexOf(branchPlan.type) > adminPlanIdx) {
          throw new AppError(
            `Filiallarga faqat o'z tarifingizdan ("${PLAN_NAMES[adminPlanType]}") past yoki teng tarif berish mumkin.`, 403
          )
        }
      }
    }

    await prisma.branch.update({
      where: { id: branchId },
      data: { planId: planId || null } as any,
    })

    res.json(successResponse(null, planId ? 'Filial tarifi belgilandi' : 'Filial tarifi olib tashlandi (admin tarifidan meros oladi)'))
  } catch (err) { next(err) }
}

// ─── Admin: seed default plans ────────────────────────────────────────────────

export async function seedPlans(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const plans = [
      {
        name: 'Bepul', type: 'free',
        priceMonthly: 0, priceYearly: 0,
        maxVehicles: 5, maxBranches: 1, maxUsers: 3,
        features: ['Asosiy hisobot', 'AI yoqilgi hisoblagich (5/oy)', 'Email qo\'llab-quvvatlash'],
      },
      {
        name: 'Starter', type: 'starter',
        priceMonthly: 99000, priceYearly: 990000,
        maxVehicles: 20, maxBranches: 2, maxUsers: 10,
        features: ['Barcha bepul imkoniyatlar', 'AI hisoblagich (50/oy)', 'Excel hisobotlar', 'SMS bildirishnomalar'],
      },
      {
        name: 'Professional', type: 'professional',
        priceMonthly: 299000, priceYearly: 2990000,
        maxVehicles: 100, maxBranches: 5, maxUsers: 50,
        features: ['Barcha Starter imkoniyatlar', 'Cheksiz AI tahlil', 'Anomaliya aniqlash', 'Sog\'liq monitoringi', 'API integratsiya'],
      },
      {
        name: 'Enterprise', type: 'enterprise',
        priceMonthly: 799000, priceYearly: 7990000,
        maxVehicles: -1, maxBranches: -1, maxUsers: -1,
        features: ['Cheksiz avtomobillar', 'Cheksiz filiallar', 'Maxsus integratsiya', 'Dedicated support', 'SLA kafolati', 'On-premise variant'],
      },
    ]

    for (const plan of plans) {
      await (prisma as any).plan.upsert({
        where: { type: plan.type },
        update: { ...plan, features: JSON.stringify(plan.features) },
        create: { ...plan, features: JSON.stringify(plan.features) },
      })
    }

    res.json(successResponse(null, 'Tariflar yaratildi'))
  } catch (err) { next(err) }
}

// ─── Super Admin: barcha adminlarga bir marta subscription berish ─────────────
// POST /api/billing/admin/grant-all  { planType: 'professional', months: 12 }
// Subscription yo'q adminlarga avtomatik beradi, borlariga tegmaydi.

export async function grantAllAdmins(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const { planType = 'professional', months = 12 } = req.body

    const plan = await (prisma as any).plan.findUnique({ where: { type: planType } })
    if (!plan) throw new AppError(`"${planType}" tarifi topilmadi. Avval seed-plans chaqiring.`, 404)

    const admins = await prisma.user.findMany({
      where: { role: 'admin', isActive: true },
      select: { id: true, fullName: true, email: true },
    })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + months)

    const results: { user: string; action: string }[] = []

    for (const admin of admins) {
      const existing = await (prisma as any).subscription.findUnique({ where: { userId: admin.id } })
      if (existing && ['active', 'trialing'].includes(existing.status)) {
        results.push({ user: admin.email, action: 'skipped (already active)' })
        continue
      }
      if (existing) {
        await (prisma as any).subscription.update({
          where: { userId: admin.id },
          data: { planId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
        })
        results.push({ user: admin.email, action: `updated → ${plan.name}` })
      } else {
        await (prisma as any).subscription.create({
          data: { userId: admin.id, planId: plan.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd },
        })
        results.push({ user: admin.email, action: `created → ${plan.name}` })
      }
    }

    res.json(successResponse(results, `${results.length} ta admin uchun "${plan.name}" tarifi berildi`))
  } catch (err) { next(err) }
}
