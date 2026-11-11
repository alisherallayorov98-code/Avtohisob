// Bitta inspektor bo'yicha batafsil hisobot.
//
// Nega alohida: umumiy hisobotdagi "inspektor samaradorligi" faqat yig'ilgan
// summani ko'rsatadi. Rahbarga esa aniq savollar bo'yicha javob kerak:
// qaysi tumanlarda ishladi, nechta yangi tashkilot kiritdi, plan bajarildimi,
// necha kun faol bo'ldi, oxirgi to'lovlari qanday.
//
// KIRISH HUQUQI (loyihaning "ochiq shaxsiy reyting yo'q" qoidasi):
//  - admin — korxonadagi har bir inspektor;
//  - boshliq (supervisor) — faqat o'z tumanlaridagi inspektorlar;
//  - inspektor — FAQAT o'zi. Boshqa inspektorning hisobotini ko'ra olmaydi.
//
// "YIG'ILGAN" ikki aniq ma'noda (olma-olma taqqoslanadi):
//  - collected / collectedForMonth — payment.month davrda ("shu davrga tegishli");
//  - collectedCash — paidAt davrda, UZT oy chegarasi bilan ("kassaga tushdi").
// O'tgan davr taqqoslashi (collectedDelta, collectedCashDelta) har biri O'Z ma'nosida.

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { resolvePeriod, scopeOf } from './reports'
import { summarizePlans } from '../lib/reportMath'
import { rollupPaymentGroups, pctChange, dateOnlyKey } from '../lib/reportAggregate'
import { isEkoAdmin, canAccessDistrict, entityScopeWhere } from '../lib/ekoScope'
import { monthBoundsUz, shiftMonth, parseDateOnly } from '../lib/uzt'
import { monthsBetween } from '../lib/months'
import {
  queryInspectorPaymentGroups, queryInspectorCash, queryCreatedByDay,
} from '../lib/reportQueries'
import { NUM_FMT, totalCell } from '../lib/xlsxFormat'
import { uzDate, uzMonth } from '../lib/dateFormat'

/** Kirish rad etilganda qaytadigan shakl */
interface Denied { ok: false; status: number; message: string }
interface Allowed { ok: true; user: any; userDistrictIds: string[] }

/**
 * Inspektorni topadi va ko'rish huquqini tekshiradi.
 * Huquq qoidalari fayl boshidagi izohda.
 */
async function loadInspector(req: EkoRequest, inspectorId: string): Promise<Denied | Allowed> {
  const viewer = scopeOf(req)
  const { id: viewerId, role } = req.ekoUser!

  // "Faqat o'zi" qoidasi — doira emas, shaxsiy reyting maxfiyligi qoidasi
  if (role === 'inspector' && inspectorId !== viewerId) {
    return { ok: false, status: 403, message: 'Faqat o\'z hisobotingizni ko\'ra olasiz' }
  }

  const user = await (prisma as any).ekoHisobUser.findUnique({
    where: { id: inspectorId },
    select: {
      id: true, fullName: true, email: true, role: true, isActive: true, orgId: true,
      districts: { select: { district: { select: { id: true, name: true } } } },
      botLink: { select: { linkedAt: true } },
    },
  })
  if (!user || user.orgId !== viewer.orgId) {
    return { ok: false, status: 404, message: 'Xodim topilmadi' }
  }

  const userDistrictIds: string[] = user.districts.map((d: any) => d.district.id)
  // Admin bo'lmaganlar (boshliq): faqat o'z tumanlaridagi xodimlar
  if (!isEkoAdmin(viewer) && inspectorId !== viewerId
      && !userDistrictIds.some(id => canAccessDistrict(viewer, id))) {
    return { ok: false, status: 403, message: 'Bu xodim sizning tumanlaringizda ishlamaydi' }
  }

  return { ok: true, user, userDistrictIds }
}

