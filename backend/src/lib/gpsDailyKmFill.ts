/**
 * GPS kunlik masofa keshini (VehicleDailyKm) to'ldirish.
 *
 * MAQSAD: yoqilg'i sarfini (L/100km) GPS bo'yicha hisoblash uchun har mashinaning
 * har kungi yurilgan km'ini OLDINDAN bazaga yozib qo'yish. Shunda yoqilg'i hisobi
 * (va Excel'da ko'p kiritish) GPS serveriga inline so'rov yubormaydi — qotib qolish/
 * uzilish bo'lmaydi. GPS tortish faqat shu fon jarayonida, bitta login + concurrency
 * limiti bilan amalga oshadi.
 *
 * Ikki kirish nuqtasi:
 *   - fillAllOrgsForDay()  — kunlik cron (kechagi kunni barcha orglar uchun)
 *   - enqueueOrgBackfill() — on-demand (foydalanuvchi eski oyni GPS bo'yicha so'rasa),
 *     navbat bilan (serial) ishlaydi — bir vaqtning o'zida bitta org backfill qilinadi.
 */
import { prisma } from './prisma'
import { getOrgDailyKmBatch } from '../services/wialonService'

const UZ_TZ_OFFSET_MS = 5 * 3600 * 1000

/** 'YYYY-MM-DD' (UTC+5 kun) → DATE sifatida saqlash uchun UTC yarim tunga normalizatsiya */
function dayStringToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

/** Org mashinalari + GPS lookup kaliti (gpsUnitName ?? registrationNumber) */
async function getOrgGpsVehicles(orgId: string): Promise<Array<{ vehicleId: string; lookupKey: string }>> {
  const orgBranches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: orgId }, { organizationId: orgId }] },
    select: { id: true },
  })
  const branchIds = orgBranches.map((b: any) => b.id)
  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true, gpsUnitName: true },
  })
  return vehicles.map(v => ({
    vehicleId: v.id,
    lookupKey: (v.gpsUnitName || v.registrationNumber).trim(),
  }))
}

export interface FillResult {
  orgId: string
  vehicles: number
  daysWritten: number
  skipped: boolean
  reason?: string
}

/**
 * Bitta org uchun [fromDate..toDate] oralig'idagi kunlik km'ni GPS'dan tortib upsert qiladi.
 * Oraliq 31 kunlik bo'laklarga bo'linadi (har bo'lak — bitta batch login). Mavjud kunlar
 * force=false bo'lsa qayta yozilmaydi (idempotent, resume).
 */
export async function fillOrgDailyKm(
  orgId: string,
  fromDate: Date,
  toDate: Date,
  opts: { force?: boolean } = {},
): Promise<FillResult> {
  const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
  if (!cred || !cred.isActive) {
    return { orgId, vehicles: 0, daysWritten: 0, skipped: true, reason: 'GPS ulanishi yo\'q yoki nofaol' }
  }

  const vehicles = await getOrgGpsVehicles(orgId)
  if (vehicles.length === 0) {
    return { orgId, vehicles: 0, daysWritten: 0, skipped: true, reason: 'Faol mashina yo\'q' }
  }

  // Oraliqni 31 kunlik bo'laklarga bo'lamiz — har bo'lak chunked trek bilan yuklanadi.
  const CHUNK_DAYS = 31
  let daysWritten = 0
  const cursor = new Date(Math.floor(fromDate.getTime() / 86400000) * 86400000)
  const end = toDate.getTime()

  while (cursor.getTime() <= end) {
    const chunkFrom = new Date(cursor)
    const chunkTo = new Date(Math.min(end, cursor.getTime() + (CHUNK_DAYS - 1) * 86400000 + 86399000))

    // GPS xabarlari UTC timestamp; UTC+5 kun chegarasini qamrash uchun bir oz kengaytiramiz.
    const fromTs = Math.floor((chunkFrom.getTime() - UZ_TZ_OFFSET_MS) / 1000)
    const toTs = Math.floor((chunkTo.getTime() + 86400000) / 1000)

    const perVehicle = await getOrgDailyKmBatch(cred.id, vehicles, fromTs, toTs)

    for (const [vehicleId, days] of perVehicle) {
      for (const d of days) {
        // Faqat so'ralgan oraliqdagi kunlarni yozamiz (kengaytma chetga chiqib ketmasin)
        const dayDate = dayStringToDate(d.date)
        if (dayDate < dayStringToDate(toIsoDay(chunkFrom)) || dayDate > dayStringToDate(toIsoDay(chunkTo))) continue
        if (d.km <= 0) continue

        if (!opts.force) {
          const existing = await (prisma as any).vehicleDailyKm.findUnique({
            where: { vehicleId_date: { vehicleId, date: dayDate } },
            select: { id: true },
          })
          if (existing) continue
        }

        await (prisma as any).vehicleDailyKm.upsert({
          where: { vehicleId_date: { vehicleId, date: dayDate } },
          create: { vehicleId, date: dayDate, km: d.km, source: 'gps', syncedAt: new Date() },
          update: { km: d.km, source: 'gps', syncedAt: new Date() },
        })
        daysWritten++
      }
    }

    cursor.setTime(cursor.getTime() + CHUNK_DAYS * 86400000)
  }

  return { orgId, vehicles: vehicles.length, daysWritten, skipped: false }
}

