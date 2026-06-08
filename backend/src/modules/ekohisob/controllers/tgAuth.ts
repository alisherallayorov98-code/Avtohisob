import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../../../lib/prisma'

/**
 * Telegram Mini App (Web App) initData ni tekshiradi.
 * Telegram imzosini bot token bilan tasdiqlaymiz — soxta so'rovlardan himoya.
 * Hujjat: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyTelegramWebApp(initData: string, botToken: string): any | null {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    if (computed !== hash) return null

    // auth_date — 24 soatdan eski bo'lmasin (qayta yuborishdan himoya)
    const authDate = Number(params.get('auth_date'))
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null

    const userStr = params.get('user')
    return userStr ? JSON.parse(userStr) : null
  } catch {
    return null
  }
}

/**
 * POST /ekohisob/tg/auth  { initData }
 * Telegram Mini App ochilganda chaqiriladi. initData tasdiqlanib, ulangan
 * EkoHisob foydalanuvchisi topiladi va unga EkoHisob JWT beriladi (8 soat).
 * Login/parol kerak emas — Telegram orqali avtomatik autentifikatsiya.
 */
export async function tgWebAppAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { initData } = req.body
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
    if (!link || !link.user || !link.user.isActive) {
      res.status(403).json({ success: false, error: 'Bu Telegram hisobi EkoHisob bilan ulanmagan. Admindan havola oling.' })
      return
    }

    const u = link.user
    const districtIds = u.districts.map((d: any) => d.districtId)
    const token = jwt.sign(
      { id: u.id, email: u.email, role: u.role, orgId: u.orgId, districtIds, eko: true },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' },
    )

    res.json({
      success: true,
      data: { token, user: { id: u.id, fullName: u.fullName, role: u.role, districtIds } },
    })
  } catch (err) { next(err) }
}
