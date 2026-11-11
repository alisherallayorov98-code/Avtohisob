import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { isSmsConfigured } from '../services/sms'
import { sendBudgetedSms, getSmsUsage } from '../services/smsGateway'
import { getOrgSettings } from '../services/orgSettings'
import { loadEntityDebts } from '../services/entityDebtLoader'
import { renderSmsTemplate, formatSmsAmount } from '../lib/smsTemplate'
import { MANUAL_COOLDOWN_HOURS, computeSmsEffectiveness, SkipReason } from '../lib/smsBudget'
import { canAccessEntity, entityScopeWhere, isEkoAdmin } from '../lib/ekoScope'
import { logEkoAudit } from '../lib/ekoAudit'
import { uzMonth } from '../lib/dateFormat'
import { todayUz } from '../lib/uzt'

const SKIP_MESSAGES: Record<SkipReason | 'not_configured', { http: number; text: string }> = {
  not_found: { http: 404, text: 'Tashkilot topilmadi' },
  bad_status: { http: 400, text: 'Faqat faol tashkilotga SMS yuboriladi (qora ro\'yxat/nofaol/chala emas)' },
  opt_out: { http: 409, text: 'Mijoz SMS olishni rad etgan (SMS rad belgisi qo\'yilgan)' },
  no_phone: { http: 400, text: 'Tashkilotning to\'g\'ri telefon raqami yo\'q' },
  empty_message: { http: 400, text: 'SMS matni bo\'sh' },
  duplicate: { http: 429, text: 'Bu davr uchun SMS allaqachon yuborilgan' },
  cooldown: { http: 429, text: `Bu tashkilotga yoki raqamga oxirgi ${MANUAL_COOLDOWN_HOURS} soat ichida SMS yuborilgan` },
  max_attempts: { http: 429, text: 'Qayta urinishlar chegarasi tugagan (3 marta muvaffaqiyatsiz)' },
  monthly_limit: { http: 429, text: 'Oylik SMS limiti tugadi. Keyingi oy yangilanadi yoki super-admin bilan bog\'laning.' },
  daily_limit: { http: 429, text: 'Bugungi SMS chegarasi tugadi. Ertaga urinib ko\'ring.' },
  not_configured: { http: 503, text: 'SMS xizmati sozlanmagan' },
}

/**
 * POST /reminders/sms  { entityId }
 * Tashkilot qarzini hisoblab, uning telefoniga SMS eslatma yuboradi va jurnalga yozadi.
 * Hamma tekshiruv (limit, opt-out, cooldown, dedup, holat) services/smsGateway.ts da.
 */
export async function sendDebtReminder(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { orgId, id: userId } = user
    const { entityId } = req.body ?? {}
    if (!entityId || typeof entityId !== 'string') {
      res.status(400).json({ success: false, error: 'entityId talab qilinadi' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id: entityId },
      select: {
        id: true, orgId: true, districtId: true, name: true, billingMode: true,
      },
    })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    // Kanonik qarz (SQL) — hisobot/kartochka bilan bir xil
    const debt = (await loadEntityDebts([entity], orgId)).get(entity.id)!
    if (debt.totalDebt <= 0) {
      res.status(400).json({ success: false, error: 'Bu tashkilotda qarz yo\'q' })
      return
    }

    // {aloqa} — KORXONA aloqa raqami (qarzdorning o'z telefoni emas)
    const settings = await getOrgSettings(orgId)
    const message = renderSmsTemplate(settings.smsTemplate, {
      tashkilot: entity.name,
      qarz: formatSmsAmount(debt.totalDebt),
      oy: debt.unpaidMonths[0] ? uzMonth(debt.unpaidMonths[0]) : '',
      aloqa: settings.contactPhone ?? '',
    })

    const out = await sendBudgetedSms({
      orgId, entityId, kind: 'manual', message, sentBy: userId || null,
      // Qo'lda SMS: kunlik davr kaliti (kuniga 1 ta) + 24 soatlik cooldown (tashkilot yoki telefon)
      periodKey: todayUz(),
      cooldownHours: MANUAL_COOLDOWN_HOURS,
    })

    if (out.status === 'skipped') {
      const m = SKIP_MESSAGES[out.reason]
      res.status(m.http).json({ success: false, error: m.text, code: out.reason })
      return
    }
    if (out.status === 'failed') {
      const http = out.errorType === 'config' || out.errorType === 'auth' ? 503 : 400
      res.status(http).json({ success: false, error: out.error || 'SMS yuborilmadi', code: out.errorType })
      return
    }
    res.json({ success: true, data: { sent: true, debt: debt.totalDebt, segments: out.segments } })
  } catch (err) { next(err) }
}

/**
 * GET /reminders/status — SMS xizmati sozlanganmi (UI tugmasi uchun).
 * `used`/`limit`/`remaining` endi SEGMENTLARDA (haq segmentga qarab olinadi);
 * SMS soni — `usedSms`.
 */
export async function getSmsStatus(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const u = await getSmsUsage(orgId)
    res.json({
      success: true,
      data: {
        configured: isSmsConfigured(),
        used: u.usedMonthSegments,
        limit: u.monthlyLimit,
        remaining: Math.max(0, u.monthlyLimit - u.usedMonthSegments),
        usedSms: u.usedMonthSms,
        dailyMax: u.dailyMax,
        usedToday: u.usedTodaySegments,
        unit: 'segment',
      },
    })
  } catch (err) { next(err) }
}

