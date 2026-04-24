import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'
import { AppError } from '../../middleware/errorHandler'
import { sendInvoiceEmail } from '../../lib/mailer'

export async function listAdminSubscriptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, page = '1', limit = '20' } = req.query
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: any = {}
    if (status) where.status = status

    const [subs, total] = await Promise.all([
      (prisma as any).subscription.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { fullName: true, email: true, isActive: true, maxPlanType: true, branch: { select: { name: true } } } },
          plan: true,
          invoices: { where: { status: 'paid' }, select: { amount: true } },
        },
      }),
      prisma.subscription.count({ where }),
    ])

    res.json({
      success: true,
      data: (subs as any[]).map((s: any) => ({
        id: s.id,
        userId: s.userId,
        orgName: s.user.branch?.name || s.user.fullName,
        adminName: s.user.fullName,
        adminEmail: s.user.email,
        isActive: s.user.isActive,
        maxPlanType: s.user.maxPlanType || 'free',
        plan: s.plan,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        totalPaid: s.invoices.reduce((sum: number, i: any) => sum + Number(i.amount), 0),
        createdAt: s.createdAt,
      })),
      pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string), pages: Math.ceil(total / parseInt(limit as string)) },
    })
  } catch (err) { next(err) }
}

export async function getRevenueAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(d)
    }

    const [totalRevenue, mrr, invoicesByProvider, activeSubscriptions, canceledThisMonth, planBreakdown, paidInvoices] = await Promise.all([
      prisma.invoice.aggregate({ _sum: { amount: true }, where: { status: 'paid' } }),
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'paid', paidAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      }),
      prisma.invoice.groupBy({
        by: ['provider'],
        _sum: { amount: true },
        where: { status: 'paid' },
      }),
      prisma.subscription.count({ where: { status: 'active' } }),
      prisma.subscription.count({
        where: { status: 'canceled', updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      }),
      prisma.subscription.groupBy({
        by: ['planId'],
        _count: true,
        where: { status: 'active' },
      }),
      prisma.invoice.findMany({
        where: { status: 'paid' },
        include: { subscription: { include: { plan: { select: { name: true, type: true } } } } },
        orderBy: { paidAt: 'desc' },
        take: 20,
      }),
    ])

    const monthlyData = await Promise.all(months.map(async (m) => {
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 1)
      const agg = await prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'paid', paidAt: { gte: m, lt: end } },
      })
      return {
        month: m.toLocaleString('uz-UZ', { month: 'short', year: '2-digit' }),
        revenue: Number(agg._sum.amount || 0),
      }
    }))

    const plans = await prisma.plan.findMany()
    const planMap = Object.fromEntries(plans.map(p => [p.id, p]))

    res.json({
      success: true,
      data: {
        totalRevenue: Number(totalRevenue._sum.amount || 0),
        mrr: Number(mrr._sum.amount || 0),
        arr: Number(mrr._sum.amount || 0) * 12,
        activeSubscriptions,
        canceledThisMonth,
        churnRate: activeSubscriptions > 0 ? ((canceledThisMonth / activeSubscriptions) * 100).toFixed(1) : '0',
        byProvider: invoicesByProvider.map(p => ({ provider: p.provider, total: Number(p._sum.amount || 0) })),
        byPlan: planBreakdown.map(p => ({ plan: planMap[p.planId]?.name || p.planId, count: p._count })),
        monthlyChart: monthlyData,
        recentInvoices: paidInvoices.slice(0, 10).map(i => ({
          id: i.id,
          amount: Number(i.amount),
          currency: i.currency,
          provider: i.provider,
          paidAt: i.paidAt,
          planName: i.subscription.plan?.name,
        })),
      },
    })
  } catch (err) { next(err) }
}

export async function listAdminInvoices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, page = '1', limit = '20' } = req.query
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: any = {}
    if (status) where.status = status

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: {
              user: { select: { fullName: true, email: true, branch: { select: { name: true } } } },
              plan: { select: { name: true } },
            },
          },
        },
      }),
      prisma.invoice.count({ where }),
    ])

    res.json({
      success: true,
      data: invoices.map(i => ({
        id: i.id,
        orgName: i.subscription.user.branch?.name || i.subscription.user.fullName,
        adminEmail: i.subscription.user.email,
        planName: i.subscription.plan?.name,
        amount: Number(i.amount),
        currency: i.currency,
        status: i.status,
        provider: i.provider,
        paidAt: i.paidAt,
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      })),
      pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string), pages: Math.ceil(total / parseInt(limit as string)) },
    })
  } catch (err) { next(err) }
}

