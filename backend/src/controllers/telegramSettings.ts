import { Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { sendTelegramMessage } from '../services/telegramService'
import { resolveOrgId } from '../lib/orgFilter'

/** GET /api/telegram/settings */
export async function getTelegramSettings(req: AuthRequest, res: Response) {
  const orgId = await resolveOrgId(req.user!)
  if (!orgId) return res.json({ configured: false })
  const s = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
  res.json({
    configured: !!(s?.telegramBotToken && s?.telegramChatId),
    chatId: s?.telegramChatId ?? null,
    hasToken: !!s?.telegramBotToken,
  })
}

/** POST /api/telegram/settings */
export async function saveTelegramSettings(req: AuthRequest, res: Response) {
  const { telegramBotToken, telegramChatId } = req.body
  const orgId = await resolveOrgId(req.user!)
  if (!orgId) return res.status(403).json({ error: "Ruxsat yo'q" })

  await (prisma as any).orgSettings.upsert({
    where: { orgId },
    create: { orgId, telegramBotToken: telegramBotToken || null, telegramChatId: telegramChatId || null },
    update: { telegramBotToken: telegramBotToken || null, telegramChatId: telegramChatId || null },
  })
  res.json({ success: true })
}

/** POST /api/telegram/test */
export async function testTelegram(req: AuthRequest, res: Response) {
  const orgId = await resolveOrgId(req.user!)
  if (!orgId) return res.status(403).json({ error: "Ruxsat yo'q" })

  const s = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
  if (!s?.telegramBotToken || !s?.telegramChatId) {
    return res.status(400).json({ error: 'Telegram sozlanmagan' })
  }

  const ok = await sendTelegramMessage(
    s.telegramBotToken,
    s.telegramChatId,
    '✅ <b>AutoHisob — Telegram ulanishi muvaffaqiyatli!</b>\n\nOgohlantirish xabarlari shu yerga keladi.'
  )

  if (ok) res.json({ success: true, message: "Test xabar yuborildi" })
  else res.status(400).json({ error: "Xabar yuborilmadi. Token yoki Chat ID ni tekshiring." })
}
