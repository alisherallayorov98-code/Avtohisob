// Savdo — qarzdorlarga SMS eslatma (Eskiz.uz).
//
// Qarz hech qayerda saqlanmaydi — lib/savdoDebtMath.ts yadrosi orqali
// sotuv+to'lovdan qayta hisoblanadi (dashboard.topDebtors bilan bir xil).
// Yuborish esa services/savdoSms.ts yagona yadrosi orqali ketadi.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { computeCustomerDebt } from '../lib/savdoDebtMath'
import {
  DEFAULT_SMS_TEMPLATE,
  SMS_PLACEHOLDERS,
  renderSmsTemplate,
  smsSegments,
  estimateSmsCost,
  normalizePhone,
} from '../lib/savdoSmsTemplate'
import { sendSavdoSmsBulk, isSavdoSmsConfigured } from '../services/savdoSms'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'

interface DebtorRow {
  id: string
  name: string
  phone: string | null
  debt: number
  phoneValid: boolean
  lastSmsAt: Date | null
}

/** Bitta mijozga bir kunda ikki marta yubormaslik oynasi */
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Qarzi bor mijozlarni telefon holati bilan qaytaradi.
 * Faqat aktiv mijozlar; ixtiyoriy minDebt filtri (mayda qarzga SMS yuborish
 * SMS narxidan qimmatga tushadi).
 */
async function loadDebtors(orgId: string, opts: { minDebt?: number; onlyIds?: string[] } = {}): Promise<DebtorRow[]> {
  const where: any = { orgId, isActive: true }
  if (opts.onlyIds) where.id = { in: opts.onlyIds }

  const customers = await (prisma as any).savdoCustomer.findMany({
    where,
    select: {
      id: true, name: true, phone: true,
      sales: { where: { status: 'completed' }, select: { id: true, totalAmount: true, status: true } },
      payments: { where: { cancelled: false }, select: { saleId: true, amount: true } },
    },
  })

  const rows: DebtorRow[] = customers
    .map((c: any) => {
      const debt = computeCustomerDebt(
        c.sales.map((s: any) => ({ id: s.id, totalAmount: Number(s.totalAmount), status: s.status })),
        c.payments.map((p: any) => ({ saleId: p.saleId, amount: Number(p.amount) })),
      )
      return {
        id: c.id,
        name: c.name,
        phone: c.phone ?? null,
        debt: debt.totalDebt,
        phoneValid: normalizePhone(c.phone) !== null,
        lastSmsAt: null as Date | null,
      }
    })
    .filter((c: DebtorRow) => c.debt > 0 && c.debt >= (opts.minDebt ?? 0))
    .sort((a: DebtorRow, b: DebtorRow) => b.debt - a.debt)

  if (rows.length > 0) {
    const logs = await (prisma as any).savdoSmsLog.groupBy({
      by: ['customerId'],
      where: { orgId, customerId: { in: rows.map(r => r.id) } },
      _max: { createdAt: true },
    })
    const lastMap = new Map<string, Date>(
      logs.filter((l: any) => l.customerId).map((l: any) => [l.customerId as string, l._max.createdAt as Date]),
    )
    for (const r of rows) r.lastSmsAt = lastMap.get(r.id) ?? null
  }

  return rows
}

async function loadSettings(orgId: string) {
  const s = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })
  return {
    smsEnabled: Boolean(s?.smsEnabled),
    template: s?.smsTemplate || DEFAULT_SMS_TEMPLATE,
    korxona: s?.companyName || null,
    telefon: s?.phone || null,
  }
}

export async function listDebtorsForSms(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const minDebt = Number((req.query as any).minDebt) || 0
    const [rows, settings] = await Promise.all([loadDebtors(orgId, { minDebt }), loadSettings(orgId)])

    res.json({
      success: true,
      data: rows,
      meta: {
        total: rows.length,
        withValidPhone: rows.filter(r => r.phoneValid).length,
        smsEnabled: settings.smsEnabled,
        smsConfigured: isSavdoSmsConfigured(),
        template: settings.template,
        placeholders: SMS_PLACEHOLDERS,
      },
    })
  } catch (err) { next(err) }
}

