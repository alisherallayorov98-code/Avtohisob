/**
 * Public landing statistikasi — avtohisob.uz bosh sahifasidagi "jonli" raqamlar.
 *
 * Public endpoint: /api/public/stats — autentifikatsiyasiz, faqat-o'qish.
 * Hech qanday korxona ma'lumotini oshkor qilmaydi — faqat platforma bo'yicha
 * jami agregat sonlar (texnika soni, korxonalar soni). Bu raqamlar yangi mijoz
 * qo'shilgani sayin tabiiy ravishda o'sib boradi — qo'lda yangilash shart emas.
 *
 * Yuk: bosh sahifa har tashrifda chaqiradi, shuning uchun natija 5 daqiqa
 * in-memory cache'lanadi (DB'ni ortiqcha yuklamaslik uchun).
 */
import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'

type StatsPayload = {
  vehicles: number
  organizations: number
  branches: number
  totalKm: number
  anomalies: number
}

// Eng past chegara — DB vaqtinchalik nosoz bo'lsa ham sayt tarixiy raqamdan
// pastga "tushib" ketmasligi uchun (94 ta birinchi mijozdan ma'lum).
const VEHICLE_FLOOR = 90

let cache: { data: StatsPayload; at: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getPublicStats(_req: Request, res: Response, next: NextFunction) {
  try {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ success: true, data: cache.data })
    }

    const [vehicles, branches, orgRoots, kmAgg, anomalies] = await Promise.all([
      // Aktiv texnikalar — butun platforma bo'yicha jami
      prisma.vehicle.count({ where: { status: 'active' } }).catch(() => 0),
      prisma.branch.count({ where: { isActive: true } }).catch(() => 0),
      // Mustaqil korxonalar ≈ bosh filiallar (organizationId yo'q)
      prisma.branch.count({ where: { isActive: true, organizationId: null } }).catch(() => 0),
      // Jami nazoratdagi masofa — barcha texnika odometri yig'indisi
      prisma.vehicle.aggregate({ _sum: { mileage: true } }).catch(() => ({ _sum: { mileage: null } })),
      // Aniqlangan anomaliyalar (yoqilg'i sliv, ortiqcha sarf va h.k.)
      prisma.anomaly.count().catch(() => 0),
    ])

    const data: StatsPayload = {
      vehicles: Math.max(vehicles, VEHICLE_FLOOR),
      organizations: orgRoots,
      branches,
      totalKm: Math.round(Number(kmAgg?._sum?.mileage ?? 0)),
      anomalies,
    }

    cache = { data, at: Date.now() }
    return res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
