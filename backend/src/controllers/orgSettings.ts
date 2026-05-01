/**
 * Tashkilot sozlamalari boshqaruvi (admin uchun).
 * "Soddalashtirilgan ko'rinish" toggle — parol bilan tasdiqlanadi.
 */
import { Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { resolveOrgId } from '../lib/orgFilter'
import { invalidateOrgSettingsCache } from '../services/orgSettingsService'

export async function getOrgSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const setting = await (prisma as any).orgSettings.findUnique({
      where: { orgId },
    })
    res.json(successResponse({
      simplifiedView: setting?.simplifiedView ?? false,
      simplifiedAt: setting?.simplifiedAt ?? null,
      hiddenFeatures: setting?.hiddenFeatures ?? [],
    }))
  } catch (err) { next(err) }
}

// Yashirilgan funksiyalarni yangilash (admin)
export async function setHiddenFeatures(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { hiddenFeatures } = req.body
    if (!Array.isArray(hiddenFeatures)) throw new AppError('hiddenFeatures massiv bo\'lishi kerak', 400)
    // String'lar bo'lishi kerak
    const cleaned = hiddenFeatures.filter(f => typeof f === 'string' && f.length > 0)

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const updated = await (prisma as any).orgSettings.upsert({
      where: { orgId },
      create: { orgId, hiddenFeatures: cleaned },
      update: { hiddenFeatures: cleaned },
    })

    res.json(successResponse({ hiddenFeatures: updated.hiddenFeatures }, 'Sozlamalar saqlandi'))
  } catch (err) { next(err) }
}

/**
 * Toggle simplifiedView. Xavfsizlik:
 *  - Faqat admin/super_admin
 *  - Foydalanuvchi parolini tekshiradi (adashib bosish oldini olish)
 */
export async function toggleSimplifiedView(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { password, value } = req.body
    if (typeof value !== 'boolean') throw new AppError('value boolean bo\'lishi kerak', 400)
    if (!password) throw new AppError('Parol talab qilinadi', 400)

    // Parol tekshiruvi
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { passwordHash: true },
    })
    if (!user) throw new AppError('Foydalanuvchi topilmadi', 404)
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) throw new AppError('Parol noto\'g\'ri', 401)

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const updated = await (prisma as any).orgSettings.upsert({
      where: { orgId },
      create: {
        orgId,
        simplifiedView: value,
        simplifiedAt: value ? new Date() : null,
        toggledById: req.user!.id,
      },
      update: {
        simplifiedView: value,
        simplifiedAt: value ? new Date() : null,
        toggledById: req.user!.id,
      },
    })

    // Cache'ni tozalash
    invalidateOrgSettingsCache(orgId)

    res.json(successResponse(
      { simplifiedView: updated.simplifiedView, simplifiedAt: updated.simplifiedAt },
      value ? 'Soddalashtirilgan ko\'rinish yoqildi' : 'Soddalashtirilgan ko\'rinish o\'chirildi'
    ))
  } catch (err) { next(err) }
}