/** Matnni oldindan ko'rish — hech narsa yuborilmaydi */
export async function previewSms(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { template, customerIds } = req.body as { template?: string; customerIds?: string[] }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta mijoz tanlang' })
      return
    }

    const settings = await loadSettings(orgId)
    const tpl = (template && template.trim()) || settings.template
    const rows = await loadDebtors(orgId, { onlyIds: customerIds })

    const now = new Date()
    const items = rows.map(r => {
      const text = renderSmsTemplate(tpl, {
        mijoz: r.name, qarz: r.debt, korxona: settings.korxona, telefon: settings.telefon, sana: now,
      })
      return {
        customerId: r.id, name: r.name, phone: r.phone, debt: r.debt,
        phoneValid: r.phoneValid, text, segments: smsSegments(text),
      }
    })

    const sendable = items.filter(i => i.phoneValid)
    const totalSegments = sendable.reduce((sum, i) => sum + i.segments, 0)
    const sampleText = items[0]?.text || ''

    res.json({
      success: true,
      data: {
        items,
        recipients: sendable.length,
        skipped: items.length - sendable.length,
        totalSegments,
        estimatedCost: estimateSmsCost(sampleText, sendable.length),
      },
    })
  } catch (err) { next(err) }
}

export async function sendDebtorSms(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { customerIds, template, force } = req.body as
      { customerIds?: string[]; template?: string; force?: boolean }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta mijoz tanlang' })
      return
    }

    const settings = await loadSettings(orgId)
    if (!settings.smsEnabled) {
      res.status(400).json({ success: false, error: 'SMS eslatma sozlamalarda yoqilmagan' })
      return
    }
    if (!isSavdoSmsConfigured()) {
      res.status(400).json({ success: false, error: 'SMS xizmati sozlanmagan (Eskiz kaliti yo\'q)' })
      return
    }

    const tpl = (template && template.trim()) || settings.template
    const rows = await loadDebtors(orgId, { onlyIds: customerIds })

    // Takroriy yuborish qorovuli: oxirgi 24 soatda SMS olgan mijoz o'tkazib
    // yuboriladi (force bilan majburan yuborsa bo'ladi).
    const since = new Date(Date.now() - REPEAT_WINDOW_MS)
    const recent: any[] = force ? [] : await (prisma as any).savdoSmsLog.findMany({
      where: { orgId, status: 'sent', customerId: { in: rows.map(r => r.id) }, createdAt: { gte: since } },
      select: { customerId: true },
    })
    const recentIds = new Set(recent.map(r => r.customerId))

    const skipped: { customerId: string; name: string; reason: string }[] = []
    const now = new Date()
    const items = []

    for (const r of rows) {
      if (!r.phoneValid) {
        skipped.push({ customerId: r.id, name: r.name, reason: 'Telefon raqami noto\'g\'ri' })
        continue
      }
      if (recentIds.has(r.id)) {
        skipped.push({ customerId: r.id, name: r.name, reason: 'Oxirgi 24 soatda SMS yuborilgan' })
        continue
      }
      items.push({
        customerId: r.id,
        phone: r.phone as string,
        message: renderSmsTemplate(tpl, {
          mijoz: r.name, qarz: r.debt, korxona: settings.korxona, telefon: settings.telefon, sana: now,
        }),
      })
    }

    if (items.length === 0) {
      res.json({
        success: true,
        data: { sent: 0, failed: 0, skipped, results: [] },
        message: 'Yuboriladigan mijoz qolmadi',
      })
      return
    }

    const sentBy = await ensureSavdoActor(actor)
    const result = await sendSavdoSmsBulk({ orgId, sentBy, items })

    res.json({
      success: true,
      data: { ...result, skipped },
      message: `${result.sent} ta SMS yuborildi`,
    })
  } catch (err) { next(err) }
}

export async function listSmsLogs(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { orgId }
    if (q.customerId) where.customerId = q.customerId
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter

    const [total, logs] = await Promise.all([
      (prisma as any).savdoSmsLog.count({ where }),
      (prisma as any).savdoSmsLog.findMany({
        where, skip, take: limit,
        include: { customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json(paginatedResponse(logs, total, page, limit))
  } catch (err) { next(err) }
}
