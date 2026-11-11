import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getOrgSettings, effectiveSmsLimit } from '../services/orgSettings'
import { mergeRules, EscalationRule } from '../lib/escalation'
import {
  validateSmsTemplate, renderSmsTemplate, smsLength, formatSmsAmount,
  DEFAULT_SMS_TEMPLATE, SMS_PLACEHOLDERS,
} from '../lib/smsTemplate'
import { isSmsConfigured } from '../services/sms'
import { logEkoAudit } from '../lib/ekoAudit'
import { loadEntityDebts } from '../services/entityDebtLoader'
import { entityScopeWhere, isEkoAdmin } from '../lib/ekoScope'

/** Sozlamalar faqat korxona admini uchun (routes ham requireEkoAdmin bilan o'raydi — qo'sh himoya). */
function denyNonAdmin(req: EkoRequest, res: Response): boolean {
  if (isEkoAdmin(req.ekoUser!)) return false
  res.status(403).json({ success: false, error: 'Faqat administrator' })
  return true
}

/**
 * GET /settings — korxona sozlamalari + eskalatsiya qoidalari.
 * smsMonthlyLimit KO'RSATILADI, lekin o'zgartirib bo'lmaydi (PUT qabul qilmaydi).
 */
export async function getSettings(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (denyNonAdmin(req, res)) return
    const { orgId } = req.ekoUser!
    const settings = await getOrgSettings(orgId)
    const dbRules = await (prisma as any).ekoHisobEscalationRule.findMany({
      where: { orgId },
    }).catch(() => [] as any[])

    const effectiveLimit = effectiveSmsLimit(settings)

    // Shablonning namunaviy ko'rinishi va narxi — UI darhol ko'rsatishi uchun
    const previewText = renderSmsTemplate(settings.smsTemplate, {
      tashkilot: '"Namuna" MChJ',
      qarz: formatSmsAmount(1200000),
      oy: '2026-07',
      aloqa: settings.contactPhone ?? '',
    })

    res.json({
      success: true,
      data: {
        ...settings,
        smsMonthlyLimit: effectiveLimit,
        // Limitni korxona o'zgartira olmaydi — UI maydonni bloklashi uchun
        smsMonthlyLimitEditable: false,
        smsConfigured: isSmsConfigured(),
        smsTemplateDefault: DEFAULT_SMS_TEMPLATE,
        smsPlaceholders: SMS_PLACEHOLDERS,
        smsPreview: { text: previewText, ...smsLength(previewText) },
        escalationRules: Object.values(mergeRules(dbRules)),
      },
    })
  } catch (err) { next(err) }
}

const LEVELS = ['warning', 'overdue', 'critical']

/**
 * PUT /settings — korxona admini sozlaydi.
 *
 * MUHIM: `smsMonthlyLimit` ATAYLAB qabul qilinmaydi. Korxona o'z SMS limitini
 * oshira olmasligi kerak (bu bizning xarajatimiz) — uni faqat super-admin
 * bazadan o'zgartiradi.
 */