/** Hisobot ma'lumotlarini yig'adi (JSON va Excel uchun umumiy manba). */
async function buildInspectorReport(
  req: EkoRequest, inspectorId: string,
): Promise<Denied | { ok: true; data: any }> {
  const viewer = scopeOf(req)
  const loaded = await loadInspector(req, inspectorId)
  if (!loaded.ok) return loaded

  const { user, userDistrictIds } = loaded
  const { months, focusMonth } = resolvePeriod(req)
  const first = monthBoundsUz(months[0])!
  const last = monthBoundsUz(months[months.length - 1])!
  const start = first.start
  const end = last.end

  // O'tgan davr — xuddi shuncha oy, darhol oldin (olma-olma)
  const prevFrom = shiftMonth(months[0], -months.length)
  const prevMonths = monthsBetween(prevFrom, shiftMonth(months[0], -1))
  const prevStart = monthBoundsUz(prevFrom)!.start

  const planFrom = parseDateOnly(`${months[0]}-01`)!
  const planTo = parseDateOnly(`${shiftMonth(months[months.length - 1], 1)}-01`)!

  const [
    groups, prevGroups, cash, prevCash, createdByDay, plans, smsCount, recent,
  ] = await Promise.all([
    queryInspectorPaymentGroups(viewer, inspectorId, months),
    queryInspectorPaymentGroups(viewer, inspectorId, prevMonths),
    queryInspectorCash(viewer, inspectorId, start, end),
    queryInspectorCash(viewer, inspectorId, prevStart, start),
    queryCreatedByDay(viewer, inspectorId, start, end),
    (prisma as any).ekoHisobPlan.findMany({
      where: { orgId: viewer.orgId, inspectorId, date: { gte: planFrom, lt: planTo }, type: 'new_entity' },
      select: { date: true, targetCount: true },
      orderBy: { date: 'asc' },
    }),
    (prisma as any).ekoHisobSmsLog.count({
      where: { orgId: viewer.orgId, sentBy: inspectorId, createdAt: { gte: start, lt: end } },
    }).catch(() => 0),
    (prisma as any).ekoHisobPayment.findMany({
      where: { receivedBy: inspectorId, month: { in: months }, entity: entityScopeWhere(viewer) },
      select: {
        id: true, amount: true, month: true, paidAt: true,
        entity: { select: { id: true, name: true, district: { select: { name: true } } } },
        receipt: { select: { receiptNumber: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 20,
    }),
  ])

  const roll = rollupPaymentGroups(groups, months)
  const prevRoll = rollupPaymentGroups(prevGroups, prevMonths)
  const collected = roll.collected

  const monthlyTrend = months.map(m => ({
    month: m, label: uzMonth(m), collected: roll.byMonth.get(m) ?? 0,
  }))
  const byDistrict = Array.from(roll.byDistrict.values()).sort((a, b) => b.collected - a.collected)

  // ── Plan bajarilishi (kunlar UZT bo'yicha: plan.date — kalendar sana) ──
  const planSummary = summarizePlans(
    plans.map((p: any) => ({ date: dateOnlyKey(p.date), target: p.targetCount })),
    createdByDay,
  )
  const entitiesCreated = Object.values(createdByDay).reduce((s, n) => s + n, 0)

  return { ok: true, data: {
    inspector: {
      id: user.id,
      fullName: user.fullName,
      login: user.email,
      role: user.role,
      isActive: user.isActive,
      botLinked: !!user.botLink,
      districts: user.districts.map((d: any) => d.district.name),
      districtIds: userDistrictIds,
    },
    period: { from: months[0], to: months[months.length - 1], months: months.length, focusMonth },
    kpi: {
      // "Shu davrga tegishli" (payment.month) — eski maydonlar shu ma'noda qoldi
      collected,
      collectedForMonth: collected,
      paymentsCount: roll.count,
      avgPayment: roll.count > 0 ? Math.round(collected / roll.count) : 0,
      entitiesCreated,
      // Necha xil UZT kunida to'lov qabul qilgan (kassaga tushgan kunlar)
      activeDays: cash.activeDays,
      smsSent: smsCount,
      // O'tgan davr — payment.month bo'yicha (collected bilan olma-olma)
      prevCollected: prevRoll.collected,
      collectedDelta: pctChange(collected, prevRoll.collected),
      // "Kassaga tushdi" (paidAt) va uning o'tgan davr bilan taqqoslashi
      collectedCash: cash.cash,
      prevCollectedCash: prevCash.cash,
      collectedCashDelta: pctChange(cash.cash, prevCash.cash),
    },
    plan: planSummary,
    monthlyTrend,
    byDistrict,
    recentPayments: recent.map((p: any) => ({
      id: p.id,
      entityId: p.entity?.id ?? null,
      entityName: p.entity?.name ?? '—',
      district: p.entity?.district?.name ?? null,
      month: p.month,
      amount: p.amount,
      paidAt: p.paidAt,
      receiptNumber: p.receipt?.receiptNumber ?? null,
    })),
  } }
}

/** GET /reports/inspector/:id?from=&to= */
export async function getInspectorReport(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await buildInspectorReport(req, String(req.params.id))
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.message })
      return
    }
    res.json({ success: true, data: result.data })
  } catch (err) { next(err) }
}

