import { Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getBotUsername, isBotEnabled, sendToUser } from '../services/telegramBot'

const TOKEN_TTL_MIN = 10

/**
 * POST /api/telegram/link-token
 * Foydalanuvchiga 10 daqiqalik ulash tokeni va deep-link qaytaradi.
 */
export async function createLinkToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isBotEnabled()) {
      throw new AppError("Telegram bot server sozlanmagan", 503)
    }
    const username = getBotUsername()
    if (!username) throw new AppError('Bot username mavjud emas', 503)

    const token = crypto.randomBytes(16).toString('hex')
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000)

    await (prisma as any).telegramLinkToken.create({
      data: { token, userId: req.user!.id, expiresAt },
    })

    res.json(successResponse({
      token,
      expiresAt: expiresAt.toISOString(),
      deepLink: `https://t.me/${username}?start=${token}`,
      botUsername: username,
      ttlMinutes: TOKEN_TTL_MIN,
    }))
  } catch (err) { next(err) }
}

/** GET /api/telegram/links — shu userning ulangan qurilmalari ro'yxati */
export async function listLinks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const links = await (prisma as any).telegramLink.findMany({
      where: { userId: req.user!.id },
      orderBy: { linkedAt: 'asc' },
      select: { id: true, chatId: true, deviceLabel: true, linkedAt: true, lastActiveAt: true },
    })
    res.json(successResponse(links))
  } catch (err) { next(err) }
}

/** PATCH /api/telegram/links/:id — qurilma nomini yangilash (deviceLabel) */
export async function renameLink(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const { deviceLabel } = req.body
    const link = await (prisma as any).telegramLink.findUnique({ where: { id } })
    if (!link) throw new AppError('Ulanish topilmadi', 404)
    if (link.userId !== req.user!.id) throw new AppError("Ruxsat yo'q", 403)

    const updated = await (prisma as any).telegramLink.update({
      where: { id },
      data: { deviceLabel: deviceLabel?.trim() || null },
    })
    res.json(successResponse(updated, 'Nom yangilandi'))
  } catch (err) { next(err) }
}

/** DELETE /api/telegram/links/:id — qurilmani ajratish */
export async function deleteLink(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const link = await (prisma as any).telegramLink.findUnique({ where: { id } })
    if (!link) throw new AppError('Ulanish topilmadi', 404)
    if (link.userId !== req.user!.id) throw new AppError("Ruxsat yo'q", 403)

    await (prisma as any).telegramLink.delete({ where: { id } })
    res.json(successResponse(null, 'Qurilma ajratildi'))
  } catch (err) { next(err) }
}

/** POST /api/telegram/test-message — ulangan barcha qurilmalarga test yuborish */
export async function testMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isBotEnabled()) throw new AppError('Telegram bot sozlanmagan', 503)
    const sent = await sendToUser(req.user!.id, '✅ <b>Test xabar</b>\n\nAutoHisob Telegram bog\'lanishi ishlayapti.')
    if (sent === 0) throw new AppError("Hech qanday qurilmaga yuborilmadi. Avval qurilma ulang.", 400)
    res.json(successResponse({ sent }, `${sent} ta qurilmaga yuborildi`))
  } catch (err) { next(err) }
}
