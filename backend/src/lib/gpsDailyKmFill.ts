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

// ─── Bir martalik 6 oylik backfill: job + hafta coverage + real progress ──────
//
// Talab: bitta knopka 6 oylik km'ni tortadi; 0→100% real progress; bosqichlarga
// (haftalik bo'lak) bo'linadi; FAQAT bir marta — tortilgan haftalar qayta tortilmaydi
// (VehicleDailyKmCoverage), bor kunlar ikki marta yozilmaydi (idempotent upsert).

const BACKFILL_DAYS = 183 // ~6 oy
const WEEK_MS = 7 * 86400000

// 7 kunlik bo'lakni qat'iy epoxaga tekislash — weekStart deterministik bo'lsin.
function weekStartMs(ts: number): number {
  const local = ts + UZ_TZ_OFFSET_MS
  const aligned = Math.floor(local / WEEK_MS) * WEEK_MS
  return aligned - UZ_TZ_OFFSET_MS
}

// Hafta kaliti — coverage yozish VA tekshirish AYNAN bir xil bazada bo'lishi shart
// (UTC+5 mahalliy kun). Aks holda yozilgan kalit bilan tekshirilgan kalit mos kelmay
// har safar hammasi qayta tortiladi.
function weekKey(wStart: number): string {
  return new Date(weekStartMs(wStart) + UZ_TZ_OFFSET_MS).toISOString().slice(0, 10)
}

// Shu jarayonda allaqachon ishlab turgan orglar — bitta process'da ikki worker bo'lmasin.
const activeWorkers = new Set<string>()

export interface BackfillProgress {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  percent: number
  error?: string | null
}

/**
 * 6 oylik backfill'ni boshlaydi (yoki tortilmagan haftalar qolgan bo'lsa davom ettiradi).
 * Tez qaytadi — tortish fonda. Qaytadi: boshlandimi (true) yoki allaqachon ketyaptimi (false).
 */
export async function startOrgBackfill(orgId: string): Promise<{ started: boolean; progress: BackfillProgress }> {
  // Allaqachon shu process'da ishlayotgan bo'lsa — qayta boshlamaymiz
  if (activeWorkers.has(orgId)) {
    return { started: false, progress: await getBackfillProgress(orgId) }
  }

  const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
  if (!cred || !cred.isActive) {
    throw new Error('GPS ulanishi yo\'q yoki nofaol')
  }

  // Oxirgi 6 oyning hafta-boshlari ro'yxati
  const now = Date.now()
  const startMs = weekStartMs(now - BACKFILL_DAYS * 86400000)
  const weeks: number[] = []
  for (let w = startMs; w <= now; w += WEEK_MS) weeks.push(w)

  // Allaqachon tortilgan haftalar
  const covered = await (prisma as any).vehicleDailyKmCoverage.findMany({
    where: { orgId }, select: { weekStart: true },
  })
  const coveredSet = new Set<string>(covered.map((c: any) => new Date(c.weekStart).toISOString().slice(0, 10)))
  const pending = weeks.filter(w => !coveredSet.has(weekKey(w)))

  await (prisma as any).gpsBackfillJob.upsert({
    where: { orgId },
    create: { orgId, status: pending.length ? 'running' : 'done', total: pending.length, done: 0, startedAt: new Date(), finishedAt: pending.length ? null : new Date(), error: null },
    update: { status: pending.length ? 'running' : 'done', total: pending.length, done: 0, startedAt: new Date(), finishedAt: pending.length ? null : new Date(), error: null },
  })

  if (pending.length === 0) {
    return { started: false, progress: { status: 'done', total: 0, done: 0, percent: 100 } }
  }

  // Worker'ni fonda ishga tushiramiz (await qilmaymiz)
  void runBackfillWorker(orgId, cred.id, pending)
  return { started: true, progress: { status: 'running', total: pending.length, done: 0, percent: 0 } }
}