/** GET /reports/inspector/:id/export.xlsx?from=&to= */
export async function exportInspectorReportXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const built = await buildInspectorReport(req, String(req.params.id))
    if (!built.ok) {
      res.status(built.status).json({ success: false, error: built.message })
      return
    }
    const d = built.data

    const periodText = d.period.from === d.period.to
      ? uzMonth(d.period.from)
      : `${uzMonth(d.period.from)} — ${uzMonth(d.period.to)}`

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()

    const ws = wb.addWorksheet('Umumiy')
    ws.columns = [{ width: 36 }, { width: 24 }]
    const title = ws.addRow([`INSPEKTOR HISOBOTI — ${d.inspector.fullName}`])
    title.font = { bold: true, size: 13 }
    ws.mergeCells(`A${title.number}:B${title.number}`)
    const sub = ws.addRow([`Davr: ${periodText}`])
    sub.font = { color: { argb: 'FF777777' } }
    ws.mergeCells(`A${sub.number}:B${sub.number}`)
    ws.addRow([])

    const info: [string, any][] = [
      ['Tumanlar', d.inspector.districts.join(', ') || '—'],
      ['Holat', d.inspector.isActive ? 'Faol' : 'Nofaol'],
      ['Telegram bot', d.inspector.botLinked ? 'Ulangan' : 'Ulanmagan'],
      ['', ''],
      ["Shu davrga tegishli yig'ilgan (to'lov oyi bo'yicha)", d.kpi.collected],
      ["Kassaga tushgan (to'lov sanasi bo'yicha)", d.kpi.collectedCash],
      ["To'lovlar soni", d.kpi.paymentsCount],
      ["O'rtacha to'lov", d.kpi.avgPayment],
      ['Faol kunlar', d.kpi.activeDays],
      ['Kiritilgan tashkilotlar', d.kpi.entitiesCreated],
      ['Yuborilgan SMS', d.kpi.smsSent],
      ['', ''],
      ['Plan berilgan kunlar', d.plan.daysWithPlan],
      ['Plan maqsadi (jami)', d.plan.targetTotal],
      ['Plan kunlarida kiritilgan', d.plan.doneOnPlanDays],
      ['Maqsadga yetgan kunlar', d.plan.daysMet],
      ['Plan bajarilishi', d.plan.fulfillRate == null ? '—' : `${d.plan.fulfillRate}%`],
    ]
    for (const [label, value] of info) {
      if (label === '') { ws.addRow([]); continue }
      const row = ws.addRow([label, value])
      row.getCell(1).font = { color: { argb: 'FF555555' } }
      row.getCell(2).font = { bold: true }
      if (typeof value === 'number') row.getCell(2).numFmt = NUM_FMT
    }

    const wsTrend = wb.addWorksheet('Oylik')
    wsTrend.columns = [{ width: 18 }, { width: 20 }]
    const th = wsTrend.addRow(['Oy', "Yig'ilgan (so'm)"])
    th.font = { bold: true }
    th.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    const trendFrom = wsTrend.rowCount + 1
    for (const m of d.monthlyTrend) wsTrend.addRow([m.label, m.collected])
    const trendTo = wsTrend.rowCount
    const trendTotal = wsTrend.addRow(['JAMI', totalCell(2, trendFrom, trendTo, d.kpi.collected)])
    trendTotal.font = { bold: true }
    wsTrend.getColumn(2).numFmt = NUM_FMT

    if (d.byDistrict.length > 0) {
      const wsD = wb.addWorksheet('Tuman')
      wsD.columns = [{ width: 26 }, { width: 18 }, { width: 20 }]
      const dh = wsD.addRow(['Tuman', "To'lovlar", "Yig'ilgan (so'm)"])
      dh.font = { bold: true }
      dh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
      const dFrom = wsD.rowCount + 1
      for (const r of d.byDistrict) wsD.addRow([r.name, r.count, r.collected])
      const dTo = wsD.rowCount
      const sumCount = d.byDistrict.reduce((s: number, r: any) => s + r.count, 0)
      const dTotal = wsD.addRow([
        'JAMI', totalCell(2, dFrom, dTo, sumCount), totalCell(3, dFrom, dTo, d.kpi.collected),
      ])
      dTotal.font = { bold: true }
      wsD.getColumn(3).numFmt = NUM_FMT
    }

    if (d.recentPayments.length > 0) {
      const wsP = wb.addWorksheet("Oxirgi to'lovlar")
      wsP.columns = [{ width: 14 }, { width: 34 }, { width: 20 }, { width: 14 }, { width: 18 }, { width: 20 }]
      const ph = wsP.addRow(['Sana', 'Tashkilot', 'Tuman', 'Oy', "Summa (so'm)", 'Kvitansiya'])
      ph.font = { bold: true }
      ph.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
      for (const p of d.recentPayments) {
        wsP.addRow([
          uzDate(p.paidAt),
          p.entityName, p.district ?? '—', uzMonth(p.month), p.amount, p.receiptNumber ?? '—',
        ])
      }
      wsP.getColumn(5).numFmt = NUM_FMT
    }

    const safe = d.inspector.fullName.replace(/[^\p{L}0-9\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''inspektor_${encodeURIComponent(safe)}_${d.period.from}_${d.period.to}.xlsx`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