export async function updateSettings(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (denyNonAdmin(req, res)) return
    const { orgId } = req.ekoUser!
    const b = req.body ?? {}
    const data: any = {}
    const beforeSettings = await getOrgSettings(orgId)
    const beforeRules = mergeRules(
      await (prisma as any).ekoHisobEscalationRule.findMany({ where: { orgId } }).catch(() => [] as any[]),
    )

    if (b.smsAutoEnabled !== undefined) data.smsAutoEnabled = Boolean(b.smsAutoEnabled)
    if (b.escalationEnabled !== undefined) data.escalationEnabled = Boolean(b.escalationEnabled)

    if (b.smsAutoDay !== undefined) {
      const d = parseInt(String(b.smsAutoDay), 10)
      if (!Number.isFinite(d) || d < 1 || d > 28) {
        // 29–31 ataylab taqiqlangan: fevralda hech qachon ishlamay qolardi
        res.status(400).json({ success: false, error: 'Kun 1 dan 28 gacha bo\'lishi kerak' })
        return
      }
      data.smsAutoDay = d
    }

    if (b.paymentDueDay !== undefined) {
      const raw = b.paymentDueDay
      const d = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isInteger(d) || d < 1 || d > 28) {
        res.status(400).json({ success: false, error: "To'lov muddati kuni 1 dan 28 gacha butun son bo'lishi kerak" })
        return
      }
      data.paymentDueDay = d
    }

    if (b.smsAutoMinLevel !== undefined) {
      if (!LEVELS.includes(String(b.smsAutoMinLevel))) {
        res.status(400).json({ success: false, error: "Daraja: 'warning' | 'overdue' | 'critical'" })
        return
      }
      data.smsAutoMinLevel = String(b.smsAutoMinLevel)
    }

    if (b.smsDailyMax !== undefined) {
      const n = parseInt(String(b.smsDailyMax), 10)
      if (!Number.isFinite(n) || n < 1 || n > 5000) {
        res.status(400).json({ success: false, error: 'Kunlik maksimal 1 dan 5000 gacha' })
        return
      }
      data.smsDailyMax = n
    }

    if (b.smsTemplate !== undefined) {
      const tpl = b.smsTemplate === null ? null : String(b.smsTemplate)
      if (tpl !== null) {
        const issues = validateSmsTemplate(tpl)
        const errors = issues.filter(i => i.level === 'error')
        if (errors.length > 0) {
          res.status(400).json({ success: false, error: errors.map(e => e.message).join('; ') })
          return
        }
      }
      data.smsTemplate = tpl
    }

    if (b.contactPhone !== undefined) {
      data.contactPhone = b.contactPhone ? String(b.contactPhone).trim().slice(0, 32) : null
    }

    // Rasmiy hujjat rekvizitlari (akt sverka, faktura). Erkin matn — tekshirish
    // faqat uzunlik bo'yicha, chunki formatlar korxonadan korxonaga farq qiladi.
    const REQUISITES = [
      'orgOfficialName', 'orgStir', 'orgAddress', 'orgPhone',
      'orgBankAccount', 'orgBankName', 'orgMfo', 'orgDirector', 'orgAccountant',
    ] as const
    for (const key of REQUISITES) {
      if (b[key] === undefined) continue
      data[key] = b[key] ? String(b[key]).trim().slice(0, 200) : null
    }

    const saved = await (prisma as any).ekoHisobOrgSettings.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    })

    // ── Eskalatsiya qoidalari ──
    if (Array.isArray(b.escalationRules)) {
      for (const r of b.escalationRules) {
        if (!LEVELS.includes(String(r?.level))) continue
        const ruleData = {
          smsEnabled: Boolean(r.smsEnabled),
          notifyInspector: Boolean(r.notifyInspector),
          notifyManager: Boolean(r.notifyManager),
          suggestBlacklist: Boolean(r.suggestBlacklist),
          isActive: r.isActive === undefined ? true : Boolean(r.isActive),
        }
        await (prisma as any).ekoHisobEscalationRule.upsert({
          where: { orgId_level: { orgId, level: String(r.level) } },
          create: { orgId, level: String(r.level), ...ruleData },
          update: ruleData,
        })
      }
    }

    // Audit: nima o'zgargani (oldin → keyin). Rekvizitlar uzun bo'lishi mumkin — qisqartiriladi.
    const clip = (v: unknown) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v)
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    for (const key of Object.keys(data)) {
      const before = (beforeSettings as any)[key] ?? null
      const after = data[key] ?? null
      if (before !== after) changes[key] = { before: clip(before), after: clip(after) }
    }
    const afterRules = mergeRules(
      await (prisma as any).ekoHisobEscalationRule.findMany({ where: { orgId } }).catch(() => [] as any[]),
    )
    const ruleChanges: Record<string, { before: EscalationRule; after: EscalationRule }> = {}
    for (const lvl of LEVELS) {
      if (JSON.stringify(beforeRules[lvl]) !== JSON.stringify(afterRules[lvl])) {
        ruleChanges[lvl] = { before: beforeRules[lvl], after: afterRules[lvl] }
      }
    }
    await logEkoAudit(req.ekoUser, {
      action: 'settings.update',
      targetType: 'settings',
      targetId: orgId,
      details: {
        changed: Object.keys(data), // moslik: eski maydon
        changes,
        rules: Array.isArray(b.escalationRules) ? b.escalationRules.length : 0,
        ruleChanges,
      },
    })

    res.json({ success: true, data: saved })
  } catch (err) { next(err) }
}

