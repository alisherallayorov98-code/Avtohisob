import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../../lib/prisma'
import { EkoRequest, invalidateEkoUser } from '../middleware/ekoAuth'
import { normalizeLogin } from '../lib/normalizeLogin'
import { validatePassword } from '../lib/passwordPolicy'
import { logEkoAudit } from '../lib/ekoAudit'
import { parsePageParams } from '../lib/ekoValidate'
import { toSafeUser } from './auth'

const ROLES = ['admin', 'inspector', 'supervisor']
const BCRYPT_ROUNDS = () => parseInt(process.env.BCRYPT_ROUNDS || '12')

/** Korxonada, `exceptId` dan tashqari, faol (haqiqiy) admin bormi. */
async function hasOtherActiveAdmin(orgId: string, exceptId: string): Promise<boolean> {
  const n = await (prisma as any).ekoHisobUser.count({
    where: { orgId, role: 'admin', isActive: true, isMirror: false, id: { not: exceptId } },
  })
  return n > 0
}

export async function listUsers(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role } = req.ekoUser!
    const { page, limit, skip } = parsePageParams(req.query.page, req.query.limit, { defaultLimit: 200, maxLimit: 500 })
    // isMirror — asosiy AutoHisob hisobi bilan kirganlar uchun texnik soya yozuv
    // (FK talabi). Ular xodimlar ro'yxatida ko'rinmasligi kerak.
    const where = { orgId, isMirror: false }
    // Telegram chatId — shaxsiy identifikator: FAQAT admin ko'radi
    const botLinkSelect = role === 'admin'
      ? { chatId: true, tgUsername: true, tgFirstName: true, linkedAt: true }
      : { tgUsername: true, tgFirstName: true, linkedAt: true }

    const [total, users] = await Promise.all([
      (prisma as any).ekoHisobUser.count({ where }),
      (prisma as any).ekoHisobUser.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
          lockedUntil: true,
          orgId: true,
          createdAt: true,
          updatedAt: true,
          districts: {
            include: { district: { select: { id: true, name: true } } },
          },
          botLink: { select: botLinkSelect },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])
    res.json({ success: true, data: users, meta: { total, page, limit } })
  } catch (err) { next(err) }
}

/**
 * GET /users/options — filtr ro'yxatlari uchun yengil xodimlar ro'yxati.
 *
 * `listUsers` faqat admin uchun va login/tuman/bot ma'lumotlarini qaytaradi.
 * Bu yerda faqat id va ism — "kim kiritdi" filtri inspektor va boshliqqa ham
 * kerak, lekin ularga boshqa xodimlarning maxfiy ma'lumoti berilmasligi shart.
 */
export async function listUserOptions(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const users = await (prisma as any).ekoHisobUser.findMany({
      where: { orgId, isMirror: false },
      select: { id: true, fullName: true, role: true, isActive: true },
      orderBy: { fullName: 'asc' },
      take: 1000,
    })
    res.json({ success: true, data: users })
  } catch (err) { next(err) }
}

