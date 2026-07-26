import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getCurrentMonth } from '../lib/months'

// Oxirgi N oy ro'yxati: ["2026-01", ...]
function lastMonths(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d)
    m.setMonth(m.getMonth() - i)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * GET /reports/overview
 * Rahbar uchun: oylik yig'im dinamikasi, tuman bo'yicha, inspektor samaradorligi.
 *
 * Barcha og'ir hisob-kitob DB tomonida (groupBy/aggregate) bajariladi — ilgari
 * 6 oylik BARCHA to'lov va BARCHA tashkilot xotiraga yuklanardi.
 */
export async function getReportsOverview(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds, id: userId } = req.ekoUser!

    // Inspektor va boshliq (supervisor) faqat o'z tumanlarini ko'radi; admin — hammasini
    const entityWhere: any = { orgId }
    if (role !== 'admin') entityWhere.districtId = { in: districtIds }
    const activeWhere = { ...entityWhere, status: 'active' }

    const months = lastMonths(6)
    const currentMonth = getCurrentMonth()
    const paymentScope = { entity: entityWhere, month: { in: months } }

    // ── 1. Oylik yig'im dinamikasi (oxirgi 6 oy) — DB tomonida guruhlanadi ──
    const monthGroups = await (prisma as any).ekoHisobPayment.groupBy({
      by: ['month'],
      where: paymentScope,
      _sum: { amount: true },
    })
    const byMonth = new Map<string, number>(
      monthGroups.map((g: any) => [g.month as string, g._sum.amount || 0]),
    )
    const monthlyTrend = months.map(m => ({
      month: m,
      label: new Date(m + '-01').toLocaleDateString('uz-UZ', { month: 'short', year: '2-digit' }),
      collected: byMonth.get(m) || 0,
    }))

    // ── 2. Tuman bo'yicha (joriy oy yig'im + to'lagan/qarzdor soni) ──
    // Tuman ro'yxati kichik (o'nlab), shuning uchun tuman bo'yicha aylanish arzon.
    const districts = await (prisma as any).ekoHisobDistrict.findMany({
      where: role === 'admin' ? { orgId } : { orgId, id: { in: districtIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const byDistrict = await Promise.all(districts.map(async (d: any) => {
      const dWhere = { ...activeWhere, districtId: d.id }
      const [totalCnt, paidCnt, collectedAgg] = await Promise.all([
        (prisma as any).ekoHisobLegalEntity.count({ where: dWhere }),
        (prisma as any).ekoHisobLegalEntity.count({
          where: { ...dWhere, payments: { some: { month: currentMonth } } },
        }),
        (prisma as any).ekoHisobPayment.aggregate({
          where: { entity: dWhere, month: currentMonth },
          _sum: { amount: true },
        }),
      ])
      return {
        name: d.name,
        total: totalCnt,
        paid: paidCnt,
        unpaid: totalCnt - paidCnt,
        collected: collectedAgg._sum.amount || 0,
        payRate: totalCnt > 0 ? Math.round(paidCnt * 100 / totalCnt) : 0,
      }
    }))
    byDistrict.sort((a, b) => b.collected - a.collected)

    // ── 3. Inspektor samaradorligi (6 oy yig'im) ──
    // MUHIM: inspektorga ochiq shaxsiy reyting KO'RSATILMAYDI — xodimlar o'rtasida
    // ziddiyat keltiradi. Inspektor faqat o'z natijasini va jamoa o'rtachasini
    // ko'radi; to'liq ro'yxat faqat admin/boshliq uchun.
    const inspectorGroups = await (prisma as any).ekoHisobPayment.groupBy({
      by: ['receivedBy'],
      where: paymentScope,
      _sum: { amount: true },
      _count: { _all: true },
    })
    const inspectors = await (prisma as any).ekoHisobUser.findMany({
      where: { orgId, role: 'inspector', isMirror: false },
      select: { id: true, fullName: true },
    })
    const collById = new Map<string, { collected: number; payments: number }>(
      inspectorGroups.map((g: any) => [
        g.receivedBy as string,
        { collected: g._sum.amount || 0, payments: g._count._all || 0 },
      ]),
    )
    const allInspectorRows = inspectors
      .map((u: any) => ({
        id: u.id,
        name: u.fullName,
        collected: collById.get(u.id)?.collected ?? 0,
        payments: collById.get(u.id)?.payments ?? 0,
      }))
      .filter((i: any) => i.collected > 0)
      .sort((a: any, b: any) => b.collected - a.collected)

    const teamAverage = allInspectorRows.length > 0
      ? Math.round(allInspectorRows.reduce((s: number, i: any) => s + i.collected, 0) / allInspectorRows.length)
      : 0

    let byInspector: any[]
    let inspectorSelf: any = null
    if (role === 'inspector') {
      // O'z natijasi + jamoa o'rtachasi (boshqalarning ismi ko'rinmaydi)
      const self = allInspectorRows.find((i: any) => i.id === userId)
      inspectorSelf = {
        collected: self?.collected ?? 0,
        payments: self?.payments ?? 0,
        teamAverage,
        inspectorCount: allInspectorRows.length,
      }
      byInspector = []
    } else {
      byInspector = allInspectorRows.map(({ id, ...rest }: any) => rest)
    }

    // ── Umumiy KPI ──
    const [collected6mAgg, collectedNowAgg, activeEntities, expectedFixedAgg] = await Promise.all([
      (prisma as any).ekoHisobPayment.aggregate({ where: paymentScope, _sum: { amount: true } }),
      (prisma as any).ekoHisobPayment.aggregate({
        where: { entity: entityWhere, month: currentMonth }, _sum: { amount: true },
      }),
      (prisma as any).ekoHisobLegalEntity.count({ where: activeWhere }),
      (prisma as any).ekoHisobLegalEntity.aggregate({
        where: { ...activeWhere, billingMode: 'monthly_fixed' },
        _sum: { monthlyFee: true },
      }),
    ])
    const totalCollected6m = collected6mAgg._sum.amount || 0
    const collectedThisMonth = collectedNowAgg._sum.amount || 0
    const expectedFixed = expectedFixedAgg._sum.monthlyFee || 0

    // Kutilayotgan oylik = belgilangan oylik + shu oyda bajarilgan talon ishlari.
    // Ilgari faqat monthly_fixed olinardi, yig'im esa BARCHA rejimni qamrab olardi —
    // shuning uchun collectRate 100% dan oshib ketardi va ma'nosini yo'qotgan edi.
    const monthStart = new Date(currentMonth + '-01T00:00:00.000Z')
    const monthEnd = new Date(monthStart)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)

    const [talonAgg, openCharges, unpaidTalons] = await Promise.all([
      (prisma as any).ekoHisobTalon.aggregate({
        where: { entity: entityWhere, date: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      }),
      (prisma as any).ekoHisobCharge.aggregate({
        where: { entity: entityWhere, status: { in: ['open', 'partial'] } },
        _sum: { expectedAmount: true, paidAmount: true },
      }),
      (prisma as any).ekoHisobTalon.aggregate({
        where: { entity: entityWhere, paid: false },
        _sum: { amount: true },
      }),
    ])
    const expectedTalon = talonAgg._sum.amount || 0
    const expectedMonthly = expectedFixed + expectedTalon
    const totalDebt = Math.max(0,
      (openCharges._sum.expectedAmount || 0) - (openCharges._sum.paidAmount || 0),
    ) + (unpaidTalons._sum.amount || 0)

    res.json({
      success: true,
      data: {
        kpi: {
          activeEntities,
          collectedThisMonth,
          expectedMonthly,
          expectedFixed,
          expectedTalon,
          totalDebt,
          collectRate: expectedMonthly > 0
            ? Math.min(100, Math.round(collectedThisMonth * 100 / expectedMonthly))
            : 0,
          totalCollected6m,
        },
        monthlyTrend,
        byDistrict,
        byInspector,
        inspectorSelf,
        currentMonth,
      },
    })
  } catch (err) { next(err) }
}
