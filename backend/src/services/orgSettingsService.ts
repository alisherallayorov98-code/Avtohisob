/**
 * Tashkilot doirasidagi umumiy sozlamalar.
 * Asosiy maqsad: "Soddalashtirilgan ko'rinish" rejimi orqali norasmiy yozuvlarni
 * butun sayt bo'ylab yashirish.
 */
import { prisma } from '../lib/prisma'

interface OrgSettingsCache {
  simplifiedView: boolean
  fuelDistanceMode: 'manual' | 'gps'
}

// Kichik in-memory cache: 30 soniya. Tashkilot ko'p so'rov qilganida har safar DB ga bormaslik uchun.
const cache = new Map<string, { data: OrgSettingsCache; expiresAt: number }>()
const CACHE_TTL_MS = 30 * 1000

export async function getOrgSettings(orgId: string | null | undefined): Promise<OrgSettingsCache> {
  if (!orgId) return { simplifiedView: false, fuelDistanceMode: 'manual' }
  const cached = cache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  // OrgSettings (plural) — yagona model (avval OrgSetting/OrgSettings collision bor edi)
  const setting = await (prisma as any).orgSettings.findUnique({
    where: { orgId },
    select: { simplifiedView: true, fuelDistanceMode: true },
  })
  const data: OrgSettingsCache = {
    simplifiedView: setting?.simplifiedView ?? false,
    fuelDistanceMode: setting?.fuelDistanceMode === 'gps' ? 'gps' : 'manual',
  }
  cache.set(orgId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

/** Soddalashtirilgan ko'rinish yoqilganmi? Tezkor tekshiruv */
export async function isSimplifiedView(orgId: string | null | undefined): Promise<boolean> {
  const s = await getOrgSettings(orgId)
  return s.simplifiedView
}

/** Yoqilg'i masofa rejimi ('manual' | 'gps') — tezkor tekshiruv */
export async function getFuelDistanceMode(orgId: string | null | undefined): Promise<'manual' | 'gps'> {
  const s = await getOrgSettings(orgId)
  return s.fuelDistanceMode
}

/** Cache'ni tozalash (toggle qilinganda) */
export function invalidateOrgSettingsCache(orgId: string | null | undefined) {
  if (orgId) cache.delete(orgId)
}
