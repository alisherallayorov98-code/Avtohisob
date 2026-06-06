import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import speakeasy from 'speakeasy'
import qrcode from 'qrcode'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { AuthRequest, successResponse } from '../types'
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '../lib/mailer'

function signTokens(user: { id: string; email: string; role: string; branchId: string | null; fullName: string }) {
  const payload = { id: user.id, email: user.email, role: user.role, branchId: user.branchId, fullName: user.fullName }
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h' })
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// Reset/verification tokenlarini DB da ochiq saqlash xavfli — DB compromise bo'lsa
// hech qanday parol tiklash yoki email tasdiqlash mumkin bo'ladi. Foydalanuvchiga
// xom token email orqali yuboriladi, DB da faqat SHA-256 hash saqlanadi.
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email: rawLogin, password, fullName, role, branchId } = req.body

    // Input validation
    if (!rawLogin || !password || !fullName) throw new AppError('login, password va fullName majburiy', 400)
    if (typeof password !== 'string' || password.length < 8)
      throw new AppError('Parol kamida 8 ta belgidan iborat bo\'lishi kerak', 400)
    if (typeof fullName !== 'string' || fullName.trim().length < 2)
      throw new AppError('Ism familiya kamida 2 ta belgidan iborat bo\'lishi kerak', 400)
    const allowedRoles = ['admin', 'manager', 'branch_manager', 'operator', 'ekohisob_user']
    if (role && !allowedRoles.includes(role)) throw new AppError('Noto\'g\'ri rol', 400)

    const caller = (req as any).user
    // Only super_admin can create admin users
    if (role === 'admin' && caller?.role !== 'super_admin') {
      throw new AppError('Admin foydalanuvchi yaratish uchun super_admin huquqi talab qilinadi', 403)
    }
    // Validate branchId belongs to caller's org
    if (branchId && caller && caller.role !== 'super_admin') {
      const targetBranch = await prisma.branch.findUnique({ where: { id: branchId }, select: { organizationId: true } })
      if (!targetBranch) throw new AppError('Filial topilmadi', 404)
      const callerBranch = await prisma.branch.findUnique({ where: { id: caller.branchId }, select: { organizationId: true } })
      const callerOrgId = callerBranch?.organizationId ?? caller.branchId
      const targetOrgId = targetBranch.organizationId ?? branchId
      if (targetOrgId !== callerOrgId) throw new AppError('Bu filial sizning tashkilotingizga tegishli emas', 403)
    }

    const login = String(rawLogin).trim()
    const isPhone = /^\+?[0-9]{9,15}$/.test(login.replace(/\s/g, ''))
    const email = isPhone ? `${login.replace(/\D/g, '')}@avtohisob.internal` : login.toLowerCase()
    const phone = isPhone ? login.replace(/\s/g, '') : null

    const existing = await (prisma as any).user.findFirst({
      where: isPhone ? { OR: [{ phone }, { email }] } : { email },
      select: { id: true, isActive: true },
    })
    if (existing) {
      if (!existing.isActive) throw new AppError('Bu login bloklangan. Sozlamalar → Foydalanuvchilar bo\'limida blokdan chiqaring.', 409)
      throw new AppError('Bu login allaqachon ro\'yxatdan o\'tgan', 409)
    }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    const verificationTokenRaw = crypto.randomBytes(32).toString('hex')
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const user = await (prisma as any).user.create({
      data: {
        email, phone, passwordHash, fullName: fullName.trim(),
        role: role || 'operator',
        branchId: branchId || null,
        // Admin tomonidan qo'shilgan foydalanuvchilar avtomatik tasdiqlangan
        emailVerified: true,
        verificationToken: hashToken(verificationTokenRaw),
        verificationTokenExpiry,
      },
      select: { id: true, email: true, phone: true, fullName: true, role: true, branchId: true, isActive: true, emailVerified: true, createdAt: true },
    })

    // Send verification email only for real emails (non-blocking — xato logga tushsin)
    if (!isPhone) {
      sendVerificationEmail(email, fullName, verificationTokenRaw).catch(err =>
        console.error(`[Email] verification failed (${email}):`, err.message),
      )
      sendWelcomeEmail(email, fullName).catch(err =>
        console.error(`[Email] welcome failed (${email}):`, err.message),
      )
    }

    const tokens = signTokens({ id: user.id, email: user.email, role: user.role, branchId: user.branchId, fullName: user.fullName })
    res.status(201).json(successResponse({ user, ...tokens }, 'Ro\'yxatdan o\'tildi'))
  } catch (err) { next(err) }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, totpCode } = req.body
    if (!email || !password) throw new AppError('Login va parol talab qilinadi', 400)
    const login = String(email).trim()
    const isPhone = /^\+?[0-9]{9,15}$/.test(login.replace(/\s/g, ''))
    const user = await (prisma as any).user.findFirst({
      where: isPhone
        ? { OR: [{ phone: login.replace(/\s/g, '') }, { email: login.replace(/\s/g, '') }] }
        : { email: login.toLowerCase() },
      include: { branch: { select: { id: true, name: true } } },
    })
    if (!user || !user.isActive) throw new AppError('Login yoki parol noto\'g\'ri', 401)

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) throw new AppError('Login yoki parol noto\'g\'ri', 401)

    // Subscription expiry check for admin role (active va trialing — ikkalasi ham)
    if (user.role === 'admin') {
      const sub = await (prisma as any).subscription.findUnique({ where: { userId: user.id } })
      const isTimeLimited = sub && (sub.status === 'active' || sub.status === 'trialing')
      if (isTimeLimited && new Date(sub.currentPeriodEnd) < new Date()) {
        await prisma.$transaction([
          (prisma as any).subscription.update({ where: { userId: user.id }, data: { status: 'expired' } }),
          prisma.user.update({ where: { id: user.id }, data: { isActive: false } }),
        ])
        const msg = sub.status === 'trialing'
          ? 'Bepul sinov muddati tugadi. Davom etish uchun tarifni tanlang.'
          : 'Obuna muddati tugagan. Iltimos, administrator bilan bog\'laning.'
        throw new AppError(msg, 403)
      }
      if (sub && sub.status === 'expired') {
        throw new AppError('Obuna muddati tugagan. Tarifni tanlang yoki administrator bilan bog\'laning.', 403)
      }
    }

    // 2FA check
    if (user.twoFactorEnabled) {
      if (!totpCode) {
        return res.status(200).json({
          success: true,
          requiresTwoFactor: true,
          message: 'TOTP kod talab qilinadi',
        })
      }
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: totpCode,
        window: 1,
      })
      if (!verified) throw new AppError('TOTP kod noto\'g\'ri', 401)
    }

    await (prisma as any).user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const tokens = signTokens({ id: user.id, email: user.email, role: user.role, branchId: user.branchId, fullName: user.fullName })
    const { passwordHash: _, twoFactorSecret: __, verificationToken: ___, passwordResetToken: ____, ...safeUser } = user
    res.json(successResponse({ user: safeUser, ...tokens }, 'Tizimga kirildi'))
  } catch (err) { next(err) }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const ops: any[] = []

    // Blacklist access token
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const decoded = jwt.decode(token) as any
      if (decoded?.exp) {
        ops.push(prisma.tokenBlacklist.create({
          data: { token, userId, expiresAt: new Date(decoded.exp * 1000) },
        }))
      }
    }

    // Blacklist refresh token if provided
    const { refreshToken } = req.body
    if (refreshToken) {
      try {
        const decoded = jwt.decode(refreshToken) as any
        if (decoded?.exp) {
          ops.push(prisma.tokenBlacklist.create({
            data: { token: refreshToken, userId, expiresAt: new Date(decoded.exp * 1000) },
          }))
        }
      } catch { /* ignore invalid refresh token on logout */ }
    }

    if (ops.length > 0) await Promise.allSettled(ops)
    res.json(successResponse(null, 'Tizimdan chiqildi'))
  } catch (err) { next(err) }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) throw new AppError('Refresh token talab qilinadi', 400)

    // Check if this refresh token was explicitly revoked (e.g. via logout)
    const blacklisted = await prisma.tokenBlacklist.findUnique({ where: { token: refreshToken } })
    if (blacklisted) throw new AppError('Token bekor qilingan', 401)

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any
    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user || !user.isActive) throw new AppError('Token noto\'g\'ri', 401)
    // Invalidate tokens issued before the last password change
    if (user.passwordChangedAt && payload.iat) {
      const changedAt = Math.floor(user.passwordChangedAt.getTime() / 1000)
      if (changedAt > payload.iat) throw new AppError('Parol o\'zgartirilgan. Qayta kiring.', 401)
    }

    // Issue new tokens — do NOT blacklist old refresh token here
    // (rotation breaks multi-tab usage: tab A refreshes → tab B's same
    //  token becomes invalid → tab B gets kicked out immediately)
    const tokens = signTokens({ id: user.id, email: user.email, role: user.role, branchId: user.branchId, fullName: user.fullName })
    res.json(successResponse(tokens))
  } catch (err) { next(err) }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await (prisma as any).user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, email: true, fullName: true, role: true, branchId: true, isActive: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
        emailVerified: true, twoFactorEnabled: true,
        termsAcceptedAt: true,
        onboardingCompletedAt: true,
        preferredLanguage: true,
        branch: { select: { id: true, name: true, location: true } },
      },
    })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    res.json(successResponse(user))
  } catch (err) { next(err) }
}

