import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../../lib/prisma'
import { EkoRequest, invalidateEkoUser } from '../middleware/ekoAuth'
import { normalizeLogin } from '../lib/normalizeLogin'
import { signEkoJwt } from '../lib/ekoJwt'
import { isLocked, lockMinutesLeft, onLoginFailure, onLoginSuccess } from '../lib/loginLock'
import { validatePassword } from '../lib/passwordPolicy'
import { MemCounter } from '../lib/memLimiter'
import { logEkoAudit } from '../lib/ekoAudit'

const BCRYPT_ROUNDS = () => parseInt(process.env.BCRYPT_ROUNDS || '12')

// login + IP bo'yicha: 15 daqiqada 10 ta MUVAFFAQIYATSIZ urinish (marshrutdagi authLimiter'ga qo'shimcha)
const loginAttempts = new MemCounter({ windowMs: 15 * 60 * 1000, max: 10 })

// Foydalanuvchi mavjud bo'lmasa ham bcrypt compare qilinadi — javob vaqti farqidan login topib bo'lmasin
let dummyHashPromise: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('eko-dummy-password-0', BCRYPT_ROUNDS())
  return dummyHashPromise
}

/** Javobga chiqmasligi kerak bo'lgan ichki maydonlarni olib tashlaydi. */
export function toSafeUser<T extends Record<string, any>>(u: T): Omit<T, 'passwordHash' | 'tokenVersion' | 'failedLogins' | 'lockedUntil'> {
  const { passwordHash: _p, tokenVersion: _t, failedLogins: _f, lockedUntil: _l, ...rest } = u
  return rest
}

function issueToken(u: { id: string; email: string; role: string; orgId: string; tokenVersion: number }, districtIds: string[]): string {
  return signEkoJwt({ id: u.id, email: u.email, role: u.role, orgId: u.orgId, districtIds, tv: u.tokenVersion ?? 0 })
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body ?? {}
    // Obyekt/massiv/raqam yuborilsa bcrypt/normalizeLogin 500 bermasin
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      res.status(400).json({ success: false, error: 'Login va parol talab qilinadi' })
      return
    }
    if (email.length > 200 || password.length > 200) {
      res.status(400).json({ success: false, error: 'Login yoki parol noto\'g\'ri' })
      return
    }

    const login = normalizeLogin(email)
    const attemptKey = `${login}|${req.ip}`
    if (loginAttempts.isBlocked(attemptKey)) {
      res.status(429).json({ success: false, error: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring." })
      return
    }

    // Login = email yoki telefon. Korxona (orgId) avtomatik aniqlanadi. Bir xil login bir nechta
    // korxonada bo'lsa, parol mos kelgani tanlanadi.
    const candidates: any[] = await (prisma as any).ekoHisobUser.findMany({
      where: { email: login, isActive: true, isMirror: false },
      include: { districts: { select: { districtId: true } } },
    })

    // Hamma nomzod qulflangan bo'lsa — parol tekshirilmaydi
    const now = new Date()
    const open = candidates.filter(c => !isLocked(c.lockedUntil, now))
    if (candidates.length > 0 && open.length === 0) {
      const mins = Math.max(...candidates.map(c => lockMinutesLeft(c.lockedUntil, now)))
      res.status(423).json({
        success: false, code: 'ACCOUNT_LOCKED',
        error: `Ko'p marta noto'g'ri urinish. Hisob ${mins} daqiqaga bloklandi.`,
      })
      return
    }

    let user: any = null
    if (open.length === 0) {
      await bcrypt.compare(password, await getDummyHash()) // vaqt tenglashtirish
    } else {
      for (const c of open) {
        let ok = false
        try { ok = !!c.passwordHash && await bcrypt.compare(password, c.passwordHash) } catch { ok = false }
        if (ok) { user = c; break }
      }
    }

    if (!user) {
      loginAttempts.hit(attemptKey)
      // Faqat login mavjud bo'lsa hisoblagich oshadi (nomzodlar o'zi bo'yicha)
      for (const c of open) {
        const next = onLoginFailure({ failedLogins: c.failedLogins ?? 0, lockedUntil: c.lockedUntil ?? null }, now)
        await (prisma as any).ekoHisobUser.update({
          where: { id: c.id },
          data: { failedLogins: next.failedLogins, lockedUntil: next.lockedUntil },
        }).catch(() => {})
        if (next.justLocked) {
          await logEkoAudit(
            { id: c.id, email: c.email, role: c.role, orgId: c.orgId, districtIds: [], eko: true },
            { action: 'user.login_locked', targetType: 'user', targetId: c.id, targetName: c.fullName, details: { ip: req.ip } },
          )
        }
      }
      res.status(401).json({ success: false, error: 'Login yoki parol noto\'g\'ri' })
      return
    }

    if ((user.failedLogins ?? 0) !== 0 || user.lockedUntil) {
      const ok = onLoginSuccess()
      await (prisma as any).ekoHisobUser.update({ where: { id: user.id }, data: ok }).catch(() => {})
    }
    loginAttempts.reset(attemptKey)

    const districtIds = user.districts.map((d: any) => d.districtId)
    const token = issueToken(user, districtIds)

    res.json({
      success: true,
      data: {
        token,
        // mustChangePassword: true bo'lsa frontend darhol "parolni almashtiring" oynasini ochishi kerak
        user: { ...toSafeUser(user), districtIds },
      },
    })
  } catch (err) { next(err) }
}

