import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { getEkoBotUsername } from '../../../services/ekoFieldBot'
import crypto from 'crypto'

export async function generateLinkToken(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { userId } = req.body
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId majburiy' })
      return
    }
    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, orgId: true },
    })
    if (!user || user.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }
    // Eski tokenlarni o'chirish
    await (prisma as any).ekoHisobLinkToken.deleteMany({ where: { userId } })
    // 6 belgili token (HEX, katta harf)
    const token = crypto.randomBytes(3).toString('hex').toUpperCase()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 kun
    await (prisma as any).ekoHisobLinkToken.create({ data: { token, userId, expiresAt } })
    // Deep-link: inspektor havolani bosib "Start" bossa, token avtomatik yuboriladi
    const botUsername = getEkoBotUsername()
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${token}` : null
    res.json({ success: true, data: { token, expiresAt, userName: user.fullName, botUsername, deepLink } })
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
    res.json({ success: true, data: { linked: !!link, pendingToken: pendingToken?.token ?? null } })
  } catch (err) { next(err) }
}
