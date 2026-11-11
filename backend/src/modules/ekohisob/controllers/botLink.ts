import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest, invalidateEkoUser } from '../middleware/ekoAuth'
import { getEkoBotUsername } from '../../../services/ekoFieldBot'
import { logEkoAudit } from '../lib/ekoAudit'
import {
  generateLinkTokenValue, computeLinkExpiry, maskLinkToken, checkLinkTokenRow,
  isWellFormedLinkToken, LinkTokenCheck,
} from '../lib/linkToken'
import { MemCounter } from '../lib/memLimiter'

// ── BOT AGENTI UCHUN: /start <token> tekshiruvi ──────────────────────────────
// services/ekoFieldBot.ts `ekoHisobLinkToken.findUnique` o'rniga SHU funksiyalarni chaqirishi kerak:
//   const r = await verifyLinkToken(rawToken, chatId)
//   if (!r.ok) → r.reason: 'blocked' (urinish limiti) | 'malformed' | 'not_found' | 'expired' | 'used'
//   (r.reason === 'used' bo'lsa r.row.userId bilan "allaqachon ulangansiz" tarmog'i qoladi)
//   ulashdan keyin: if (!(await markLinkTokenUsed(r.row.token))) → poyga, rad etilsin
// Urinish hisoblagichi: bir chatId uchun 15 daqiqada 5 ta XATO urinish → blocked.
const botAttempts = new MemCounter({ windowMs: 15 * 60 * 1000, max: 5 })

export type VerifyLinkResult =
  | { ok: true; row: { token: string; userId: string; user: { id: string; fullName: string; role: string } } }
  | { ok: false; reason: 'blocked' | 'malformed' | 'not_found' | LinkTokenCheck; row?: any }

export async function verifyLinkToken(rawToken: string, chatId: string): Promise<VerifyLinkResult> {
  const key = `bot:${chatId}`
  if (botAttempts.isBlocked(key)) return { ok: false, reason: 'blocked' }
  if (!isWellFormedLinkToken(rawToken)) {
    botAttempts.hit(key)
    return { ok: false, reason: 'malformed' }
  }
  const token = rawToken.trim().toUpperCase()
  const row = await (prisma as any).ekoHisobLinkToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, fullName: true, role: true, isActive: true } } },
  })
  if (!row || !row.user || !row.user.isActive) {
    botAttempts.hit(key)
    return { ok: false, reason: 'not_found' }
  }
  const state = checkLinkTokenRow(row)
  if (state !== 'ok') return { ok: false, reason: state, row }
  botAttempts.reset(key)
  return { ok: true, row }
}

/** Tokenni ATOMIK ravishda "ishlatilgan" qiladi. false = boshqa so'rov oldinroq ishlatgan / muddati o'tgan. */
export async function markLinkTokenUsed(token: string): Promise<boolean> {
  const r = await (prisma as any).ekoHisobLinkToken.updateMany({
    where: { token: token.trim().toUpperCase(), used: false, expiresAt: { gt: new Date() } },
    data: { used: true },
  })
  return r.count === 1
}

/** Muddati o'tgan tokenlarni tozalaydi (korxona doirasida). */
async function purgeExpiredTokens(orgId: string): Promise<void> {
  await (prisma as any).ekoHisobLinkToken.deleteMany({
    where: { expiresAt: { lt: new Date() }, user: { orgId } },
  }).catch(() => {})
}

export async function generateLinkToken(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { userId } = req.body ?? {}
    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ success: false, error: 'userId majburiy' })
      return
    }
    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, orgId: true, isActive: true, isMirror: true },
    })
    if (!user || user.orgId !== orgId || user.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }
    if (!user.isActive) {
      res.status(400).json({ success: false, error: 'Nofaol foydalanuvchiga havola berib bo\'lmaydi' })
      return
    }
    await purgeExpiredTokens(orgId)
    // Eski tokenlarni o'chirish
    await (prisma as any).ekoHisobLinkToken.deleteMany({ where: { userId } })
    const token = generateLinkTokenValue()
    const expiresAt = computeLinkExpiry()
    await (prisma as any).ekoHisobLinkToken.create({ data: { token, userId, expiresAt } })
    // Deep-link: inspektor havolani bosib "Start" bossa, token avtomatik yuboriladi
    const botUsername = getEkoBotUsername()
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${token}` : null

    await logEkoAudit(req.ekoUser, {
      action: 'user.bot_link', targetType: 'user', targetId: userId, targetName: user.fullName,
      details: { expiresAt },
    })
    // Token to'liq FAQAT shu javobda (bir marta) ko'rsatiladi
    res.json({ success: true, data: { token, expiresAt, userName: user.fullName, botUsername, deepLink } })
  } catch (err) { next(err) }
}

/**
 * DELETE /bot/link/:userId — inspektorning Telegram bog'lanishini uzadi.
 * Notanish qurilma ulanган bo'lsa admin shu yo'l bilan uzadi.
 * Eski tokenlar ham o'chiriladi; foydalanuvchining barcha sessiyalari bekor qilinadi (tokenVersion++),
 * shu jumladan Mini App sessiyasi.
 */
export async function unlinkBot(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { userId } = req.params
    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: userId }, select: { orgId: true, fullName: true },
    })
    if (!user || user.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }
    await (prisma as any).$transaction([
      (prisma as any).ekoHisobBotLink.deleteMany({ where: { userId } }),
      (prisma as any).ekoHisobLinkToken.deleteMany({ where: { userId } }),
      (prisma as any).ekoHisobUser.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    ])
    invalidateEkoUser(userId)
    await logEkoAudit(req.ekoUser, {
      action: 'user.bot_unlink', targetType: 'user', targetId: userId, targetName: user.fullName,
    })
    res.json({ success: true, data: null, message: 'Telegram bog\'lanishi uzildi' })
  } catch (err) { next(err) }
}

export async function getBotLinkStatus(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { userId } = req.params
    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: userId },
      select: { orgId: true },
    })
    if (!user || user.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Topilmadi' })
      return
    }
    const link = await (prisma as any).ekoHisobBotLink.findUnique({ where: { userId } })
    const pendingToken = await (prisma as any).ekoHisobLinkToken.findFirst({
      where: { userId, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      success: true,
      data: {
        linked: !!link,
        // Token ochiq matnda QAYTARILMAYDI (faqat generateLinkToken javobida bir marta). Maskalangan ko'rinish:
        pendingToken: maskLinkToken(pendingToken?.token),
        hasPendingToken: !!pendingToken,
        pendingExpiresAt: pendingToken?.expiresAt ?? null,
        tgUsername: link?.tgUsername ?? null,
        linkedAt: link?.linkedAt ?? null,
      },
    })
  } catch (err) { next(err) }
}
