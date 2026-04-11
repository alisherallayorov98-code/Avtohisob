import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { AuthRequest, successResponse } from '../types'
import { sendInvoiceEmail } from '../lib/mailer'

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

// ─── Current Subscription ─────────────────────────────────────────────────────

export async function getMySubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const subscription = await (prisma as any).subscription.findUnique({
      where: { userId: req.user!.id },
      include: {
        plan: true,
        invoices: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    })
    res.json(successResponse(subscription))
  } catch (err) { next(err) }
}

// ─── Upgrade Plan ─────────────────────────────────────────────────────────────

export async function upgradePlan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { planId, provider = 'manual', billingCycle = 'monthly' } = req.body
    if (!planId) throw new AppError('planId talab qilinadi', 400)

    const plan = await (prisma as any).plan.findUnique({ where: { id: planId } })
    if (!plan) throw new AppError('Tarif topilmadi', 404)

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + (billingCycle === 'yearly' ? 12 : 1))

    const amount = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly

    const existing = await (prisma as any).subscription.findUnique({ where: { userId: req.user!.id } })

    let subscription
    if (existing) {
      subscription = await (prisma as any).subscription.update({
        where: { userId: req.user!.id },
        data: {
          planId,
          status: 'active',
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
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          provider,
        },
        include: { plan: true },
      })
    }

    // Create invoice record
    const invoice = await (prisma as any).invoice.create({
      data: {
        subscriptionId: subscription.id,
        amount,
        currency: 'UZS',
        status: 'paid',
        provider,
        paidAt: now,
        dueDate: periodEnd,
      },
    })

    // Send invoice email (non-blocking)
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (user) {
      const fmt = new Intl.NumberFormat('uz-UZ').format(Number(amount))
      sendInvoiceEmail(
        user.email,
        user.fullName,
        `${fmt} UZS`,
        plan.name,
        periodEnd.toLocaleDateString('uz-UZ'),
      ).catch(() => {})
    }

    res.json(successResponse({ subscription, invoice }, 'Tarif muvaffaqiyatli yangilandi'))
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
    const sub = await (prisma as any).subscription.findUnique({
      where: { userId: req.user!.id },
      include: { plan: true },
    })
    const plan = sub?.plan

    const [vehicleCount, branchCount, userCount] = await Promise.all([
      prisma.vehicle.count(),
      prisma.branch.count(),
      prisma.user.count({ where: { role: { not: 'super_admin' } } }),
    ])

    res.json(successResponse({
      vehicles: { current: vehicleCount, max: plan ? Number(plan.maxVehicles) : 5 },
      branches: { current: branchCount, max: plan ? Number(plan.maxBranches) : 1 },
      users:    { current: userCount,   max: plan ? Number(plan.maxUsers)    : 3 },
      plan:     plan ? { name: plan.name, type: plan.type } : { name: 'Bepul', type: 'free' },
    }))
  } catch (err) { next(err) }
}

// ─── Admin: seed default plans ────────────────────────────────────────────────

export async function seedPlans(req: AuthRequest, res: Response, next: NextFunction) {
  try {
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