/** UTC+5 kun stringi (computeDailyTrackKm bilan bir xil shkala) */
function toIsoDay(d: Date): string {
  return new Date(d.getTime() + UZ_TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Kunlik cron: barcha faol GPS orglar uchun KECHAGI kunni to'ldiradi.
 * GPS mileage sync (har 2 soat) dan keyin ishlatish maqsadga muvofiq.
 */
export async function fillAllOrgsForDay(targetDate?: Date): Promise<void> {
  const day = targetDate ?? new Date(Date.now() - 86400000) // kecha
  const from = new Date(`${toIsoDay(day)}T00:00:00.000Z`)
  const to = new Date(`${toIsoDay(day)}T23:59:59.000Z`)

  const creds = await (prisma as any).gpsCredential.findMany({
    where: { isActive: true },
    select: { orgId: true },
  })
  for (const c of creds) {
    try {
      const r = await fillOrgDailyKm(c.orgId, from, to)
      if (!r.skipped && r.daysWritten > 0) {
        console.log(`[GPS-DailyKm] org=${c.orgId} ${toIsoDay(day)}: ${r.daysWritten} kun yozildi`)
      }
    } catch (e: any) {
      console.error(`[GPS-DailyKm] org=${c.orgId} xato:`, e?.message)
    }
  }
}

// ─── On-demand backfill navbati (serial) ──────────────────────────────────────
// Bir vaqtda bitta backfill — ko'p so'rov GPS serverini bosmasligi uchun.
const backfillQueue: Array<{ orgId: string; from: Date; to: Date; force: boolean }> = []
const queuedOrgs = new Set<string>()
let processing = false

export function enqueueOrgBackfill(orgId: string, from: Date, to: Date, force = false): boolean {
  if (queuedOrgs.has(orgId)) return false // shu org allaqachon navbatda
  backfillQueue.push({ orgId, from, to, force })
  queuedOrgs.add(orgId)
  void processBackfillQueue()
  return true
}

export function isBackfillQueued(orgId: string): boolean {
  return queuedOrgs.has(orgId)
}

async function processBackfillQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (backfillQueue.length > 0) {
      const job = backfillQueue.shift()!
      try {
        const r = await fillOrgDailyKm(job.orgId, job.from, job.to, { force: job.force })
        console.log(`[GPS-DailyKm] backfill org=${job.orgId}: ${r.daysWritten} kun (${r.vehicles} mashina)`)
      } catch (e: any) {
        console.error(`[GPS-DailyKm] backfill xato org=${job.orgId}:`, e?.message)
      } finally {
        queuedOrgs.delete(job.orgId)
      }
    }
  } finally {
    processing = false
  }
}
