import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { sendTelegramMessage } from '../services/telegramService'
import { resolveOrgId } from '../lib/orgFilter'
import { AppError } from '../middleware/errorHandler'

/** GET /api/telegram/settings */
export async function getTelegramSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) return res.json({ configured: false })
    const s = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
    res.json({
      configured: !!(s?.telegramBotToken && s?.telegramChatId),
      chatId: s?.telegramChatId ?? null,
      hasToken: !!s?.telegramBotToken,
    })
  } catch (err) { next(err) }
}

/** POST /api/telegram/settings */
export async function saveTelegramSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { telegramBotToken, telegramChatId } = req.body
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError("Ruxsat yo'q", 403)

    await (prisma as any).orgSettings.upsert({
      where: { orgId },
      create: { orgId, telegramBotToken: telegramBotToken || null, telegramChatId: telegramChatId || null },
      update: { telegramBotToken: telegramBotToken || null, telegramChatId: telegramChatId || null },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
}

/** POST /api/telegram/test */
export async function testTelegram(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError("Ruxsat yo'q", 403)

    const s = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
    if (!s?.telegramBotToken || !s?.telegramChatId) {
      throw new AppError('Telegram sozlanmagan', 400)
    }

    const ok = await sendTelegramMessage(
      s.telegramBotToken,
      s.telegramChatId,
      '✅ <b>AutoHisob — Telegram ulanishi muvaffaqiyatli!</b>\n\nOgohlantirish xabarlari shu yerga keladi.'
    )

    if (ok) res.json({ success: true, message: "Test xabar yuborildi" })
    else throw new AppError("Xabar yuborilmadi. Token yoki Chat ID ni tekshiring.", 400)
  } catch (err) { next(err) }
}