export async function me(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const ekoUser = req.ekoUser!
    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: ekoUser.id },
      include: {
        districts: {
          include: {
            district: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!user) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    res.json({ success: true, data: toSafeUser(user) })
  } catch (err) { next(err) }
}

/**
 * POST /auth/change-password { oldPassword, newPassword }
 * Eski parol bilan. Muvaffaqiyatda barcha eski sessiyalar bekor bo'ladi (tokenVersion++),
 * javobda JORIY qurilma uchun YANGI token qaytadi (qayta kirish shart emas).
 */
export async function changePassword(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { oldPassword, newPassword } = req.body ?? {}
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string' || !oldPassword) {
      res.status(400).json({ success: false, error: 'Eski va yangi parol talab qilinadi' })
      return
    }
    const pwErr = validatePassword(newPassword)
    if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return }
    if (newPassword === oldPassword) {
      res.status(400).json({ success: false, error: 'Yangi parol eskisidan farq qilishi kerak' })
      return
    }

    const user = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: req.ekoUser!.id },
      include: { districts: { select: { districtId: true } } },
    })
    if (!user || user.isMirror || !user.passwordHash) {
      res.status(400).json({ success: false, error: "Bu hisob parolini asosiy ilovada o'zgartiring" })
      return
    }
    if (isLocked(user.lockedUntil)) {
      res.status(423).json({ success: false, error: 'Hisob vaqtincha bloklangan. Keyinroq urinib ko\'ring.' })
      return
    }
    let ok = false
    try { ok = await bcrypt.compare(oldPassword, user.passwordHash) } catch { ok = false }
    if (!ok) {
      const next = onLoginFailure({ failedLogins: user.failedLogins ?? 0, lockedUntil: user.lockedUntil ?? null })
      await (prisma as any).ekoHisobUser.update({
        where: { id: user.id }, data: { failedLogins: next.failedLogins, lockedUntil: next.lockedUntil },
      }).catch(() => {})
      res.status(400).json({ success: false, error: "Eski parol noto'g'ri" })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS())
    const updated = await (prisma as any).ekoHisobUser.update({
      where: { id: user.id },
      data: {
        passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    })
    invalidateEkoUser(user.id)
    await logEkoAudit(req.ekoUser, {
      action: 'user.password_change', targetType: 'user', targetId: user.id, targetName: user.fullName,
    })

    const districtIds = user.districts.map((d: any) => d.districtId)
    res.json({ success: true, data: { token: issueToken(updated, districtIds) }, message: 'Parol yangilandi' })
  } catch (err) { next(err) }
}

/** POST /auth/logout — foydalanuvchining BARCHA sessiyalarini bekor qiladi (tokenVersion++). */
export async function logout(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.ekoUser!.id
    await (prisma as any).ekoHisobUser.updateMany({
      where: { id, isMirror: false },
      data: { tokenVersion: { increment: 1 } },
    })
    invalidateEkoUser(id)
    res.json({ success: true, data: null, message: 'Chiqildi' })
  } catch (err) { next(err) }
}
