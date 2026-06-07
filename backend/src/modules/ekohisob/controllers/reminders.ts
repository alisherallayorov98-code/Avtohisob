import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { sendSms, normalizePhone, isSmsConfigured } from '../services/sms'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

// Har korxonaga oylik SMS limiti. Super-admin ENV orqali belgilaydi (EKO_SMS_MONTHLY_LIMIT).
// Nazorat orgId bo'yicha: har korxona faqat O'Z limitini sarflaydi — biri boshqasiga ta'sir qilmaydi.
const DEFAULT_SMS_MONTHLY_LIMIT = 1000

function getMonthlyLimit(): number {
  const v = parseInt(process.env.EKO_SMS_MONTHLY_LIMIT || '', 10)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SMS_MONTHLY_LIMIT
}

// Shu oy (joriy oy boshidan) shu korxona yuborgan muvaffaqiyatli SMS soni
async function countSmsThisMonth(orgId: string): Promise<number> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return (prisma as any).ekoHisobSmsLog.count({
    where: { orgId, status: 'sent', createdAt: { gte: monthStart } },
  })
}

// Tashkilot jami qarzini hisoblaydi: ochiq/qisman charge'lar + to'lanmagan talonlar
async function calcDebt(entityId: string): Promise<{ total: number; chargeMonths: number; talonCount: number }> {
  const charges = await (prisma as any).ekoHisobCharge.findMany({
    where: { entityId, status: { in: ['open', 'partial'] } },
    select: { expectedAmount: true, paidAmount: true },
  })
  const chargeDebt = charges.reduce((s: number, c: any) => s + Math.max(0, c.expectedAmount - c.paidAmount), 0)
  const talons = await (prisma as any).ekoHisobTalon.findMany({
    where: { entityId, paid: false }, select: { amount: true },
  })
  const talonDebt = talons.reduce((s: number, t: any) => s + t.amount, 0)
  return { total: chargeDebt + talonDebt, chargeMonths: charges.length, talonCount: talons.length }
}

// SMS matni (shablon). Eskiz real rejimida tasdiqlangan shablon bo'lishi kerak —
// keyingi bosqichda korxona darajasida sozlanadigan bo'ladi.
function buildMessage(entityName: string, debt: number, contactPhone?: string): string {
  let msg = `Hurmatli ${entityName}! Chiqindi xizmati uchun qarzingiz ${fmt(debt)} som. Iltimos tolovni amalga oshiring.`
  if (contactPhone) msg += ` Aloqa: ${contactPhone}`
  return msg
}

/**
 * POST /reminders/sms  { entityId }
 * Tashkilot qarzini hisoblab, uning telefoniga SMS eslatma yuboradi va jurnalga yozadi.
 */
export async function sendDebtReminder(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId, role, districtIds } = req.ekoUser!
    const { entityId } = req.body
    if (!entityId) {
      res.status(400).json({ success: false, error: 'entityId talab qilinadi' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    // Inspektor faqat o'z tumanidagi tashkilotga yubora oladi (admin — hammasi)
    if (role !== 'admin' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }
    if (!entity.phone || !normalizePhone(entity.phone)) {
      res.status(400).json({ success: false, error: 'Tashkilotning to\'g\'ri telefon raqami yo\'q' })
      return
    }

    const { total } = await calcDebt(entityId)
    if (total <= 0) {
      res.status(400).json({ success: false, error: 'Bu tashkilotda qarz yo\'q' })
      return
    }

    // Oylik SMS limiti nazorati — korxona o'z limitini oshira olmaydi
    const limit = getMonthlyLimit()
    const used = await countSmsThisMonth(orgId)
    if (used >= limit) {
      res.status(429).json({
        success: false,
        error: `Oylik SMS limiti tugadi (${used}/${limit}). Keyingi oy yangilanadi yoki super-admin bilan bog'laning.`,
      })
      return
    }

    const message = buildMessage(entity.name, total, entity.phone || undefined)
    const result = await sendSms(entity.phone, message)

    // Har holatda jurnalga yozamiz (muvaffaqiyat yoki xato)
    await (prisma as any).ekoHisobSmsLog.create({
      data: {
        orgId, entityId,
        phone: normalizePhone(entity.phone) || entity.phone,
        message,
        status: result.ok ? 'sent' : 'failed',
        providerMsgId: result.msgId ?? null,
        error: result.error ?? null,
        sentBy: userId || null,
      },
    })

    if (!result.ok) {
      res.status(400).json({ success: false, error: result.error || 'SMS yuborilmadi' })
      return
    }
    res.json({ success: true, data: { sent: true, debt: total } })
  } catch (err) { next(err) }
}

/**
 * GET /reminders/status — SMS xizmati sozlanganmi (UI tugmasi uchun)
 */
export async function getSmsStatus(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const limit = getMonthlyLimit()
    const used = await countSmsThisMonth(orgId)
    res.json({
      success: true,
      data: { configured: isSmsConfigured(), used, limit, remaining: Math.max(0, limit - used) },
    })
  } catch (err) { next(err) }
}

/**
 * GET /reminders/logs?entityId= — SMS jurnali (oxirgi 100)
 */
export async function listSmsLogs(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { entityId } = req.query as Record<string, string>
    const where: any = { orgId }
    if (entityId) where.entityId = entityId
    const logs = await (prisma as any).ekoHisobSmsLog.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
    })
    res.json({ success: true, data: logs })
  } catch (err) { next(err) }
}