export async function createUser(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    // 'email' maydoni endi email YOKI telefon bo'lishi mumkin (login identifikatori)
    const { email, password, fullName, role } = req.body ?? {}
    if (typeof email !== 'string' || !email.trim() || typeof fullName !== 'string' || !fullName.trim() || !password) {
      res.status(400).json({ success: false, error: 'Login (email yoki telefon), parol va ism talab qilinadi' })
      return
    }
    const pwErr = validatePassword(password)
    if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return }
    if (fullName.trim().length > 120 || email.trim().length > 120) {
      res.status(400).json({ success: false, error: 'Login yoki ism juda uzun' })
      return
    }
    if (role !== undefined && role !== null && !ROLES.includes(role)) {
      res.status(400).json({ success: false, error: 'Rol noto\'g\'ri. Mumkin: admin, inspector, supervisor' })
      return
    }

    const login = normalizeLogin(email)
    const existing = await (prisma as any).ekoHisobUser.findFirst({
      where: { email: login, orgId },
    })
    if (existing) {
      res.status(409).json({ success: false, error: 'Bu login allaqachon ro\'yxatdan o\'tgan' })
      return
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS())
    let user
    try {
      user = await (prisma as any).ekoHisobUser.create({
        data: {
          email: login,
          passwordHash,
          fullName: fullName.trim(),
          role: role || 'inspector',
          orgId,
        },
        select: {
          id: true, email: true, fullName: true, role: true,
          isActive: true, orgId: true, createdAt: true, updatedAt: true,
        },
      })
    } catch (e: any) {
      // [email, orgId] unikal indeksi — poyga (ikki admin bir vaqtda)
      if (e?.code === 'P2002') {
        res.status(409).json({ success: false, error: 'Bu login allaqachon ro\'yxatdan o\'tgan' })
        return
      }
      throw e
    }
    await logEkoAudit(req.ekoUser, {
      action: 'user.create', targetType: 'user', targetId: user.id, targetName: user.fullName,
      details: { role: user.role, login: user.email },
    })
    res.status(201).json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function updateUser(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { fullName, role, isActive, email } = req.body ?? {}

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const data: any = {}
    let sessionChange = false // tokenVersion++ kerakmi
    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
        res.status(400).json({ success: false, error: 'Ism noto\'g\'ri' })
        return
      }
      data.fullName = fullName.trim()
    }
    // Login (email yoki telefon) o'zgartirish — admin xato kiritsa tuzata oladi
    if (email !== undefined) {
      if (typeof email !== 'string') {
        res.status(400).json({ success: false, error: 'Login (email yoki telefon) noto\'g\'ri' })
        return
      }
      const login = normalizeLogin(email)
      if (!login || login.length > 120) {
        res.status(400).json({ success: false, error: 'Login (email yoki telefon) noto\'g\'ri' })
        return
      }
      if (login !== existing.email) {
        const dup = await (prisma as any).ekoHisobUser.findFirst({
          where: { email: login, orgId, NOT: { id } },
        })
        if (dup) {
          res.status(409).json({ success: false, error: 'Bu login allaqachon boshqa foydalanuvchida bor' })
          return
        }
        data.email = login
        sessionChange = true
      }
    }
    if (role !== undefined && role !== existing.role) {
      if (!ROLES.includes(role)) {
        res.status(400).json({ success: false, error: 'Rol noto\'g\'ri' })
        return
      }
      data.role = role
      sessionChange = true
    }
    if (isActive !== undefined && Boolean(isActive) !== existing.isActive) {
      data.isActive = Boolean(isActive)
      if (!data.isActive) sessionChange = true
      else { data.failedLogins = 0; data.lockedUntil = null }
    }

    // Oxirgi faol adminni deaktiv qilish yoki rolini tushirish taqiqlanadi
    const losesAdmin = existing.role === 'admin' && existing.isActive &&
      ((data.role !== undefined && data.role !== 'admin') || data.isActive === false)
    if (losesAdmin && !(await hasOtherActiveAdmin(orgId, id))) {
      res.status(409).json({ success: false, error: 'Bu korxonadagi oxirgi faol admin — uni o\'chirib yoki rolini o\'zgartirib bo\'lmaydi' })
      return
    }

    if (sessionChange) data.tokenVersion = { increment: 1 }

    const user = await (prisma as any).ekoHisobUser.update({
      where: { id },
      data,
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, orgId: true, createdAt: true, updatedAt: true,
      },
    })
    if (sessionChange) invalidateEkoUser(id)

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of ['fullName', 'email', 'role', 'isActive']) {
      if (data[k] !== undefined && data[k] !== existing[k]) changes[k] = { from: existing[k], to: data[k] }
    }
    if (Object.keys(changes).length > 0) {
      const action = changes.role ? 'user.role_change'
        : changes.isActive ? (data.isActive ? 'user.activate' : 'user.deactivate')
        : 'user.update'
      await logEkoAudit(req.ekoUser, {
        action, targetType: 'user', targetId: id, targetName: user.fullName, details: { changes },
      })
    }
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function assignDistricts(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { districtIds } = req.body ?? {}

    if (!Array.isArray(districtIds) || districtIds.length > 500 || districtIds.some(d => typeof d !== 'string')) {
      res.status(400).json({ success: false, error: 'districtIds massiv bo\'lishi kerak' })
      return
    }
    const wanted: string[] = Array.from(new Set(districtIds as string[]))

    const existing = await (prisma as any).ekoHisobUser.findUnique({
      where: { id },
      include: { districts: { select: { districtId: true } } },
    })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    // Har bir tuman shu korxonaniki bo'lishi shart (boshqa korxona tumanini biriktirib bo'lmaydi)
    if (wanted.length > 0) {
      const valid = await (prisma as any).ekoHisobDistrict.count({ where: { id: { in: wanted }, orgId } })
      if (valid !== wanted.length) {
        res.status(400).json({ success: false, error: 'Ba\'zi tumanlar topilmadi yoki sizning korxonangizga tegishli emas' })
        return
      }
    }

    const before = existing.districts.map((d: any) => d.districtId).sort()
    const after = [...wanted].sort()

    await (prisma as any).$transaction([
      (prisma as any).ekoHisobUserDistrict.deleteMany({ where: { userId: id } }),
      ...(wanted.length > 0
        ? [(prisma as any).ekoHisobUserDistrict.createMany({
            data: wanted.map(districtId => ({ userId: id, districtId })),
            skipDuplicates: true,
          })]
        : []),
      // Tuman doirasi o'zgardi — eski sessiyalar bekor (yangi huquq bilan qayta kirish)
      (prisma as any).ekoHisobUser.update({ where: { id }, data: { tokenVersion: { increment: 1 } } }),
    ])
    invalidateEkoUser(id)

    await logEkoAudit(req.ekoUser, {
      action: 'user.districts', targetType: 'user', targetId: id, targetName: existing.fullName,
      details: { from: before, to: after },
    })

    const updated = await (prisma as any).ekoHisobUser.findUnique({
      where: { id },
      include: {
        districts: { include: { district: { select: { id: true, name: true } } } },
      },
    })
    res.json({ success: true, data: toSafeUser(updated) })
  } catch (err) { next(err) }
}

