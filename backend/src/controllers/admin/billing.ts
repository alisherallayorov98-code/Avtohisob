import { Response, NextFunction } from 'express'
import { prisma } from '../../lib/prisma'
import { AuthRequest } from '../../types'

export async function listAdminSubscriptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, page = '1', limit = '20' } = req.query
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: any = {}
    if (status) where.status = status

    const [subs, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { fullName: true, email: true, isActive: true, branch: { select: { name: true } } } },
          plan: true,
          invoices: { where: { status: 'paid' }, select: { amount: true } },
        },
      }),
      prisma.subscription.count({ where }),
    ])

    res.json({
      success: true,
      data: subs.map(s => ({
        id: s.id,
        orgName: s.user.branch?.name || s.user.fullName,
        adminName: s.user.fullName,
        adminEmail: s.user.email,
        isActive: s.user.isActive,
        plan: s.plan,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        totalPaid: s.invoices.reduce((sum, i) => sum + Number(i.amount), 0),
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
