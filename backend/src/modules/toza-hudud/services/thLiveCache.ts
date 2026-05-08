/**
 * In-memory live cache for vehicle GPS positions.
 * TTL: 90 seconds per org. Background refresh on access if stale.
 */

import { getOrgVehiclePositions } from '../../../services/wialonService'

interface CacheEntry {
  positions: any[]
  updatedAt: number // unix ms
}

const CACHE_TTL_MS = 90 * 1000

const cache = new Map<string, CacheEntry>()
const refreshing = new Set<string>()

async function refreshCache(orgId: string): Promise<void> {
  if (refreshing.has(orgId)) return
  refreshing.add(orgId)
  try {
    const positions = await getOrgVehiclePositions(orgId)
    cache.set(orgId, { positions, updatedAt: Date.now() })
  } catch (e: any) {
    console.warn(`[LiveCache] refresh failed for org=${orgId}: ${e.message}`)
  } finally {
    refreshing.delete(orgId)
  }
}

/**
 * Org uchun jonli pozitsiyalarni qaytaradi.
 * Cache yangi bo'lsa — darhol qaytaradi.
 * Eski bo'lsa — eski ma'lumotni qaytarib, background'da yangilaydi.
 * Yo'q bo'lsa — kutib, yangi ma'lumot qaytaradi.
 */
export async function getLivePositions(orgId: string): Promise<any[]> {
  const entry = cache.get(orgId)
  const now = Date.now()

  if (!entry) {
    // Birinchi marta — sinxron kutamiz
    await refreshCache(orgId)
    return cache.get(orgId)?.positions ?? []
  }

  if (now - entry.updatedAt > CACHE_TTL_MS) {
    // Eski — eski ma'lumotni qaytarib background'da yangilaymiz
    refreshCache(orgId) // fire-and-forget
  }

  return entry.positions
}

/**
 * Cache'ni tozalash (masalan, test yoki restart uchun).
 */
export function clearLiveCache(orgId?: string): void {
  if (orgId) cache.delete(orgId)
  else cache.clear()
}

/**
 * Cache holati (diagnostika uchun).
 */
export function getLiveCacheStats(): Array<{ orgId: string; age: number; count: number }> {
  const now = Date.now()
  return Array.from(cache.entries()).map(([orgId, entry]) => ({
    orgId,
    age: Math.round((now - entry.updatedAt) / 1000),
    count: entry.positions.length,
  }))
}