// Maxfiylik siyosati va ommaviy ofertani qabul qilish
export async function acceptTerms(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const updated = await (prisma as any).user.update({
      where: { id: req.user!.id },
      data: { termsAcceptedAt: new Date() },
      select: { id: true, termsAcceptedAt: true },
    })
    res.json(successResponse(updated, "Maxfiylik siyosati qabul qilindi"))
  } catch (err) { next(err) }
}

// Onboarding (yo'riqnoma) ni tugatish yoki qaytadan ko'rsatish (reset)
export async function completeOnboarding(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reset } = req.body || {}
    const updated = await (prisma as any).user.update({
      where: { id: req.user!.id },
      data: { onboardingCompletedAt: reset ? null : new Date() },
      select: { id: true, onboardingCompletedAt: true },
    })
    res.json(successResponse(updated, reset ? 'Yo\'riqnoma qayta yoqildi' : 'Yo\'riqnoma tugatildi'))
  } catch (err) { next(err) }
}

// Foydalanuvchining afzal ko'rgan tilini saqlash —
// frontend i18n.changeLanguage() chaqirilganda yoziladi.
// Telegram, Excel eksport, server tarjimalari shu maydondan foydalanadi.
export async function setPreferredLanguage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { language } = req.body || {}
    const ALLOWED = ['uz', 'uz-cyrl', 'ru', 'zh']
    if (!language || !ALLOWED.includes(language)) {
      throw new AppError(`Til noto'g'ri. Mumkin: ${ALLOWED.join(', ')}`, 400)
    }
    const updated = await (prisma as any).user.update({
      where: { id: req.user!.id },
      data: { preferredLanguage: language },
      select: { id: true, preferredLanguage: true },
    })
    res.json(successResponse(updated, 'Til saqlandi'))
  } catch (err) { next(err) }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) throw new AppError('Joriy va yangi parol talab qilinadi', 400)
    if (typeof newPassword !== 'string' || newPassword.length < 8)
      throw new AppError('Yangi parol kamida 8 ta belgidan iborat bo\'lishi kerak', 400)
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) throw new AppError('Joriy parol noto\'g\'ri', 400)
    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash, passwordChangedAt: new Date() },
    })
    res.json(successResponse(null, 'Parol muvaffaqiyatli o\'zgartirildi'))
  } catch (err) { next(err) }
}

