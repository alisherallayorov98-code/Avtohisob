/**
 * Tashkilot doirasidagi umumiy sozlamalar.
 * Asosiy maqsad: "Soddalashtirilgan ko'rinish" rejimi orqali norasmiy yozuvlarni
 * butun sayt bo'ylab yashirish.
 */
import { prisma } from '../lib/prisma'

interface OrgSettingsCache {
  simplifiedView: boolean
}

// Kichik in-memory cache: 30 soniya. Tashkilot ko'p so'rov qilganida har safar DB ga bormaslik uchun.
const cache = new Map<string, { data: OrgSettingsCache; expiresAt: number }>()
const CACHE_TTL_MS = 30 * 1000

export async function getOrgSettings(orgId: string | null | undefined): Promise<OrgSettingsCache> {
  if (!orgId) return { simplifiedView: false }
  const cached = cache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const setting = await (prisma as any).orgSetting.findUnique({
    where: { organizationId: orgId },
    select: { simplifiedView: true },
  })
  const data: OrgSettingsCache = { simplifiedView: setting?.simplifiedView ?? false }
  cache.set(orgId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

/** Soddalashtirilgan ko'rinish yoqilganmi? Tezkor tekshiruv */
export async function isSimplifiedView(orgId: string | null | undefined): Promise<boolean> {
  const s = await getOrgSettings(orgId)
  return s.simplifiedView
}

/** Cache'ni tozalash (toggle qilinganda) */
export function invalidateOrgSettingsCache(orgId: string | null | undefined) {
  if (orgId) cache.delete(orgId)
}
