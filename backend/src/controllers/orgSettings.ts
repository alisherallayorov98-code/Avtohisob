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
import { invalidateThresholdCache } from '../lib/fuelAnomalyDetector'

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
      fuelDistanceMode: setting?.fuelDistanceMode === 'manual' ? 'manual' : 'gps',
      // Fuel monitoring threshold'lari
      fuelTheftRateLPerMin: setting?.fuelTheftRateLPerMin ?? 1.0,
      fuelTheftMinDropL: setting?.fuelTheftMinDropL ?? 5,
      fuelTheftMaxGapMin: setting?.fuelTheftMaxGapMin ?? 60,
      fuelRefuelMinRiseL: setting?.fuelRefuelMinRiseL ?? 5,
      fuelRefuelMaxGapMin: setting?.fuelRefuelMaxGapMin ?? 60,
      fuelRecordWindowMin: setting?.fuelRecordWindowMin ?? 30,
    }))
  } catch (err) { next(err) }
}

// Fuel anomaliya threshold'larini yangilash (admin/manager)
export async function setFuelThresholds(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const {
      fuelTheftRateLPerMin,
      fuelTheftMinDropL,
      fuelTheftMaxGapMin,
      fuelRefuelMinRiseL,
      fuelRefuelMaxGapMin,
      fuelRecordWindowMin,
    } = req.body

    // Validatsiya: musbat sonlar bo'lishi kerak
    const validate = (v: any, name: string, min = 0.1, max = 10000) => {
      if (v == null) return undefined
      const n = Number(v)
      if (!isFinite(n) || n < min || n > max) {
        throw new AppError(`${name}: ${min}-${max} oralig'ida bo'lishi kerak`, 400)
      }
      return n
    }

    const data: any = {
      ...(fuelTheftRateLPerMin !== undefined && { fuelTheftRateLPerMin: validate(fuelTheftRateLPerMin, 'fuelTheftRateLPerMin', 0.1, 100) }),
      ...(fuelTheftMinDropL !== undefined && { fuelTheftMinDropL: validate(fuelTheftMinDropL, 'fuelTheftMinDropL', 1, 1000) }),
      ...(fuelTheftMaxGapMin !== undefined && { fuelTheftMaxGapMin: validate(fuelTheftMaxGapMin, 'fuelTheftMaxGapMin', 1, 1440) }),
      ...(fuelRefuelMinRiseL !== undefined && { fuelRefuelMinRiseL: validate(fuelRefuelMinRiseL, 'fuelRefuelMinRiseL', 1, 1000) }),
      ...(fuelRefuelMaxGapMin !== undefined && { fuelRefuelMaxGapMin: validate(fuelRefuelMaxGapMin, 'fuelRefuelMaxGapMin', 1, 1440) }),
      ...(fuelRecordWindowMin !== undefined && { fuelRecordWindowMin: validate(fuelRecordWindowMin, 'fuelRecordWindowMin', 1, 1440) }),
    }

    const updated = await (prisma as any).orgSettings.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    })

    // Cache'ni tozalash — keyingi anomaliya aniqlash yangi qiymatlardan foydalanadi
    invalidateThresholdCache(orgId)

    res.json(successResponse({
      fuelTheftRateLPerMin: updated.fuelTheftRateLPerMin,
      fuelTheftMinDropL: updated.fuelTheftMinDropL,
      fuelTheftMaxGapMin: updated.fuelTheftMaxGapMin,
      fuelRefuelMinRiseL: updated.fuelRefuelMinRiseL,
      fuelRefuelMaxGapMin: updated.fuelRefuelMaxGapMin,
      fuelRecordWindowMin: updated.fuelRecordWindowMin,
    }, 'Threshold\'lar saqlandi'))
  } catch (err) { next(err) }
}

// Yoqilg'i masofa rejimini o'rnatish ('manual' | 'gps') — admin/manager.
// 'gps' tanlanganda yoqilg'i sarfi (L/100km) odometr o'rniga GPS kunlik km'dan hisoblanadi.
export async function setFuelDistanceMode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { mode } = req.body
    if (mode !== 'manual' && mode !== 'gps') {
      throw new AppError('mode "manual" yoki "gps" bo\'lishi kerak', 400)
    }
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const updated = await (prisma as any).orgSettings.upsert({
      where: { orgId },
      create: { orgId, fuelDistanceMode: mode },
      update: { fuelDistanceMode: mode },
    })

    invalidateOrgSettingsCache(orgId)

    res.json(successResponse(
      { fuelDistanceMode: updated.fuelDistanceMode },
      mode === 'gps' ? 'GPS rejimi yoqildi — yoqilg\'i sarfi GPS bo\'yicha hisoblanadi' : 'Qo\'lda rejim yoqildi',
    ))
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