// ─── Email Verification ───────────────────────────────────────────────────────

export async function sendVerification(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await (prisma as any).user.findUnique({ where: { id: req.user!.id } })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    if (user.emailVerified) throw new AppError('Email allaqachon tasdiqlangan', 400)

    const tokenRaw = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { verificationToken: hashToken(tokenRaw), verificationTokenExpiry: expiry },
    })

    await sendVerificationEmail(user.email, user.fullName, tokenRaw)
    res.json(successResponse(null, 'Tasdiqlash xati yuborildi'))
  } catch (err) { next(err) }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body
    if (!token) throw new AppError('Token talab qilinadi', 400)

    // DB da hashed shaklda saqlanadi — kiruvchi xom tokenni hash qilib qidiramiz
    const hashed = hashToken(String(token))
    const user = await (prisma as any).user.findFirst({
      where: {
        verificationToken: hashed,
        verificationTokenExpiry: { gt: new Date() },
      },
    })
    if (!user) throw new AppError('Token noto\'g\'ri yoki muddati o\'tgan', 400)

    await (prisma as any).user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null,
      },
    })
    res.json(successResponse(null, 'Email muvaffaqiyatli tasdiqlandi'))
  } catch (err) { next(err) }
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body
    if (!email) throw new AppError('Email talab qilinadi', 400)

    const user = await (prisma as any).user.findUnique({ where: { email } })
    // Always respond OK to prevent email enumeration
    if (!user) return res.json(successResponse(null, 'Agar email ro\'yxatda bo\'lsa, xat yuboriladi'))

    const tokenRaw = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { passwordResetToken: hashToken(tokenRaw), passwordResetTokenExpiry: expiry },
    })

    sendPasswordResetEmail(user.email, user.fullName, tokenRaw).catch(err =>
      console.error(`[Email] password reset failed (${user.email}):`, err.message)
    )
    res.json(successResponse(null, 'Parolni tiklash xati yuborildi'))
  } catch (err) { next(err) }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword) throw new AppError('Token va yangi parol talab qilinadi', 400)
    if (newPassword.length < 8) throw new AppError('Parol kamida 8 ta belgidan iborat bo\'lishi kerak', 400)

    const hashed = hashToken(String(token))
    const user = await (prisma as any).user.findFirst({
      where: {
        passwordResetToken: hashed,
        passwordResetTokenExpiry: { gt: new Date() },
      },
    })
    if (!user) throw new AppError('Token noto\'g\'ri yoki muddati o\'tgan', 400)

    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    await (prisma as any).user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      },
    })
    res.json(successResponse(null, 'Parol muvaffaqiyatli yangilandi'))
  } catch (err) { next(err) }
}

