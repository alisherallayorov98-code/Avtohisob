import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'

// Telegram initData HMAC-SHA256 tekshiruvi
function validateInitData(initData: string, botToken: string): { tgUserId: string; firstName: string } | null {
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
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    if (expectedHash !== hash) return null

    // auth_date — 1 soatdan eski bo'lmasin
    const authDate = Number(params.get('auth_date') || 0)
    if (Date.now() / 1000 - authDate > 3600) return null

    const tgUser = JSON.parse(params.get('user') || '{}')
    return { tgUserId: String(tgUser.id), firstName: tgUser.first_name || '' }
  } catch {
    return null
  }
}

// POST /api/tma/auth
export async function tmaAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const { initData } = req.body
    if (!initData) return res.status(400).json({ error: 'initData talab qilinadi' })

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) return res.status(503).json({ error: 'Telegram bot sozlanmagan' })

    const validated = validateInitData(initData, botToken)
    if (!validated) return res.status(401).json({ error: 'Telegram ma\'lumotlari tasdiqlanmadi' })

    const link = await prisma.telegramLink.findUnique({
      where: { chatId: validated.tgUserId },
      include: {
        user: { select: { id: true, fullName: true, role: true, branchId: true, isActive: true } },
      },
    })

    if (!link) {
      return res.status(404).json({
        error: 'Telegram akkaunt bog\'lanmagan',
        hint: 'Botga /start buyrug\'ini yuboring',
      })
    }
    if (!link.user.isActive) return res.status(403).json({ error: 'Foydalanuvchi faol emas' })

    await prisma.telegramLink.update({ where: { chatId: validated.tgUserId }, data: { lastActiveAt: new Date() } })

    // Mavjud auth tizimi bilan bir xil format — `id` field
    const token = jwt.sign(
      { id: link.user.id, role: link.user.role, branchId: link.user.branchId, source: 'tma' },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: { id: link.user.id, fullName: link.user.fullName, role: link.user.role },
    })
  } catch (err) { next(err) }
}

// GET /api/tma/me — token tekshirish + user ma'lumoti
export async function tmaMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user
    res.json({ id: user.id, fullName: user.fullName, role: user.role, branchId: user.branchId })
  } catch (err) { next(err) }
}
