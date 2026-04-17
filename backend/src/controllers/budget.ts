import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { getOrgFilter, applyNarrowedBranchFilter, resolveOrgId } from '../lib/orgFilter'

const CATEGORIES = ['fuel', 'maintenance', 'expense', 'total'] as const

/** GET /api/budget?year=2026 */
export async function getBudgets(req: AuthRequest, res: Response) {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()
  const orgId = await resolveOrgId(req.user!)
  if (!orgId) return res.json({ plans: [], year })

  const plans = await (prisma as any).budgetPlan.findMany({
    where: { orgId, year },
    orderBy: [{ month: 'asc' }, { category: 'asc' }],
  })
  res.json({ plans, year })
}

/** POST /api/budget — upsert bir yozuv */
export async function upsertBudget(req: AuthRequest, res: Response) {
  const { year, month, category, amount, branchId } = req.body
  if (!year || month === undefined || !category || amount === undefined) {
    return res.status(400).json({ error: 'year, month, category, amount majburiy' })
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "category: fuel | maintenance | expense | total" })
  }
  const orgId = await resolveOrgId(req.user!)
  if (!orgId) return res.status(403).json({ error: "Ruxsat yo'q" })

  const plan = await (prisma as any).budgetPlan.upsert({
    where: { orgId_year_month_category_branchId: { orgId, year: Number(year), month: Number(month), category, branchId: branchId ?? null } },
    create: { orgId, year: Number(year), month: Number(month), category, amount: Number(amount), branchId: branchId ?? null },
    update: { amount: Number(amount) },
  })
  res.json(plan)
}

/** GET /api/budget/actual?year=2026 — haqiqiy xarajatlar vs byudjet */
export async function getBudgetActual(req: AuthRequest, res: Response) {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()
  const { branchId } = req.query as Record<string, string>
  const filter = await getOrgFilter(req.user!)
  const narrowed = applyNarrowedBranchFilter(filter, branchId || undefined)
  const orgId = await resolveOrgId(req.user!)

  const fromDate = new Date(`${year}-01-01T00:00:00Z`)
  const toDate = new Date(`${year}-12-31T23:59:59Z`)

  const vWhere: any = { status: 'active' }
  if (narrowed !== undefined) vWhere.branchId = narrowed
  const vehicleIds = (await prisma.vehicle.findMany({ where: vWhere, select: { id: true } })).map(v => v.id)

  const [maintenances, fuelRecs, expenses] = vehicleIds.length > 0 ? await Promise.all([
    prisma.maintenanceRecord.findMany({
      where: { vehicleId: { in: vehicleIds }, installationDate: { gte: fromDate, lte: toDate } },
      select: { installationDate: true, cost: true, laborCost: true },
    }),
    prisma.fuelRecord.findMany({
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: fromDate, lte: toDate } },
      select: { refuelDate: true, cost: true },
    }),
    prisma.expense.findMany({
      where: { vehicleId: { in: vehicleIds }, expenseDate: { gte: fromDate, lte: toDate } },
      select: { expenseDate: true, amount: true },
    }),
  ]) : [[], [], []]

  // Oylik haqiqiy xarajatlar
  const monthly: Record<number, { fuel: number; maintenance: number; expense: number }> = {}
  for (let m = 1; m <= 12; m++) monthly[m] = { fuel: 0, maintenance: 0, expense: 0 }

  for (const r of maintenances) { const m = new Date(r.installationDate).getMonth() + 1; monthly[m].maintenance += Number(r.cost) + Number(r.laborCost) }
  for (const r of fuelRecs) { const m = new Date(r.refuelDate).getMonth() + 1; monthly[m].fuel += Number(r.cost) }
  for (const r of expenses) { const m = new Date(r.expenseDate).getMonth() + 1; monthly[m].expense += Number(r.amount) }

  // Byudjet rejalari
  const plans = orgId ? await (prisma as any).budgetPlan.findMany({ where: { orgId, year } }) : []
  const planMap: Record<string, number> = {}
  for (const p of plans) planMap[`${p.month}_${p.category}`] = Number(p.amount)

  const result = Object.entries(monthly).map(([mo, actual]) => {
    const m = Number(mo)
    const totalActual = actual.fuel + actual.maintenance + actual.expense
    return {
      month: m,
      actual: {
        fuel: Math.round(actual.fuel),
        maintenance: Math.round(actual.maintenance),
        expense: Math.round(actual.expense),
        total: Math.round(totalActual),
      },
      budget: {
        fuel: planMap[`${m}_fuel`] ?? null,
        maintenance: planMap[`${m}_maintenance`] ?? null,
        expense: planMap[`${m}_expense`] ?? null,
        total: planMap[`${m}_total`] ?? null,
      },
      overBudget: {
        fuel: planMap[`${m}_fuel`] ? actual.fuel > planMap[`${m}_fuel`] : false,
        maintenance: planMap[`${m}_maintenance`] ? actual.maintenance > planMap[`${m}_maintenance`] : false,
        total: planMap[`${m}_total`] ? totalActual > planMap[`${m}_total`] : false,
      },
    }
  })

  const yearlyActual = { fuel: 0, maintenance: 0, expense: 0, total: 0 }
  for (const r of result) {
    yearlyActual.fuel += r.actual.fuel; yearlyActual.maintenance += r.actual.maintenance
    yearlyActual.expense += r.actual.expense; yearlyActual.total += r.actual.total
  }
  const yearlyBudget = {
    fuel: planMap[`0_fuel`] ?? null,
    maintenance: planMap[`0_maintenance`] ?? null,
    total: planMap[`0_total`] ?? null,
  }

  res.json({ year, months: result, yearly: { actual: yearlyActual, budget: yearlyBudget } })
}