// ─── Two-Factor Authentication (TOTP) ────────────────────────────────────────

export async function setup2FA(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await (prisma as any).user.findUnique({ where: { id: req.user!.id } })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    if (user.twoFactorEnabled) throw new AppError('2FA allaqachon yoqilgan', 400)

    const secret = speakeasy.generateSecret({
      name: `AutoHisob (${user.email})`,
      length: 32,
    })

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret.base32 },
    })

    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url!)
    res.json(successResponse({
      secret: secret.base32,
      qrCode: qrDataUrl,
      otpauthUrl: secret.otpauth_url,
    }))
  } catch (err) { next(err) }
}

export async function verify2FA(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { totpCode } = req.body
    if (!totpCode) throw new AppError('TOTP kod talab qilinadi', 400)

    const user = await (prisma as any).user.findUnique({ where: { id: req.user!.id } })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    if (!user.twoFactorSecret) throw new AppError('2FA o\'rnatilmagan. Avval setup qiling', 400)

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: totpCode,
      window: 1,
    })
    if (!verified) throw new AppError('TOTP kod noto\'g\'ri', 401)

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    })
    res.json(successResponse(null, '2FA muvaffaqiyatli yoqildi'))
  } catch (err) { next(err) }
}

export async function disable2FA(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { password, totpCode } = req.body
    const user = await (prisma as any).user.findUnique({ where: { id: req.user!.id } })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)

    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) throw new AppError('Parol noto\'g\'ri', 401)

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: totpCode || '',
        window: 1,
      })
      if (!verified) throw new AppError('TOTP kod noto\'g\'ri', 401)
    }

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    })
    res.json(successResponse(null, '2FA o\'chirildi'))
  } catch (err) { next(err) }
}