// ─── Approve pending subscription ────────────────────────────────────────────
export async function approveSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params

    const sub = await (prisma as any).subscription.findUnique({
      where: { id },
      include: { plan: true, user: true },
    })
    if (!sub) throw new AppError('Obuna topilmadi', 404)
    // Both 'trialing' (new system) and 'pending' (legacy) can be approved
    if (!['trialing', 'pending'].includes(sub.status)) {
      throw new AppError('Faqat sinov yoki kutilayotgan obunalarni tasdiqlash mumkin', 400)
    }

    const now = new Date()
    const newPeriodEnd = new Date(now)
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1) // 1 month from approval

    // Race-safe approval: updateMany with status-check prevents double-approve.
    // If another super admin approved first, count === 0 and we fail cleanly.
    const result = await prisma.$transaction(async (tx) => {
      const transition = await (tx as any).subscription.updateMany({
        where: { id, status: { in: ['trialing', 'pending'] } },
        data: { status: 'active', currentPeriodStart: now, currentPeriodEnd: newPeriodEnd, updatedAt: now },
      })
      if (transition.count === 0) {
        throw new AppError('Bu obuna allaqachon tasdiqlangan yoki bekor qilingan', 400)
      }

      // Update user's billing ceiling to match the approved plan
      await (tx as any).user.update({
        where: { id: sub.userId },
        data: { maxPlanType: sub.plan.type },
      })

      // Mark latest pending invoice as paid (safe: only one approval reaches here)
      const inv = await (tx as any).invoice.findFirst({
        where: { subscriptionId: id, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      })
      if (inv) {
        await (tx as any).invoice.update({
          where: { id: inv.id },
          data: { status: 'paid', paidAt: now },
        })
      }

      const updated = await (tx as any).subscription.findUnique({
        where: { id },
        include: { plan: true },
      })
      return { updated, invoice: inv }
    })

    if (result.invoice) {
      const fmt = new Intl.NumberFormat('uz-UZ').format(Number(result.invoice.amount))
      sendInvoiceEmail(sub.user.email, sub.user.fullName, `${fmt} UZS`, sub.plan.name,
        new Date(newPeriodEnd).toLocaleDateString('uz-UZ')).catch(() => {})
    }

    res.json({ success: true, data: result.updated, message: 'Obuna tasdiqlandi va faollashtirildi' })
  } catch (err) { next(err) }
}

// ─── Super admin: set billing ceiling for a user ─────────────────────────────
// PATCH /admin/users/:id/max-plan-type  { maxPlanType: 'starter' }

export async function setMaxPlanType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { maxPlanType } = req.body
    const allowed = ['free', 'starter', 'professional', 'enterprise']
    if (!allowed.includes(maxPlanType)) throw new AppError(`Noto'g'ri tarif turi. Mumkin: ${allowed.join(', ')}`, 400)

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    if (user.role === 'super_admin') throw new AppError("Super adminga tarif cheklovi qo'yib bo'lmaydi", 400)

    await (prisma as any).user.update({ where: { id }, data: { maxPlanType } })

    res.json({ success: true, message: `"${user.fullName}" uchun maksimal tarif: "${maxPlanType}" ga o'rnatildi` })
  } catch (err) { next(err) }
}

// ─── Reject pending subscription ─────────────────────────────────────────────
export async function rejectSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params

    const sub = await (prisma as any).subscription.findUnique({ where: { id } })
    if (!sub) throw new AppError('Obuna topilmadi', 404)
    if (!['trialing', 'pending'].includes(sub.status)) {
      throw new AppError('Faqat sinov yoki kutilayotgan obunalarni rad etish mumkin', 400)
    }

    // Race-safe: only transition if still in trialing/pending
    await prisma.$transaction(async (tx) => {
      const transition = await (tx as any).subscription.updateMany({
        where: { id, status: { in: ['trialing', 'pending'] } },
        data: { status: 'canceled' },
      })
      if (transition.count === 0) {
        throw new AppError('Bu obuna allaqachon ko\'rib chiqilgan', 400)
      }
      await (tx as any).invoice.updateMany({
        where: { subscriptionId: id, status: 'pending' },
        data: { status: 'failed' },
      })
    })

    res.json({ success: true, message: 'Obuna rad etildi' })
  } catch (err) { next(err) }
}