/**
 * POST /settings/sms-preview — shablonni saqlamasdan tekshirish (UI jonli ko'rsatadi).
 */
export async function previewSmsTemplate(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (denyNonAdmin(req, res)) return
    const { orgId } = req.ekoUser!
    const settings = await getOrgSettings(orgId)
    const tpl = req.body?.smsTemplate != null ? String(req.body.smsTemplate) : settings.smsTemplate
    const contact = req.body?.contactPhone != null
      ? String(req.body.contactPhone)
      : (settings.contactPhone ?? '')

    const text = renderSmsTemplate(tpl, {
      tashkilot: '"Namuna" MChJ',
      qarz: formatSmsAmount(1200000),
      oy: '2026-07',
      aloqa: contact,
    })
    res.json({
      success: true,
      data: { text, ...smsLength(text), issues: tpl ? validateSmsTemplate(tpl) : [] },
    })
  } catch (err) { next(err) }
}

/**
 * GET /settings/blacklist-suggestions — eskalatsiya "tavsiya" qilgan tashkilotlar.
 *
 * Bular kritik darajaga yetgan va hali qora ro'yxatda bo'lmagan tashkilotlar.
 * Tizim ULARNI AVTOMATIK QO'SHMAYDI — qora ro'yxat yuridik oqibatga ega,
 * qaror har doim odam qo'lida qoladi. Bu shunchaki "ko'rib chiqing" ro'yxati.
 */
export async function getBlacklistSuggestions(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (denyNonAdmin(req, res)) return
    const { orgId } = req.ekoUser!

    const logs = await (prisma as any).ekoHisobEscalationLog.findMany({
      where: { orgId, action: 'blacklist_suggest' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { entityId: true, level: true, createdAt: true },
    }).catch(() => [] as any[])

    if (logs.length === 0) { res.json({ success: true, data: [] }); return }

    const entityWhere: any = {
      ...entityScopeWhere(req.ekoUser!),   // tenant + tuman doirasi (yagona manba)
      id: { in: logs.map((l: any) => l.entityId) },
      status: 'active',              // allaqachon qora ro'yxatga o'tganlar chiqmaydi
      blacklist: { is: null },
    }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: entityWhere,
      select: {
        id: true, name: true, phone: true, debtLevel: true, billingMode: true,
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
      },
    })

    const suggestedAt = new Map<string, Date>(logs.map((l: any) => [l.entityId, l.createdAt]))
    // Kanonik qarz — BITTA SQL (hisobot/kartochka bilan bir xil)
    const debts = await loadEntityDebts(entities, orgId)

    const data = entities.map((e: any) => {
      const debt = debts.get(e.id)!
      return {
        id: e.id,
        name: e.name,
        phone: e.phone,
        district: e.district?.name ?? null,
        mahalla: e.mahalla?.name ?? null,
        debtLevel: e.debtLevel,
        debtAmount: debt.totalDebt,
        debtMonths: debt.debtMonths,
        suggestedAt: suggestedAt.get(e.id) ?? null,
      }
    }).sort((a: any, b: any) => b.debtAmount - a.debtAmount)

    res.json({ success: true, data })
  } catch (err) { next(err) }
}