export async function resetPassword(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: callerId } = req.ekoUser!
    const { id } = req.params
    const { newPassword } = req.body ?? {}

    const pwErr = validatePassword(newPassword)
    if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return }

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS())
    await (prisma as any).ekoHisobUser.update({
      where: { id },
      data: {
        passwordHash,
        // Admin bergan parol vaqtinchalik: egasi birinchi kirishda o'zgartiradi. O'z parolini o'zi o'zgartirsa — shart emas.
        mustChangePassword: id !== callerId,
        failedLogins: 0,
        lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    })
    invalidateEkoUser(id)
    await logEkoAudit(req.ekoUser, {
      action: 'user.password_reset', targetType: 'user', targetId: id, targetName: existing.fullName,
    })
    res.json({ success: true, data: null, message: 'Parol yangilandi' })
  } catch (err) { next(err) }
}

export async function deactivateUser(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: callerId } = req.ekoUser!
    const { id } = req.params

    if (id === callerId) {
      res.status(400).json({ success: false, error: 'O\'zingizni o\'chira olmaysiz' })
      return
    }

    const existing = await (prisma as any).ekoHisobUser.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId || existing.isMirror) {
      res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' })
      return
    }
    if (existing.role === 'admin' && existing.isActive && !(await hasOtherActiveAdmin(orgId, id))) {
      res.status(409).json({ success: false, error: 'Bu korxonadagi oxirgi faol admin — uni o\'chirib bo\'lmaydi' })
      return
    }

    await (prisma as any).ekoHisobUser.update({
      where: { id },
      data: { isActive: false, tokenVersion: { increment: 1 } },
    })
    invalidateEkoUser(id)
    await logEkoAudit(req.ekoUser, {
      action: 'user.deactivate', targetType: 'user', targetId: id, targetName: existing.fullName,
    })
    res.json({ success: true, data: null, message: 'Foydalanuvchi deaktiv qilindi' })
  } catch (err) { next(err) }
}
