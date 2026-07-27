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

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { resolvePeriod } from './reports'
import { summarizePlans, deltaPercent } from '../lib/reportMath'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function monthLabel(m: string): string {
  const [y, mo] = String(m).split('-')
  return `${UZ_MONTHS[parseInt(mo, 10) - 1] ?? mo} ${y}`
}

/** "YYYY-MM" oylar ro'yxatidan [boshi, oxiri) sana chegarasi */
function periodBounds(months: string[]): { start: Date; end: Date } {
  const start = new Date(months[0] + '-01T00:00:00.000Z')
  const end = new Date(months[months.length - 1] + '-01T00:00:00.000Z')
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start, end }
}

/** Sanani "YYYY-MM-DD" ko'rinishiga keltiradi (UTC). */
function dayKey(d: Date | string): string {
  const v = d instanceof Date ? d : new Date(d)
  return v.toISOString().slice(0, 10)
}

/** Kirish rad etilganda qaytadigan shakl */
interface Denied { ok: false; status: number; message: string }
interface Allowed { ok: true; user: any; userDistrictIds: string[] }

/**
 * Inspektorni topadi va ko'rish huquqini tekshiradi.
 * Huquq qoidalari fayl boshidagi izohda.
 */
async function loadInspector(req: EkoRequest, inspectorId: string): Promise<Denied | Allowed> {
  const { orgId, role, districtIds, id: userId } = req.ekoUser!

  if (role === 'inspector' && inspectorId !== userId) {
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
  if (!user || user.orgId !== orgId) {
    return { ok: false, status: 404, message: 'Xodim topilmadi' }
  }

  const userDistrictIds: string[] = user.districts.map((d: any) => d.district.id)
  if (role === 'supervisor' && !userDistrictIds.some(id => districtIds.includes(id))) {
    return { ok: false, status: 403, message: 'Bu xodim sizning tumanlaringizda ishlamaydi' }
  }

  return { ok: true, user, userDistrictIds }
}

/** Hisobot ma'lumotlarini yig'adi (JSON va Excel uchun umumiy manba). */
async function buildInspectorReport(
  req: EkoRequest, inspectorId: string,
): Promise<Denied | { ok: true; data: any }> {
  const { orgId } = req.ekoUser!
  const loaded = await loadInspector(req, inspectorId)
  if (!loaded.ok) return loaded

  const { user, userDistrictIds } = loaded
  const { months, focusMonth } = resolvePeriod(req)
  const { start, end } = periodBounds(months)

  // ── To'lovlar (davr bo'yicha) ──
  const payments = await (prisma as any).ekoHisobPayment.findMany({
    where: { receivedBy: inspectorId, month: { in: months } },
    select: {
      id: true, amount: true, month: true, paidAt: true, note: true,
      entity: { select: { id: true, name: true, districtId: true, district: { select: { name: true } } } },
      receipt: { select: { receiptNumber: true } },
    },
    orderBy: { paidAt: 'desc' },
    // Bir inspektorning 6 oylik to'lovlari — chegaralangan hajm
    take: 5000,
  })

  const collected = payments.reduce((s: number, p: any) => s + (p.amount || 0), 0)

  // Oylik dinamika
  const byMonthMap = new Map<string, number>(months.map(m => [m, 0]))
  const activeDaySet = new Set<string>()
  const byDistrictMap = new Map<string, { name: string; collected: number; count: number }>()
  for (const p of payments) {
    byMonthMap.set(p.month, (byMonthMap.get(p.month) ?? 0) + (p.amount || 0))
    activeDaySet.add(dayKey(p.paidAt))
    const did = p.entity?.districtId
    if (did) {
      const cur = byDistrictMap.get(did) ?? { name: p.entity?.district?.name ?? '—', collected: 0, count: 0 }
      cur.collected += p.amount || 0
      cur.count++
      byDistrictMap.set(did, cur)
    }
  }
  const monthlyTrend = months.map(m => ({
    month: m, label: monthLabel(m), collected: byMonthMap.get(m) ?? 0,
  }))
  const byDistrict = Array.from(byDistrictMap.values()).sort((a, b) => b.collected - a.collected)

  // ── Kiritilgan tashkilotlar (davr bo'yicha) ──
  const createdEntities = await (prisma as any).ekoHisobLegalEntity.findMany({
    where: { orgId, createdBy: inspectorId, createdAt: { gte: start, lt: end } },
    select: { id: true, createdAt: true },
    take: 20000,
  })
  const createdByDay: Record<string, number> = {}
  for (const e of createdEntities) {
    const key = dayKey(e.createdAt)
    createdByDay[key] = (createdByDay[key] ?? 0) + 1
  }

  // ── Plan bajarilishi ──
  const plans = await (prisma as any).ekoHisobPlan.findMany({
    where: { orgId, inspectorId, date: { gte: start, lt: end }, type: 'new_entity' },
    select: { date: true, targetCount: true },
    orderBy: { date: 'asc' },
  })
  const planSummary = summarizePlans(
    plans.map((p: any) => ({ date: dayKey(p.date), target: p.targetCount })),
    createdByDay,
  )

  // ── SMS va o'tgan davr taqqoslashi ──
  const prevMonths = months.length
  const prevEnd = new Date(start)
  const prevStart = new Date(start)
  prevStart.setUTCMonth(prevStart.getUTCMonth() - prevMonths)
  const [smsCount, prevAgg] = await Promise.all([
    (prisma as any).ekoHisobSmsLog.count({
      where: { orgId, sentBy: inspectorId, createdAt: { gte: start, lt: end } },
    }).catch(() => 0),
    (prisma as any).ekoHisobPayment.aggregate({
      where: { receivedBy: inspectorId, paidAt: { gte: prevStart, lt: prevEnd } },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: 0 } })),
  ])
  const prevCollected = prevAgg._sum.amount || 0

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
      collected,
      paymentsCount: payments.length,
      avgPayment: payments.length > 0 ? Math.round(collected / payments.length) : 0,
      entitiesCreated: createdEntities.length,
      // Necha xil kunda to'lov qabul qilgan — faollik ko'rsatkichi
      activeDays: activeDaySet.size,
      smsSent: smsCount,
      prevCollected,
      collectedDelta: deltaPercent(collected, prevCollected),
    },
    plan: planSummary,
    monthlyTrend,
    byDistrict,
    recentPayments: payments.slice(0, 20).map((p: any) => ({
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
      ? monthLabel(d.period.from)
      : `${monthLabel(d.period.from)} — ${monthLabel(d.period.to)}`

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()

    const ws = wb.addWorksheet('Umumiy')
    ws.columns = [{ width: 32 }, { width: 24 }]
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
      ["Yig'ilgan summa", d.kpi.collected],
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
      if (typeof value === 'number') row.getCell(2).numFmt = '# ##0'
    }

    const wsTrend = wb.addWorksheet('Oylik')
    wsTrend.columns = [{ width: 18 }, { width: 20 }]
    const th = wsTrend.addRow(['Oy', "Yig'ilgan (so'm)"])
    th.font = { bold: true }
    th.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    for (const m of d.monthlyTrend) wsTrend.addRow([m.label, m.collected])
    wsTrend.getColumn(2).numFmt = '# ##0'

    if (d.byDistrict.length > 0) {
      const wsD = wb.addWorksheet('Tuman')
      wsD.columns = [{ width: 26 }, { width: 18 }, { width: 20 }]
      const dh = wsD.addRow(['Tuman', "To'lovlar", "Yig'ilgan (so'm)"])
      dh.font = { bold: true }
      dh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
      for (const r of d.byDistrict) wsD.addRow([r.name, r.count, r.collected])
      wsD.getColumn(3).numFmt = '# ##0'
    }

    if (d.recentPayments.length > 0) {
      const wsP = wb.addWorksheet("Oxirgi to'lovlar")
      wsP.columns = [{ width: 14 }, { width: 34 }, { width: 20 }, { width: 14 }, { width: 18 }, { width: 20 }]
      const ph = wsP.addRow(['Sana', 'Tashkilot', 'Tuman', 'Oy', "Summa (so'm)", 'Kvitansiya'])
      ph.font = { bold: true }
      ph.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
      for (const p of d.recentPayments) {
        wsP.addRow([
          new Date(p.paidAt).toLocaleDateString('uz-UZ'),
          p.entityName, p.district ?? '—', monthLabel(p.month), p.amount, p.receiptNumber ?? '—',
        ])
      }
      wsP.getColumn(5).numFmt = '# ##0'
    }

    const safe = d.inspector.fullName.replace(/[^\p{L}0-9\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''inspektor_${encodeURIComponent(safe)}_${d.period.from}_${d.period.to}.xlsx`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
