/**
 * Landing'dan kelgan arizalar (leads) — sotuv va marketing uchun.
 *
 * Public endpoint: /api/public/leads — autentifikatsiyasiz, rate-limited.
 * Admin endpoint: /api/admin/leads — super_admin ko'radi va boshqaradi.
 *
 * Hech qanday org'ga bog'lanmagan — sof CRM lead'lar.
 */
import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse, parseLimit, parsePage } from '../types'
import { AppError } from '../middleware/errorHandler'
import { sendToUser } from '../services/telegramBot'

const PHONE_RE = /^\+?[0-9]{9,15}$/

// ─── Public: ariza topshirish (no auth) ──────────────────────────────────────
export async function submitLead(req: Request, res: Response, next: NextFunction) {
  try {
    const { fullName, phone, email, organizationName, fleetSize, message } = req.body || {}

    if (!fullName?.trim() || fullName.trim().length < 2) {
      throw new AppError('F.I.SH. kiritilishi shart (kamida 2 belgi)', 400)
    }
    if (!phone?.trim() || !PHONE_RE.test(String(phone).replace(/\s/g, ''))) {
      throw new AppError('Telefon raqami noto\'g\'ri (+998... formatida)', 400)
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('Email noto\'g\'ri formatda', 400)
    }
    if (fleetSize !== undefined && fleetSize !== null && fleetSize !== '') {
      const n = Number(fleetSize)
      if (!Number.isInteger(n) || n < 0 || n > 100000) {
        throw new AppError('Mashinalar soni 0-100000 oralig\'ida bo\'lishi kerak', 400)
      }
    }

    // Spam himoya: bir IP dan 24 soatda 3 ta'dan ko'p ariza qabul qilmaymiz
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    if (ipAddress) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recent = await (prisma as any).lead.count({
        where: { ipAddress, createdAt: { gte: since } },
      })
      if (recent >= 3) {
        throw new AppError('Juda ko\'p ariza yuborildi. 24 soatdan keyin urinib ko\'ring.', 429)
      }
    }

    const lead = await (prisma as any).lead.create({
      data: {
        fullName: fullName.trim().slice(0, 200),
        phone: String(phone).replace(/\s/g, '').slice(0, 20),
        email: email?.trim().toLowerCase().slice(0, 200) || null,
        organizationName: organizationName?.trim().slice(0, 200) || null,
        fleetSize: fleetSize !== undefined && fleetSize !== '' ? Number(fleetSize) : null,
        message: message?.trim().slice(0, 2000) || null,
        source: 'landing',
        referrer: (req.headers.referer as string)?.slice(0, 500) || null,
        ipAddress: ipAddress?.slice(0, 60) || null,
        userAgent: (req.headers['user-agent'] as string)?.slice(0, 500) || null,
      },
    })

    // Super_admin'larga Telegram orqali xabar (fire-and-forget)
    notifyAdminsAboutLead(lead).catch(() => {})

    res.status(201).json({
      success: true,
      message: 'Arizangiz qabul qilindi! 24 soat ichida bog\'lanamiz.',
      data: { id: lead.id },
    })
  } catch (err) { next(err) }
}

// Super_admin'larga yangi lead haqida Telegram xabar yuborish
async function notifyAdminsAboutLead(lead: any) {
  const admins = await prisma.user.findMany({
    where: { role: 'super_admin', isActive: true },
    select: { id: true },
  })
  if (admins.length === 0) return

  const text = [
    '🆕 <b>Yangi ariza — Avtohisob landing</b>',
    '',
    `👤 ${lead.fullName}`,
    `📞 ${lead.phone}`,
    lead.email ? `✉️ ${lead.email}` : null,
    lead.organizationName ? `🏢 ${lead.organizationName}` : null,
    lead.fleetSize ? `🚛 ${lead.fleetSize} ta texnika` : null,
    lead.message ? `\n💬 ${lead.message}` : null,
    '',
    `🌐 IP: ${lead.ipAddress || '—'}`,
    `⏰ ${new Date(lead.createdAt).toLocaleString('uz-UZ')}`,
  ].filter(Boolean).join('\n')

  for (const a of admins) {
    await sendToUser(a.id, text).catch(() => {})
  }
}

// ─── Admin: arizalar ro'yxati ─────────────────────────────────────────────────
export async function listLeads(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const { page, limit, skip } = paginate(req.query)
    const { status, search } = req.query as any
    const where: any = {}
    if (status) where.status = status
    if (search?.trim()) {
      const q = search.trim()
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
        { organizationName: { contains: q, mode: 'insensitive' } },
      ]
    }
    const [total, leads, byStatus] = await Promise.all([
      (prisma as any).lead.count({ where }),
      (prisma as any).lead.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      (prisma as any).lead.groupBy({
        by: ['status'],
        _count: true,
      }),
    ])
    res.json({
      success: true,
      data: leads,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      stats: byStatus.reduce((acc: any, b: any) => ({ ...acc, [b.status]: b._count }), {}),
    })
  } catch (err) { next(err) }
}

// ─── Admin: bitta arizani ko'rish ─────────────────────────────────────────────
export async function getLead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const lead = await (prisma as any).lead.findUnique({ where: { id: req.params.id } })
    if (!lead) throw new AppError('Ariza topilmadi', 404)
    res.json(successResponse(lead))
  } catch (err) { next(err) }
}

// ─── Admin: ariza statusini yangilash + izoh ──────────────────────────────────
export async function updateLead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    const { status, notes } = req.body
    const allowed = ['new', 'contacted', 'converted', 'rejected', 'spam']
    if (status && !allowed.includes(status)) throw new AppError(`Noto'g'ri status. Mumkin: ${allowed.join(', ')}`, 400)

    const data: any = {}
    if (status) {
      data.status = status
      if (status === 'contacted') data.contactedAt = new Date()
      if (status === 'converted') data.convertedAt = new Date()
    }
    if (notes !== undefined) data.notes = notes?.trim() || null

    const lead = await (prisma as any).lead.update({ where: { id: req.params.id }, data })
    res.json(successResponse(lead, 'Yangilandi'))
  } catch (err) { next(err) }
}

// ─── Admin: o'chirish ────────────────────────────────────────────────────────
export async function deleteLead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'super_admin') throw new AppError("Ruxsat yo'q", 403)
    await (prisma as any).lead.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, "O'chirildi"))
  } catch (err) { next(err) }
}
