import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { signEkoJwt } from '../lib/ekoJwt'
import { makeRateLimit } from '../lib/memLimiter'
import { verifyTelegramWebApp } from '../lib/tgInitData'

/** POST /tg/auth uchun: IP bo'yicha 15 daqiqada 30 ta so'rov. */
export const tgAuthRateLimit = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring.",
  key: req => `tg:${req.ip}`,
})

/**
 * POST /ekohisob/tg/auth  { initData }
 * Telegram Mini App ochilganda chaqiriladi. initData tasdiqlanib, ulangan
 * EkoHisob foydalanuvchisi topiladi va unga EkoHisob JWT beriladi (8 soat).
 * Login/parol kerak emas — Telegram orqali avtomatik autentifikatsiya.
 */
export async function tgWebAppAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { initData } = req.body ?? {}
    if (!initData || typeof initData !== 'string') {
      res.status(400).json({ success: false, error: 'initData talab qilinadi' })
      return
    }
    const botToken = process.env.EKO_FIELD_BOT_TOKEN
    if (!botToken) {
      res.status(500).json({ success: false, error: 'Bot sozlanmagan' })
      return
    }

    const tgUser = verifyTelegramWebApp(initData, botToken)
    if (!tgUser || !tgUser.id) {
      res.status(401).json({ success: false, error: 'Telegram tekshiruvi muvaffaqiyatsiz' })
      return
    }

    const chatId = String(tgUser.id)
    const link = await (prisma as any).ekoHisobBotLink.findUnique({
      where: { chatId },
      include: {
        user: { include: { districts: { select: { districtId: true } } } },
      },
    })
    if (!link || !link.user || !link.user.isActive || link.user.isMirror) {
      res.status(403).json({ success: false, error: 'Bu Telegram hisobi EkoHisob bilan ulanmagan. Admindan havola oling.' })
      return
    }

    const u = link.user
    const districtIds = u.districts.map((d: any) => d.districtId)
    const token = signEkoJwt({
      id: u.id, email: u.email, role: u.role, orgId: u.orgId, districtIds, tv: u.tokenVersion ?? 0, src: 'tg',
    })

    res.json({
      success: true,
      data: { token, user: { id: u.id, fullName: u.fullName, role: u.role, districtIds } },
    })
  } catch (err) { next(err) }
}
