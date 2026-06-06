import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { successResponse } from '../types'
import { sendSms, smsConfigured } from '../services/smsService'

// Telefon raqamini normallashtirish: faqat raqamlar, 998 bilan
function normalizePhone(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, '')
  // 901234567 (9) → 998901234567; 998901234567 (12) → o'zi
  if (digits.length === 9) return '998' + digits
  if (digits.length === 12 && digits.startsWith('998')) return digits
  return null
}

// In-memory tasdiqlash kodlari: phone → { codeHash, expiresAt, attempts, lastSent }
interface CodeEntry { codeHash: string; expiresAt: number; attempts: number; lastSent: number }
const codes = new Map<string, CodeEntry>()

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

// Eskirgan kodlarni tozalash (har chaqiruvda)
function cleanExpired() {
  const now = Date.now()
  for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k)
}

/**
 * POST /auth/signup/send-code
 * { phone } → SMS tasdiqlash kodi yuboradi
 */
export async function signupSendCode(req: Request, res: Response, next: NextFunction) {
  try {
    cleanExpired()
    const phone = normalizePhone(req.body.phone)
    if (!phone) throw new AppError('Telefon raqami noto\'g\'ri. Masalan: 901234567', 400)

    // Bu telefon allaqachon ro'yxatdan o'tganmi?
    const existing = await (prisma as any).user.findFirst({ where: { phone } })
    if (existing) throw new AppError('Bu raqam allaqachon ro\'yxatdan o\'tgan. Tizimga kiring.', 409)

    // Throttle: 60 soniyada bir marta
    const prev = codes.get(phone)
    if (prev && Date.now() - prev.lastSent < 60_000) {
      throw new AppError('Kod yaqinda yuborildi. 1 daqiqadan keyin qayta urinib ko\'ring.', 429)
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)) // 6 raqam
    codes.set(phone, {
      codeHash: hashCode(code),
      expiresAt: Date.now() + 5 * 60_000, // 5 daqiqa
      attempts: 0,
      lastSent: Date.now(),
    })

    const message = `AvtoHisob ro'yxatdan o'tish kodi: ${code}. Hech kimga aytmang.`
    const { devMode } = await sendSms(phone, message)

    res.json(successResponse(
      // Dev-rejimda (SMS sozlanmagan) kodni qaytaramiz — test uchun
      { sent: true, devMode, ...(devMode ? { devCode: code } : {}) },
      devMode
        ? 'SMS xizmati sozlanmagan — kod konsolda (dev rejim)'
        : 'Tasdiqlash kodi yuborildi',
    ))
  } catch (err) { next(err) }
}

/**
 * POST /auth/signup/verify
 * { phone, code, fullName, orgName, password } → tashkilot + admin + 14-kun trial yaratadi
 */
export async function signupVerify(req: Request, res: Response, next: NextFunction) {
  try {
    cleanExpired()
    const { code, fullName, orgName, password } = req.body
    const phone = normalizePhone(req.body.phone)
    if (!phone) throw new AppError('Telefon raqami noto\'g\'ri', 400)
    if (!code) throw new AppError('Tasdiqlash kodi talab qilinadi', 400)
    if (!fullName || String(fullName).trim().length < 2) throw new AppError('Ism familiya kiriting', 400)
    if (!orgName || String(orgName).trim().length < 2) throw new AppError('Tashkilot nomini kiriting', 400)
    if (!password || String(password).length < 8) throw new AppError('Parol kamida 8 ta belgi', 400)

    const entry = codes.get(phone)
    if (!entry) throw new AppError('Kod topilmadi yoki muddati o\'tgan. Qayta yuboring.', 400)
    if (entry.expiresAt < Date.now()) { codes.delete(phone); throw new AppError('Kod muddati o\'tgan. Qayta yuboring.', 400) }
    if (entry.attempts >= 5) { codes.delete(phone); throw new AppError('Juda ko\'p urinish. Kodni qayta yuboring.', 429) }

    entry.attempts++
    if (entry.codeHash !== hashCode(String(code))) {
      throw new AppError('Kod noto\'g\'ri', 400)
    }

    // Kod to'g'ri — tashkilot yaratamiz
    const existing = await (prisma as any).user.findFirst({ where: { phone } })
    if (existing) { codes.delete(phone); throw new AppError('Bu raqam allaqachon ro\'yxatdan o\'tgan', 409) }

    const email = `${phone}@avtohisob.internal`
    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))

    const result = await prisma.$transaction(async (tx) => {
      // 1. Branch (o'z-o'ziga ishora qiluvchi root)
      const branch = await tx.branch.create({ data: { name: String(orgName).trim(), location: '', contactPhone: phone } })
      await (tx as any).branch.update({ where: { id: branch.id }, data: { organizationId: branch.id } })

      // 2. Admin foydalanuvchi
      const user = await (tx as any).user.create({
        data: {
          email, phone, passwordHash, fullName: String(fullName).trim(),
          role: 'admin', branchId: branch.id,
          emailVerified: true, // telefon tasdiqlangan
        },
      })

      // 3. 14 kunlik trial obuna (professional plan)
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      const plan = await (tx as any).plan.findFirst({ where: { type: 'professional' } })
        ?? await (tx as any).plan.findFirst({ where: { type: 'starter' } })
        ?? await (tx as any).plan.findFirst()
      if (plan) {
        await (tx as any).subscription.create({
          data: {
            userId: user.id,
            planId: plan.id,
            status: 'trialing',
            currentPeriodStart: new Date(),
            currentPeriodEnd: trialEnd,
            trialEndsAt: trialEnd,
          },
        })
      }
      return { branch, user, trialEnd }
    })

    codes.delete(phone)

    // Token berib darrov kiritamiz
    const payload = { id: result.user.id, email, role: 'admin', branchId: result.branch.id, fullName: result.user.fullName }
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h' })
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })

    res.status(201).json(successResponse({
      user: {
        id: result.user.id, email, phone, fullName: result.user.fullName,
        role: 'admin', branchId: result.branch.id, isActive: true,
      },
      accessToken, refreshToken,
      trialEndsAt: result.trialEnd,
    }, 'Ro\'yxatdan o\'tildi! 14 kunlik bepul sinov boshlandi.'))
  } catch (err) { next(err) }
}

export { smsConfigured }
