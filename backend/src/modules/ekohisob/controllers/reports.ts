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
 * Rahbar uchun: oylik yig'im dinamikasi, tuman bo'yicha, inspektor samaradorligi
 */
export async function getReportsOverview(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!

    // Inspektor va boshliq (supervisor) faqat o'z tumanlarini ko'radi; admin — hammasini
    const entityWhere: any = { orgId }
    if (role !== 'admin') entityWhere.districtId = { in: districtIds }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      select: { id: true, districtId: true, monthlyFee: true, billingMode: true, status: true,
        district: { select: { id: true, name: true } } },
    })
    const entityIds = entities.map((e: any) => e.id)
    const months = lastMonths(6)
    const currentMonth = getCurrentMonth()

    // 6 oylik barcha to'lovlar
    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: { in: entityIds }, month: { in: months } },
      select: { amount: true, month: true, entityId: true, receivedBy: true, paidAt: true },
    })

    // ── 1. Oylik yig'im dinamikasi (oxirgi 6 oy) ──
    const byMonth: Record<string, number> = {}
    months.forEach(m => byMonth[m] = 0)
    for (const p of payments) byMonth[p.month] = (byMonth[p.month] || 0) + p.amount
    const monthlyTrend = months.map(m => ({
      month: m,
      label: new Date(m + '-01').toLocaleDateString('uz-UZ', { month: 'short', year: '2-digit' }),
      collected: byMonth[m] || 0,
    }))

    // ── 2. Tuman bo'yicha (joriy oy yig'im + qarzdorlar) ──
    const entByDistrict = new Map<string, { name: string; total: number; paid: number; collected: number }>()
    for (const e of entities) {
      if (e.status !== 'active') continue
      const did = e.districtId
      if (!entByDistrict.has(did)) entByDistrict.set(did, { name: e.district?.name ?? '—', total: 0, paid: 0, collected: 0 })
      entByDistrict.get(did)!.total++
    }
    // Joriy oy to'lovlari tuman bo'yicha
    const entToDistrict = new Map<string, string>(entities.map((e: any) => [e.id as string, e.districtId as string]))
    const paidThisMonthEnts = new Set<string>()
    for (const p of payments) {
      if (p.month !== currentMonth) continue
      const did = entToDistrict.get(p.entityId)
      if (did && entByDistrict.has(did)) {
        entByDistrict.get(did)!.collected += p.amount
        if (!paidThisMonthEnts.has(p.entityId)) { entByDistrict.get(did)!.paid++; paidThisMonthEnts.add(p.entityId) }
      }
    }
    const byDistrict = Array.from(entByDistrict.values()).map(d => ({
      name: d.name, total: d.total, paid: d.paid, unpaid: d.total - d.paid,
      collected: d.collected,
      payRate: d.total > 0 ? Math.round(d.paid * 100 / d.total) : 0,
    })).sort((a, b) => b.collected - a.collected)

    // ── 3. Inspektor samaradorligi (6 oy yig'im) ──
    const inspectors = await (prisma as any).ekoHisobUser.findMany({
      where: { orgId, role: 'inspector' },
      select: { id: true, fullName: true },
    })
    const collByInspector = new Map<string, number>()
    const countByInspector = new Map<string, number>()
    for (const p of payments) {
      if (!p.receivedBy) continue
      collByInspector.set(p.receivedBy, (collByInspector.get(p.receivedBy) || 0) + p.amount)
      countByInspector.set(p.receivedBy, (countByInspector.get(p.receivedBy) || 0) + 1)
    }
    const byInspector = inspectors.map((u: any) => ({
      name: u.fullName,
      collected: collByInspector.get(u.id) || 0,
      payments: countByInspector.get(u.id) || 0,
    })).filter((i: any) => i.collected > 0).sort((a: any, b: any) => b.collected - a.collected)

    // ── Umumiy KPI ──
    const totalCollected6m = payments.reduce((s: number, p: any) => s + p.amount, 0)
    const collectedThisMonth = payments.filter((p: any) => p.month === currentMonth).reduce((s: number, p: any) => s + p.amount, 0)
    const activeEntities = entities.filter((e: any) => e.status === 'active').length
    // Kutilayotgan oylik (monthly_fixed yig'indisi)
    const expectedMonthly = entities
      .filter((e: any) => e.status === 'active' && e.billingMode === 'monthly_fixed')
      .reduce((s: number, e: any) => s + (e.monthlyFee || 0), 0)

    res.json({
      success: true,
      data: {
        kpi: {
          activeEntities,
          collectedThisMonth,
          expectedMonthly,
          collectRate: expectedMonthly > 0 ? Math.round(collectedThisMonth * 100 / expectedMonthly) : 0,
          totalCollected6m,
        },
        monthlyTrend,
        byDistrict,
        byInspector,
        currentMonth,
      },
    })
  } catch (err) { next(err) }
}