async function runBackfillWorker(orgId: string, credId: string, pending: number[]): Promise<void> {
  if (activeWorkers.has(orgId)) return
  activeWorkers.add(orgId)
  try {
    const vehicles = await getOrgGpsVehicles(orgId)
    if (vehicles.length === 0) {
      await (prisma as any).gpsBackfillJob.update({
        where: { orgId }, data: { status: 'done', finishedAt: new Date() },
      })
      return
    }

    let done = 0
    for (const w of pending) {
      const wStart = weekStartMs(w)
      const fromTs = Math.floor((wStart - UZ_TZ_OFFSET_MS) / 1000)
      const toTs = Math.floor((wStart + WEEK_MS) / 1000)
      try {
        // Xavfsizlik timeout: bitta hafta hech qachon butun jarayonni muzlatib qo'ymasin
        // (tarmoq osilib qolsa). Timeout bo'lsa — hafta o'tkazib yuboriladi, keyingi
        // safar (resume/cron) qayta urinilsin. Coverage qilinmaydi.
        const WEEK_TIMEOUT_MS = 180000
        let timer: NodeJS.Timeout | undefined
        const timeoutP = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('hafta timeout (180s)')), WEEK_TIMEOUT_MS)
        })
        let perVehicle: Map<string, Array<{ date: string; km: number }>>
        try {
          perVehicle = await Promise.race([getOrgDailyKmBatch(credId, vehicles, fromTs, toTs), timeoutP])
        } finally {
          if (timer) clearTimeout(timer)
        }
        for (const [vehicleId, days] of perVehicle) {
          for (const d of days) {
            if (d.km <= 0) continue
            const dayDate = dayStringToDate(d.date)
            await (prisma as any).vehicleDailyKm.upsert({
              where: { vehicleId_date: { vehicleId, date: dayDate } },
              create: { vehicleId, date: dayDate, km: d.km, source: 'gps', syncedAt: new Date() },
              update: { km: d.km, source: 'gps', syncedAt: new Date() },
            })
          }
        }
        // Bu hafta tortildi — coverage belgilaymiz (km 0 bo'lsa ham, qayta tortmaslik uchun).
        // weekKey() pending-tekshiruvi bilan AYNAN bir xil kalit beradi.
        const weekDate = new Date(weekKey(w) + 'T00:00:00.000Z')
        await (prisma as any).vehicleDailyKmCoverage.upsert({
          where: { orgId_weekStart: { orgId, weekStart: weekDate } },
          create: { orgId, weekStart: weekDate },
          update: { syncedAt: new Date() },
        })
      } catch (e: any) {
        console.error(`[GPS-DailyKm] backfill hafta xato org=${orgId}:`, e?.message)
        // Bu haftani coverage qilmaymiz — keyingi safar qayta urinilsin. Jarayon davom etadi.
      }
      done++
      await (prisma as any).gpsBackfillJob.update({ where: { orgId }, data: { done } })
    }

    await (prisma as any).gpsBackfillJob.update({
      where: { orgId }, data: { status: 'done', finishedAt: new Date() },
    })
    console.log(`[GPS-DailyKm] backfill tugadi org=${orgId}: ${done}/${pending.length} hafta`)
  } catch (e: any) {
    console.error(`[GPS-DailyKm] backfill worker xato org=${orgId}:`, e?.message)
    await (prisma as any).gpsBackfillJob.update({
      where: { orgId }, data: { status: 'error', error: String(e?.message || e).slice(0, 500) },
    }).catch(() => {})
  } finally {
    activeWorkers.delete(orgId)
  }
}

/**
 * Server qayta ishga tushganda yarim qolgan ('running') backfill'larni davom ettiradi.
 * Deploy/restart worker'ni (xotirada) o'ldiradi, lekin job bazada 'running' qoladi —
 * bu funksiya bo'lmasa progress 70%da "qotib" qolardi. startOrgBackfill tortilmagan
 * (coverage'siz) haftalardan davom etadi. server start'da bir marta chaqiriladi.
 */
export async function resumeRunningBackfills(): Promise<void> {
  try {
    const jobs = await (prisma as any).gpsBackfillJob.findMany({ where: { status: 'running' }, select: { orgId: true } })
    for (const job of jobs) {
      console.log(`[GPS-DailyKm] yarim qolgan backfill davom ettirilmoqda org=${job.orgId}`)
      await startOrgBackfill(job.orgId).catch((e: any) =>
        console.error(`[GPS-DailyKm] resume xato org=${job.orgId}:`, e?.message))
    }
  } catch (e: any) {
    console.error('[GPS-DailyKm] resumeRunningBackfills xato:', e?.message)
  }
}

/** Backfill holati (0→100%). Job yo'q bo'lsa 'idle'. */
export async function getBackfillProgress(orgId: string): Promise<BackfillProgress> {
  const job = await (prisma as any).gpsBackfillJob.findUnique({ where: { orgId } })
  if (!job) return { status: 'idle', total: 0, done: 0, percent: 0 }
  const total = job.total || 0
  const done = job.done || 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : (job.status === 'done' ? 100 : 0)
  return { status: job.status, total, done, percent, error: job.error }
}
