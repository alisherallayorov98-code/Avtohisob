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

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, fullName, role, branchId } = req.body

    // Input validation
    if (!email || !password || !fullName) throw new AppError('email, password va fullName majburiy', 400)
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AppError('Email formati noto\'g\'ri', 400)
    if (typeof password !== 'string' || password.length < 8)
      throw new AppError('Parol kamida 8 ta belgidan iborat bo\'lishi kerak', 400)
    if (typeof fullName !== 'string' || fullName.trim().length < 2)
      throw new AppError('Ism familiya kamida 2 ta belgidan iborat bo\'lishi kerak', 400)
    const allowedRoles = ['admin', 'manager', 'branch_manager', 'operator']
    if (role && !allowedRoles.includes(role)) throw new AppError('Noto\'g\'ri rol', 400)

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (existing) throw new AppError('Bu email allaqachon ro\'yxatdan o\'tgan', 409)

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'))
    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h

    const user = await (prisma as any).user.create({
      data: {
        email: email.toLowerCase().trim(), passwordHash, fullName: fullName.trim(),
        role: role || 'operator',
        branchId: branchId || null,
        verificationToken,
        verificationTokenExpiry,
      },
      select: { id: true, email: true, fullName: true, role: true, branchId: true, isActive: true, emailVerified: true, createdAt: true },
    })

    // Send verification email (non-blocking)
    sendVerificationEmail(email, fullName, verificationToken).catch(() => {})
    sendWelcomeEmail(email, fullName).catch(() => {})

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

    // Subscription expiry check for admin role
    if (user.role === 'admin') {
      const sub = await (prisma as any).subscription.findUnique({ where: { userId: user.id } })
      if (sub && sub.status === 'active' && new Date(sub.currentPeriodEnd) < new Date()) {
        await (prisma as any).subscription.update({ where: { userId: user.id }, data: { status: 'expired' } })
        await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
        throw new AppError('Obuna muddati tugagan. Iltimos, administrator bilan bog\'laning.', 403)
      }
      if (sub && sub.status === 'expired') {
        throw new AppError('Obuna muddati tugagan. Iltimos, administrator bilan bog\'laning.', 403)
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
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const decoded = jwt.decode(token) as any
      if (decoded?.exp) {
        await prisma.tokenBlacklist.create({
          data: { token, userId: req.user!.id, expiresAt: new Date(decoded.exp * 1000) },
        })
      }
    }
    res.json(successResponse(null, 'Tizimdan chiqildi'))
  } catch (err) { next(err) }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) throw new AppError('Refresh token talab qilinadi', 400)
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any
    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user || !user.isActive) throw new AppError('Token noto\'g\'ri', 401)
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
        branch: { select: { id: true, name: true, location: true } },
      },
    })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    res.json(successResponse(user))
  } catch (err) { next(err) }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body
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

    const token = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { verificationToken: token, verificationTokenExpiry: expiry },
    })

    await sendVerificationEmail(user.email, user.fullName, token)
    res.json(successResponse(null, 'Tasdiqlash xati yuborildi'))
  } catch (err) { next(err) }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body
    if (!token) throw new AppError('Token talab qilinadi', 400)

    const user = await (prisma as any).user.findFirst({
      where: {
        verificationToken: token,
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

    const token = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetTokenExpiry: expiry },
    })

    await sendPasswordResetEmail(user.email, user.fullName, token)
    res.json(successResponse(null, 'Parolni tiklash xati yuborildi'))
  } catch (err) { next(err) }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword) throw new AppError('Token va yangi parol talab qilinadi', 400)
    if (newPassword.length < 8) throw new AppError('Parol kamida 8 ta belgidan iborat bo\'lishi kerak', 400)

    const user = await (prisma as any).user.findFirst({
      where: {
        passwordResetToken: token,
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
