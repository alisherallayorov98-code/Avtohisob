import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { isValidIsoDate, dayBoundsUz } from '../lib/uzt'
import { parsePageParams } from '../lib/ekoValidate'

// Amal nomlarining o'zbekcha tavsifi — UI'da tushunarli ko'rinishi uchun
const ACTION_LABELS: Record<string, string> = {
  'payment.create': 'To\'lov qabul qilindi',
  'payment.delete': 'To\'lov bekor qilindi',
  'talon.create': 'Talon qo\'shildi',
  'talon.update': 'Talon o\'zgartirildi',
  'talon.paid': 'Talon to\'landi',
  'talon.unpaid': 'Talon to\'lovi bekor qilindi',
  'talon.delete': 'Talon o\'chirildi',
  'entity.deactivate': 'Tashkilot deaktiv qilindi',
  'charge.recalc': 'Hisoblar qayta hisoblandi',
  'charge.generate': 'Oylik hisoblar yaratildi',
  'entity.create': "Tashkilot qo'shildi",
  'entity.update': "Tashkilot o'zgartirildi",
  'entity.location': "Tashkilot joylashuvi o'zgartirildi",
  'entity.billing_mode': "To'lov rejimi o'zgartirildi",
  'entity.export': 'Tashkilotlar eksport qilindi',
  'entity.import': 'Excel import',
  'entity.import_undo': 'Import bekor qilindi',
  'user.create': "Xodim qo'shildi",
  'user.update': "Xodim o'zgartirildi",
  'user.role_change': "Xodim roli o'zgartirildi",
  'user.deactivate': 'Xodim deaktiv qilindi',
  'user.activate': 'Xodim faollashtirildi',
  'user.districts': "Xodim tumanlari o'zgartirildi",
  'user.password_reset': 'Parol admin tomonidan almashtirildi',
  'user.password_change': "Parol o'zgartirildi",
  'user.login_locked': "Hisob noto'g'ri urinishlar tufayli bloklandi",
  'user.bot_link': 'Telegram ulash havolasi berildi',
  'user.bot_unlink': "Telegram bog'lanishi uzildi",
  'blacklist.add': "Qora ro'yxatga qo'shildi",
  'blacklist.update': "Qora ro'yxat yozuvi o'zgartirildi",
  'blacklist.remove': "Qora ro'yxatdan chiqarildi",
  'district.create': "Tuman qo'shildi",
  'district.update': "Tuman o'zgartirildi",
  'mahalla.create': "Mahalla qo'shildi",
  'mahalla.update': "Mahalla o'zgartirildi",
  'mahalla.delete': "Mahalla o'chirildi",
  'soliq.lookup': "Soliq ma'lumoti so'raldi",
  'receipt.view': 'Kvitansiya ochildi',
  'receipt.print': 'Kvitansiya chop etildi',
  'report.export': 'Hisobot eksport qilindi',
  'visit.create': 'Tashrif qaydi',
}

/**
 * GET /audit — pulga ta'sir qiluvchi amallar jurnali (faqat admin).
 * Filtrlar: action, userId, entityId (targetId), from, to. Sahifalash: page/limit.
 */
export async function listAuditLogs(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { action, userId, targetId, from, to, page = '1', limit = '50' } = req.query as Record<string, string>

    const { page: pageN, limit: take, skip } = parsePageParams(page, limit, { defaultLimit: 50, maxLimit: 200 })

    const where: any = { orgId }
    if (action) where.action = String(action).slice(0, 60)
    if (userId) where.userId = String(userId).slice(0, 64)
    if (targetId) where.targetId = String(targetId).slice(0, 64)
    if (from || to) {
      // Sana oralig'i O'zbekiston kuni bo'yicha (UTC+5); noto'g'ri sana 400
      if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to))) {
        res.status(400).json({ success: false, error: "Sana formati noto'g'ri (YYYY-MM-DD)" })
        return
      }
      where.createdAt = {}
      if (from) where.createdAt.gte = dayBoundsUz(from)!.start
      // `to` kunining oxirigacha kirsin
      if (to) where.createdAt.lt = dayBoundsUz(to)!.end
    }

    const [total, logs] = await Promise.all([
      (prisma as any).ekoHisobAuditLog.count({ where }),
      (prisma as any).ekoHisobAuditLog.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json({
      success: true,
      data: logs.map((l: any) => ({ ...l, actionLabel: ACTION_LABELS[l.action] ?? l.action })),
      meta: { total, page: pageN, limit: take },
    })
  } catch (err) { next(err) }
}

/**
 * GET /audit/summary — oxirgi 30 kunda amal turlari bo'yicha soni + eng faol xodimlar.
 * Rahbar "nima bo'lyapti" savoliga bir qarashda javob olishi uchun.
 */
export async function getAuditSummary(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const logs = await (prisma as any).ekoHisobAuditLog.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: { action: true, userId: true, userName: true, amount: true },
    })

    const byAction: Record<string, number> = {}
    const byUser = new Map<string, { name: string; count: number; deletedAmount: number }>()
    for (const l of logs) {
      byAction[l.action] = (byAction[l.action] || 0) + 1
      const key = l.userId || l.userName
      const cur = byUser.get(key) ?? { name: l.userName, count: 0, deletedAmount: 0 }
      cur.count++
      // Bekor qilingan pul — nazorat uchun eng muhim ko'rsatkich
      if (l.action === 'payment.delete' || l.action === 'talon.delete') {
        cur.deletedAmount += Number(l.amount || 0)
      }
      byUser.set(key, cur)
    }

    res.json({
      success: true,
      data: {
        days: 30,
        total: logs.length,
        byAction: Object.entries(byAction)
          .map(([action, count]) => ({ action, label: ACTION_LABELS[action] ?? action, count }))
          .sort((a, b) => b.count - a.count),
        byUser: Array.from(byUser.values()).sort((a, b) => b.deletedAmount - a.deletedAmount || b.count - a.count),
      },
    })
  } catch (err) { next(err) }
}
