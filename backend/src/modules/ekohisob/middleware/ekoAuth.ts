import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { verifyEkoJwt, verifyMainJwt, tokenVersionMatches } from '../lib/ekoJwt'

export interface EkoUserPayload {
  id: string
  email: string
  role: string       // 'admin' | 'inspector' | 'supervisor' (boshliq — read-only)
  orgId: string
  districtIds: string[]
  eko: true
}

export interface EkoRequest extends Request {
  ekoUser?: EkoUserPayload
}

// ── Foydalanuvchi holati keshi (30–60 s) ─────────────────────────────────────
// Eski eko-JWT har so'rovda DB bilan solishtiriladi: mavjudligi, isActive, rol, tuman,
// tokenVersion. Kesh DB yukini kamaytiradi; o'zgartiruvchi amallar `invalidateEkoUser`
// chaqiradi (shu jarayonda darhol kuchga kiradi, boshqa jarayonda ko'pi bilan CACHE_TTL_MS).
const CACHE_TTL_MS = 45_000

interface EkoUserRec {
  id: string
  email: string
  role: string
  orgId: string
  isActive: boolean
  isMirror: boolean
  tokenVersion: number
  mustChangePassword: boolean
  districtIds: string[]
}

const userCache = new Map<string, { at: number; rec: EkoUserRec | null }>()

export function invalidateEkoUser(userId?: string): void {
  if (userId) userCache.delete(userId)
  else userCache.clear()
}

async function loadEkoUser(id: string): Promise<EkoUserRec | null> {
  const hit = userCache.get(id)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rec

  const u = await (prisma as any).ekoHisobUser.findUnique({
    where: { id },
    select: {
      id: true, email: true, role: true, orgId: true, isActive: true, isMirror: true,
      tokenVersion: true, mustChangePassword: true,
      districts: { select: { districtId: true } },
    },
  })
  const rec: EkoUserRec | null = u
    ? {
        id: u.id, email: u.email, role: u.role, orgId: u.orgId, isActive: u.isActive,
        isMirror: u.isMirror, tokenVersion: u.tokenVersion ?? 0,
        mustChangePassword: !!u.mustChangePassword,
        districtIds: (u.districts ?? []).map((d: any) => d.districtId),
      }
    : null
  userCache.set(id, { at: Date.now(), rec })
  if (userCache.size > 5000) userCache.delete(userCache.keys().next().value as string)
  return rec
}

// mustChangePassword bo'lganda faqat shu yo'llarga ruxsat
const PASSWORD_CHANGE_ALLOWED = ['/auth/me', '/auth/change-password', '/auth/logout']

function isPasswordChangeAllowed(req: Request): boolean {
  const path = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '')
  return PASSWORD_CHANGE_ALLOWED.some(p => path.endsWith(p))
}

type AuthResult =
  | { ok: true; user: EkoUserPayload; mustChangePassword?: boolean }
  | { ok: false; status: number; error: string; code?: string }

/** Eski EkoHisob JWT (eko: true) — har so'rovda DB bilan solishtiriladi. */
async function authOldEkoToken(token: string): Promise<AuthResult | null> {
  const decoded = verifyEkoJwt(token)
  if (!decoded || typeof decoded.id !== 'string') return null
  const rec = await loadEkoUser(decoded.id)
  if (!rec || !rec.isActive || rec.isMirror) {
    return { ok: false, status: 401, error: 'Foydalanuvchi topilmadi yoki faol emas' }
  }
  if (!tokenVersionMatches(decoded.tv, rec.tokenVersion)) {
    return { ok: false, status: 401, error: 'Sessiya tugagan — qaytadan kiring', code: 'SESSION_REVOKED' }
  }
  // Rol, korxona va tumanlar DOIM DB'dan (token ichidagisi eskirgan bo'lishi mumkin)
  return {
    ok: true,
    mustChangePassword: rec.mustChangePassword && decoded.src !== 'tg',
    user: { id: rec.id, email: rec.email, role: rec.role, orgId: rec.orgId, districtIds: rec.districtIds, eko: true },
  }
}

/** Asosiy AutoHisob JWT (role: ekohisob_user | admin | super_admin). */
async function authMainToken(token: string): Promise<AuthResult | null> {
  const decoded = verifyMainJwt(token)
  if (!decoded) return null
  const allowedRoles = ['ekohisob_user', 'admin', 'super_admin']
  if (!allowedRoles.includes(decoded.role)) return null

  // Asosiy auth middleware bilan bir xil: bekor qilingan (logout) tokenlar rad etiladi
  const blacklisted = await (prisma as any).tokenBlacklist.findUnique({ where: { token } })
  if (blacklisted) return { ok: false, status: 401, error: 'Token bekor qilingan' }

  const user = await (prisma as any).user.findUnique({
    where: { id: decoded.id },
    select: {
      id: true, email: true, role: true, isActive: true, ekoDistrictIds: true,
      branch: { select: { organizationId: true } },
    },
  })
  if (!user || !user.isActive) return null

  // orgId FAQAT filialning korxonasidan. `decoded.branchId` zaxirasi olib tashlandi:
  // u korxona id emas, filial id — tenant chegarasini buzardi.
  const orgId: string = user.branch?.organizationId ?? ''
  if (!orgId) {
    return { ok: false, status: 403, error: "Hisobingiz korxonaga biriktirilmagan — administrator bilan bog'laning" }
  }
  // Rol DB'dan (tokendagi eskirgan bo'lishi mumkin)
  const ekoRole = (user.role === 'admin' || user.role === 'super_admin') ? 'admin' : 'inspector'
  if (!allowedRoles.includes(user.role)) return null
  return {
    ok: true,
    user: { id: user.id, email: user.email, role: ekoRole, orgId, districtIds: user.ekoDistrictIds ?? [], eko: true },
  }
}

export function requireEkoAuth(req: EkoRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token talab qilinadi' })
    return
  }
  const token = authHeader.split(' ')[1]
  if (!token) {
    res.status(401).json({ success: false, error: 'Token talab qilinadi' })
    return
  }

  ;(async () => {
    const result = (await authOldEkoToken(token)) ?? (await authMainToken(token))
    if (!result) {
      res.status(401).json({ success: false, error: 'Token noto\'g\'ri yoki muddati o\'tgan' })
      return
    }
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error, ...(result.code ? { code: result.code } : {}) })
      return
    }
    if (result.mustChangePassword && !isPasswordChangeAllowed(req)) {
      res.status(403).json({
        success: false, code: 'MUST_CHANGE_PASSWORD',
        error: "Vaqtinchalik parolni almashtiring (POST /auth/change-password)",
      })
      return
    }
    req.ekoUser = result.user
    next()
  })().catch(() => {
    res.status(401).json({ success: false, error: 'Token tekshirishda xato' })
  })
}

export function requireEkoAdmin(req: EkoRequest, res: Response, next: NextFunction): void {
  if (!req.ekoUser) {
    res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' })
    return
  }
  if (req.ekoUser.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Faqat admin uchun' })
    return
  }
  next()
}

// Yozish (write) operatsiyalari: supervisor (boshliq) faqat kuzatadi — o'zgartira olmaydi
export function requireEkoCanWrite(req: EkoRequest, res: Response, next: NextFunction): void {
  if (!req.ekoUser) {
    res.status(401).json({ success: false, error: 'Autentifikatsiya talab qilinadi' })
    return
  }
  if (req.ekoUser.role === 'supervisor') {
    res.status(403).json({ success: false, error: 'Boshliq (nazoratchi) faqat kuzatadi — o\'zgartira olmaydi' })
    return
  }
  next()
}