/**
 * GET /reminders/logs?entityId= — SMS jurnali (oxirgi 100), tuman doirasida.
 * Admin — butun korxona; boshqalar — faqat o'z tumanlaridagi tashkilotlar SMS'lari.
 */
export async function listSmsLogs(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { orgId } = user
    const { entityId } = req.query as Record<string, string>
    const where: any = { orgId }

    if (entityId) {
      const ent = await (prisma as any).ekoHisobLegalEntity.findUnique({
        where: { id: entityId }, select: { orgId: true, districtId: true },
      })
      if (!ent || ent.orgId !== orgId) { res.status(404).json({ success: false, error: 'Tashkilot topilmadi' }); return }
      if (!canAccessEntity(user, ent)) { res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' }); return }
      where.entityId = entityId
    } else if (!isEkoAdmin(user)) {
      const ids = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: entityScopeWhere(user), select: { id: true },
      })
      where.entityId = { in: ids.map((e: any) => e.id) }
    }

    const logs = await (prisma as any).ekoHisobSmsLog.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
    })
    // Qo'shimcha maydon: tashkilot nomi (mavjud maydonlar o'zgarmaydi)
    const entIds = [...new Set(logs.map((l: any) => l.entityId).filter(Boolean))] as string[]
    const names = entIds.length
      ? await (prisma as any).ekoHisobLegalEntity.findMany({ where: { id: { in: entIds }, orgId }, select: { id: true, name: true } })
      : []
    const nameMap = new Map<string, string>(names.map((n: any) => [n.id, n.name]))
    res.json({
      success: true,
      data: logs.map((l: any) => ({ ...l, entityName: l.entityId ? (nameMap.get(l.entityId) ?? null) : null })),
    })
  } catch (err) { next(err) }
}

/**
 * GET /reminders/effectiveness?days=90 — SMS samaradorligi: SMS'dan keyin 7 kun ichida
 * to'lov qilgan tashkilotlar ulushi (tuman doirasida).
 */
export async function getSmsEffectiveness(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { orgId } = user
    const days = Math.min(365, Math.max(14, parseInt(String(req.query.days ?? '90'), 10) || 90))
    const now = new Date()
    const since = new Date(now.getTime() - days * 24 * 3600_000)

    const where: any = { orgId, status: 'sent', entityId: { not: null }, createdAt: { gte: since } }
    if (!isEkoAdmin(user)) {
      const ids = await (prisma as any).ekoHisobLegalEntity.findMany({ where: entityScopeWhere(user), select: { id: true } })
      where.entityId = { in: ids.map((e: any) => e.id) }
    }
    const sms = await (prisma as any).ekoHisobSmsLog.findMany({
      where, select: { entityId: true, createdAt: true, kind: true }, take: 50000,
    })
    const entityIds = [...new Set(sms.map((s: any) => s.entityId))] as string[]
    const payments = entityIds.length
      ? await (prisma as any).ekoHisobPayment.findMany({
          where: { entityId: { in: entityIds }, paidAt: { gte: since }, amount: { gt: 0 } },
          select: { entityId: true, paidAt: true, amount: true }, take: 200000,
        })
      : []

    const overall = computeSmsEffectiveness(
      sms.map((s: any) => ({ entityId: s.entityId, at: s.createdAt })),
      payments, now, 7,
    )
    const byKind: Record<string, ReturnType<typeof computeSmsEffectiveness>> = {}
    for (const kind of ['auto', 'escalation', 'manual']) {
      const part = sms.filter((s: any) => s.kind === kind)
      if (part.length > 0) {
        byKind[kind] = computeSmsEffectiveness(
          part.map((s: any) => ({ entityId: s.entityId, at: s.createdAt })), payments, now, 7,
        )
      }
    }
    res.json({ success: true, data: { days, ...overall, byKind } })
  } catch (err) { next(err) }
}

/**
 * PATCH /entities/:id/sms-optout  { smsOptOut: boolean }
 * Mijoz SMS olishni rad etganini tashkilot kartasidan belgilash (tuman tekshiruvi + audit).
 */
export async function setSmsOptOut(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { smsOptOut } = req.body ?? {}
    if (typeof smsOptOut !== 'boolean') {
      res.status(400).json({ success: false, error: "smsOptOut true/false bo'lishi kerak" })
      return
    }
    const ent = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id: req.params.id },
      select: { id: true, orgId: true, districtId: true, name: true, smsOptOut: true },
    })
    if (!ent || ent.orgId !== user.orgId) { res.status(404).json({ success: false, error: 'Tashkilot topilmadi' }); return }
    if (!canAccessEntity(user, ent)) { res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' }); return }

    if (ent.smsOptOut !== smsOptOut) {
      await (prisma as any).ekoHisobLegalEntity.updateMany({
        where: { id: ent.id, orgId: user.orgId }, data: { smsOptOut },
      })
      await logEkoAudit(user, {
        action: 'entity.update', targetType: 'entity', targetId: ent.id, targetName: ent.name,
        details: { smsOptOut: { from: ent.smsOptOut, to: smsOptOut } },
      })
    }
    res.json({ success: true, data: { id: ent.id, smsOptOut } })
  } catch (err) { next(err) }
}
