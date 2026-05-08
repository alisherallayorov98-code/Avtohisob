/**
 * Toza-Hudud: Konteyner intellekti
 *
 * Har bir konteyner uchun:
 *   - O'rtacha tashrif intervali (kunlarda)
 *   - Oxirgi tashrif qachon bo'lganini aniqlash
 *   - Keyingi tashrif prognozi (avg interval + oxirgi tashrif)
 *   - Kechikish holati: interval 1.5x o'tgan bo'lsa — delayed
 *
 * checkOverdueContainers(orgId) — kechikkan konteynerlarni topib qaytaradi.
 */

import { prisma } from '../../../lib/prisma'

export interface ContainerStats {
  containerId: string
  name: string
  mfyName: string | null
  lat: number
  lon: number
  avgIntervalDays: number | null    // O'rtacha necha kunda bir tashrif
  lastVisitDate: string | null      // "2026-05-07" formatida
  daysSinceLastVisit: number | null // Bugundan necha kun o'tdi
  nextVisitExpected: string | null  // Taxminiy keyingi tashrif
  isOverdue: boolean                // interval * 1.5 dan ko'proq o'tgan
  totalVisits: number
}

// ── Asosiy hisoblash ──────────────────────────────────────────────────────────

export async function getContainerAnalytics(orgId: string): Promise<ContainerStats[]> {
  const containers = await (prisma as any).thContainer.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, name: true, latitude: true, longitude: true,
      mfy: { select: { name: true } },
      visits: {
        select: { date: true },
        orderBy: { date: 'desc' },
        take: 60,  // Oxirgi 60 tashrif yetarli
      },
    },
  }).catch(() => [] as any[])

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  return containers.map((c: any) => {
    const visits: Date[] = c.visits.map((v: any) => new Date(v.date))
    if (visits.length === 0) {
      return {
        containerId: c.id,
        name: c.name,
        mfyName: c.mfy?.name ?? null,
        lat: c.latitude,
        lon: c.longitude,
        avgIntervalDays: null,
        lastVisitDate: null,
        daysSinceLastVisit: null,
        nextVisitExpected: null,
        isOverdue: false,
        totalVisits: 0,
      }
    }

    // Oxirgi tashrif
    const lastVisit = visits[0]
    const daysSince = Math.floor((today.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))

    // O'rtacha interval: ketma-ket tashriflar orasidagi farq
    let avgIntervalDays: number | null = null
    if (visits.length >= 2) {
      let totalDiff = 0
      for (let i = 0; i < visits.length - 1; i++) {
        totalDiff += Math.abs(visits[i].getTime() - visits[i + 1].getTime()) / (1000 * 60 * 60 * 24)
      }
      avgIntervalDays = Math.round((totalDiff / (visits.length - 1)) * 10) / 10
    }

    // Keyingi tashrif prognozi
    let nextVisitExpected: string | null = null
    if (avgIntervalDays !== null) {
      const nextDate = new Date(lastVisit.getTime() + avgIntervalDays * 24 * 60 * 60 * 1000)
      nextVisitExpected = nextDate.toISOString().split('T')[0]
    }

    // Kechikish: avgInterval * 1.5 dan daysSince ko'proq bo'lsa
    const isOverdue = avgIntervalDays !== null && daysSince > avgIntervalDays * 1.5

    return {
      containerId: c.id,
      name: c.name,
      mfyName: c.mfy?.name ?? null,
      lat: c.latitude,
      lon: c.longitude,
      avgIntervalDays,
      lastVisitDate: lastVisit.toISOString().split('T')[0],
      daysSinceLastVisit: daysSince,
      nextVisitExpected,
      isOverdue,
      totalVisits: c.visits.length,
    }
  })
}

// ── Kechikkan konteynerlarni topish (Telegram uchun) ─────────────────────────

export async function checkOverdueContainers(orgId: string): Promise<ContainerStats[]> {
  const all = await getContainerAnalytics(orgId)
  return all.filter(c => c.isOverdue)
}
