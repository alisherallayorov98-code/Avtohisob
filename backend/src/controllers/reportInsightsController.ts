import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { getOrgFilter, applyNarrowedBranchFilter, resolveOrgId } from '../lib/orgFilter'
import { isSimplifiedView } from '../services/orgSettingsService'
import { reportRange, previousRange } from '../lib/reportRange'
import { computeConsumption } from '../lib/vehicleOverviewMath'
import { buildInsights, pctDelta, Totals, VehicleAgg } from '../lib/reportInsights'

// GET /reports/insights?from&to&branchId
// Tanlangan davr uchun: oldingi teng davr bilan solishtirma + "nimaga e'tibor berish kerak" xulosalari.
// Faqat o'qiydi. Tenant filtri getOrgFilter orqali; faqat tasdiqlangan ta'mirlar hisoblanadi.
export async function getReportInsights(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, branchId } = req.query as any
    const filter = await getOrgFilter(req.user!)
    const bv = applyNarrowedBranchFilter(filter, branchId || undefined)
    const vehicleWhere: any = bv !== undefined ? { branchId: bv } : {}

    const cur = reportRange(from, to)
    // compare=0 — solishtirmasiz (Xulosa tabi: u o'zining "o'tgan oy" bloki bilan solishtiradi, ikki xil raqam chiqmasin)
    const prevR = req.query.compare === '0' ? null : previousRange(from, to)
    const simplified = await isSimplifiedView(await resolveOrgId(req.user!))

    const totalsFor = async (range: { gte?: Date; lte?: Date } | undefined) => {
      const [fuel, maint, exp] = await Promise.all([
        prisma.fuelRecord.groupBy({ by: ['vehicleId'], where: { vehicle: vehicleWhere, ...(range ? { refuelDate: range } : {}) }, _sum: { cost: true } }),
        prisma.maintenanceRecord.groupBy({ by: ['vehicleId'], where: { status: 'approved', ...(simplified ? { isOfficial: true } : {}), vehicle: vehicleWhere, ...(range ? { installationDate: range } : {}) }, _sum: { cost: true, laborCost: true } }),
        prisma.expense.groupBy({ by: ['vehicleId'], where: { vehicle: vehicleWhere, category: { name: { not: 'Texnik xizmat' } }, ...(range ? { expenseDate: range } : {}) }, _sum: { amount: true } }),
      ])
      const per = new Map<string, number>()
      const add = (id: string | null, v: number) => { if (id) per.set(id, (per.get(id) || 0) + v) }
      let f = 0, m = 0, e = 0
      for (const r of fuel) { const v = Number(r._sum.cost) || 0; f += v; add(r.vehicleId, v) }
      for (const r of maint as any[]) { const v = (Number(r._sum?.cost) || 0) + (Number(r._sum?.laborCost) || 0); m += v; add(r.vehicleId, v) }
      for (const r of exp) { const v = Number(r._sum.amount) || 0; e += v; add(r.vehicleId, v) }
      const totals: Totals = { total: f + m + e, fuel: f, maintenance: m, expenses: e }
      return { totals, per }
    }

    const curAgg = await totalsFor(cur)
    const prevAgg = prevR ? await totalsFor(prevR) : null

    // Sarf me'yordan ortiqmi — shu davrdagi to'ldirishlar bo'yicha (fill-to-fill)
    const fills = await prisma.fuelRecord.findMany({
      where: { vehicle: { ...vehicleWhere, fuelNormPer100km: { not: null } }, ...(cur ? { refuelDate: cur } : {}) },
      select: { vehicleId: true, amountLiters: true, odometerReading: true, refuelDate: true },
    })
    const fillsBy = new Map<string, typeof fills>()
    for (const f of fills) { if (!fillsBy.has(f.vehicleId)) fillsBy.set(f.vehicleId, []); fillsBy.get(f.vehicleId)!.push(f) }

    const ids = [...curAgg.per.keys(), ...fillsBy.keys()]
    const vehicles = ids.length
      ? await prisma.vehicle.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, registrationNumber: true, fuelNormPer100km: true } })
      : []

    const aggs: VehicleAgg[] = vehicles.map(v => {
      const c = computeConsumption(
        (fillsBy.get(v.id) || []).map(f => ({ liters: Number(f.amountLiters), odometer: Number(f.odometerReading), date: f.refuelDate })),
        v.fuelNormPer100km ? Number(v.fuelNormPer100km) : null,
      )
      return {
        id: v.id, registrationNumber: v.registrationNumber,
        cost: curAgg.per.get(v.id) || 0,
        prevCost: prevAgg ? (prevAgg.per.get(v.id) || 0) : null,
        l100: c?.l100 ?? null, normPer100: c?.normPer100 ?? null,
      }
    })

    const insights = buildInsights({ vehicles: aggs, cur: curAgg.totals, prev: prevAgg?.totals ?? null })
    const delta = prevAgg ? {
      total: pctDelta(curAgg.totals.total, prevAgg.totals.total),
      fuel: pctDelta(curAgg.totals.fuel, prevAgg.totals.fuel),
      maintenance: pctDelta(curAgg.totals.maintenance, prevAgg.totals.maintenance),
      expenses: pctDelta(curAgg.totals.expenses, prevAgg.totals.expenses),
    } : null

    res.json(successResponse({
      current: curAgg.totals,
      previous: prevAgg?.totals ?? null,
      previousRange: prevR ? { from: prevR.gte, to: prevR.lte } : null,
      delta,
      insights,
    }))
  } catch (err) { next(err) }
}
