import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getVehicleTrackPoints } from '../../../services/wialonService'
import { computeGridCoverageDetailed, getDayUtsRange, findCredForVehicle, TrackPoint } from '../services/thMonitor'
import {
  annotateWithHistory, AnnotatedCell, runFingerprintBatch, getFingerprintStatus,
  getMfyMonthlyTrend, getMissedPatterns, runIncrementalTraining, invalidateFingerprintCache,
  getVehicleTrainingStatusList,
} from '../services/thCoverageAI'
import { fetchAndStoreMfyStreets, fetchStreetsForAllMfys } from '../../../services/osmService'
import { getMfyStreetStats, getOrgStreetCoverageStats, computeDayStreetCoverage } from '../services/streetMatcher'
import { AuthRequest } from '../../../types'
import { resolveOrgId } from '../../../lib/orgFilter'
import { loadThSettings } from '../controllers/settings'

// ── Token: HMAC-signed payload (vehicleId + mfyId + dates + orgId) ────────────

export interface CoverageTokenPayload {
  vehicleId: string
  mfyId: string
  orgId: string
  dates: string[]   // ISO: "2026-05-05"
  v: number
  exp?: number      // UNIX timestamp — token amal qilish muddati
}

export function signCoverageToken(payload: Omit<CoverageTokenPayload, 'v' | 'exp'>): string {
  const p: CoverageTokenPayload = { ...payload, v: 2, exp: Math.floor(Date.now() / 1000) + 86400 }
  const encoded = Buffer.from(JSON.stringify(p)).toString('base64url')
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET!)
    .update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

function verifyCoverageToken(token: string): CoverageTokenPayload | null {
  try {
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!)
      .update(encoded).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as CoverageTokenPayload
    if (payload.v !== 2) return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ── GPS track va coverage hisoblash (qayta ishlatiluvchi) ────────────────────

async function fetchCoverageData(
  vehicleId: string,
  mfyPolygon: any,
  dates: string[],
  orgId?: string | null,
): Promise<{
  allTrack: TrackPoint[]
  trackByDate: Record<string, number>
  cells: Array<{ lat: number; lon: number; covered: boolean }>
  coveredPct: number
}> {
  const credInfo = await findCredForVehicle(vehicleId)
  const allTrack: TrackPoint[] = []
  const trackByDate: Record<string, number> = {}

  for (const dateStr of dates) {
    const dateObj = new Date(dateStr + 'T00:00:00.000Z')
    const { fromTs, toTs } = getDayUtsRange(dateObj)

    let dayTrack: TrackPoint[] = []
    if (credInfo) {
      dayTrack = await getVehicleTrackPoints(credInfo.credId, credInfo.lookupKey, fromTs, toTs)
        .catch(() => [])
    }
    trackByDate[dateStr] = dayTrack.length
    allTrack.push(...dayTrack)
  }

  // Grid sozlamalarini DB dan yuklaymiz (custom gridCellM/coverageRadiusM)
  const settings = await loadThSettings(orgId ?? null)
  const gridOpts = {
    gridCellM: (settings as any).gridCellM ?? 35,
    coverageRadiusM: (settings as any).coverageRadiusM ?? 40,
  }

  const { cells, coveredPct } = computeGridCoverageDetailed(mfyPolygon, allTrack, gridOpts)
  return { allTrack, trackByDate, cells, coveredPct }
}

// ── Annotated cells → ixchamlash ─────────────────────────────────────────────

function compactCells(annotated: AnnotatedCell[]) {
  return annotated.map(c => ({
    lat: Math.round(c.lat * 1e6) / 1e6,
    lon: Math.round(c.lon * 1e6) / 1e6,
    covered: c.covered,
    state: c.state,
  }))
}

// ── Route hints: missed kataklar klasterlaridan waypoint ─────────────────────

function computeRouteHints(
  annotated: AnnotatedCell[],
): Array<{ lat: number; lon: number; priority: 'high' | 'medium' }> {
  const highRisk = annotated.filter(c => c.state === 'high_risk_missed')
  const medRisk = annotated.filter(c => c.state === 'medium_risk_missed')

  // Oddiy klasterlash: qo'shni kataklar markazini birlashtirish (greedy, r=60m)
  function cluster(cells: AnnotatedCell[]): Array<{ lat: number; lon: number }> {
    const used = new Set<number>()
    const centers: Array<{ lat: number; lon: number }> = []
    const R = 6371000
    for (let i = 0; i < cells.length; i++) {
      if (used.has(i)) continue
      used.add(i)
      let sumLat = cells[i].lat, sumLon = cells[i].lon, count = 1
      for (let j = i + 1; j < cells.length; j++) {
        if (used.has(j)) continue
        const dLat = (cells[j].lat - cells[i].lat) * Math.PI / 180
        const dLon = (cells[j].lon - cells[i].lon) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(cells[i].lat * Math.PI / 180) * Math.cos(cells[j].lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        if (dist <= 60) { used.add(j); sumLat += cells[j].lat; sumLon += cells[j].lon; count++ }
      }
      centers.push({ lat: sumLat / count, lon: sumLon / count })
    }
    return centers
  }

  const hints: Array<{ lat: number; lon: number; priority: 'high' | 'medium' }> = []
  for (const c of cluster(highRisk).slice(0, 3)) hints.push({ ...c, priority: 'high' })
  for (const c of cluster(medRisk).slice(0, 2)) hints.push({ ...c, priority: 'medium' })
  return hints
}

// ── Public: GET /th/coverage-public?token=X ───────────────────────────────────

export async function getCoveragePublic(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.query as { token?: string }
    if (!token) throw new AppError('Token talab qilinadi', 400)

    const payload = verifyCoverageToken(token)
    if (!payload) throw new AppError('Noto\'g\'ri yoki eskirgan havola', 401)

    const { vehicleId, mfyId, orgId, dates } = payload

    const mfy = await (prisma as any).thMfy.findUnique({
      where: { id: mfyId },
      select: { id: true, name: true, polygon: true, district: { select: { name: true } } },
    })
    if (!mfy || !mfy.polygon) throw new AppError('MFY yoki polygon topilmadi', 404)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    const { trackByDate, cells, coveredPct } = await fetchCoverageData(vehicleId, mfy.polygon, dates, orgId)

    // Tarix bilan annotatsiya (AI fingerprint)
    const annotated = await annotateWithHistory(vehicleId, mfyId, cells)
    const historicalMissed = annotated.filter(c =>
      c.state === 'high_risk_missed' || c.state === 'medium_risk_missed' || c.state === 'low_risk_missed'
    ).length
    const hasHistory = annotated.some(c => c.state !== 'never_visited' && !c.covered)
    const routeHints = computeRouteHints(annotated)

    res.json({
      success: true,
      data: {
        mfy: { id: mfy.id, name: mfy.name, district: mfy.district?.name || null, polygon: mfy.polygon },
        vehicle: { id: vehicle.id, registrationNumber: vehicle.registrationNumber, brand: vehicle.brand, model: vehicle.model },
        dates,
        trackByDate,
        coverage: {
          coveredPct,
          totalCells: cells.length,
          coveredCells: cells.filter(c => c.covered).length,
          historicallyMissedCells: historicalMissed,
          hasHistory,
          cells: compactCells(annotated),
        },
        routeHints,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── Public: POST /th/coverage-verify  (haydovchi "Men oldim" tasdiqlash) ─────
// Haydovchi borib keldi deb aytgach GPS yangi tortiladi va solishtirish qilinadi.

export async function verifyCoverage(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body as { token?: string }
    if (!token) throw new AppError('Token talab qilinadi', 400)

    const payload = verifyCoverageToken(token)
    if (!payload) throw new AppError('Noto\'g\'ri token', 401)

    const { vehicleId, mfyId, dates } = payload

    const mfy = await (prisma as any).thMfy.findUnique({
      where: { id: mfyId },
      select: { id: true, polygon: true },
    })
    if (!mfy?.polygon) throw new AppError('MFY polygon topilmadi', 404)

    // GPS ni yangi tortib qamrovni qayta hisoblaymiz
    const { trackByDate, cells, coveredPct } = await fetchCoverageData(vehicleId, mfy.polygon, dates, payload.orgId)

    // Tarix bilan annotatsiya
    const annotated = await annotateWithHistory(vehicleId, mfyId, cells)
    const historicalMissed = annotated.filter(c =>
      c.state === 'high_risk_missed' || c.state === 'medium_risk_missed' || c.state === 'low_risk_missed'
    ).length
    const routeHints = computeRouteHints(annotated)

    // DB da coveragePct ni yangilaymiz
    for (const dateStr of dates) {
      const dateObj = new Date(dateStr + 'T00:00:00.000Z')
      await (prisma as any).thServiceTrip.updateMany({
        where: { vehicleId, mfyId, date: dateObj, status: 'visited' },
        data: { coveragePct: coveredPct, updatedAt: new Date() },
      }).catch(() => null)
    }

    res.json({
      success: true,
      data: {
        coveredPct,
        totalCells: cells.length,
        coveredCells: cells.filter(c => c.covered).length,
        historicallyMissedCells: historicalMissed,
        trackByDate,
        cells: compactCells(annotated),
        routeHints,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── Admin: POST /th/ai/train  (fingerprint batch qurilishi) ──────────────────

// Global state — bir vaqtda ikki marta ishga tushirilmasin
let trainingInProgress = false
let trainingProgress = { current: 0, total: 0 }
const trainingLog: string[] = []
const MAX_LOG = 50

function addLog(msg: string) {
  trainingLog.push(msg)
  if (trainingLog.length > MAX_LOG) trainingLog.shift()
}

export async function startAiTraining(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (trainingInProgress) {
      return res.json({ success: true, data: { status: 'already_running' } })
    }

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    trainingInProgress = true
    trainingProgress = { current: 0, total: 0 }
    trainingLog.length = 0

    // Background'da ishga tushiramiz — javob darhol qaytadi
    res.json({ success: true, data: { status: 'started' } })

    runFingerprintBatch(orgId, 6,
      (done, total) => { trainingProgress = { current: done, total } },
      addLog,
    )
      .then(r => {
        console.log(`[ThCoverageAI] Training done: ${r.processed} pairs, ${r.errors} errors`)
        invalidateFingerprintCache()
      })
      .catch(e => console.error('[ThCoverageAI] Training error:', e?.message))
      .finally(() => { trainingInProgress = false })
  } catch (err) {
    trainingInProgress = false
    next(err)
  }
}

// ── Admin: GET /th/ai/status ──────────────────────────────────────────────────

export async function getAiStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const status = await getFingerprintStatus(orgId)
    res.json({
      success: true,
      data: {
        ...status,
        trainingInProgress,
        trainingProgress,
        trainingLog: trainingInProgress ? [...trainingLog] : trainingLog.slice(-5),
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── Admin: POST /th/ai/train-incremental ─────────────────────────────────────

export async function startIncrementalTraining(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (trainingInProgress) {
      return res.json({ success: true, data: { status: 'already_running' } })
    }

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    trainingInProgress = true
    trainingProgress = { current: 0, total: 0 }
    trainingLog.length = 0
    res.json({ success: true, data: { status: 'started', mode: 'incremental' } })

    runIncrementalTraining(orgId, 1,
      (done, total) => { trainingProgress = { current: done, total } },
      addLog,
    )
      .then(r => {
        console.log(`[ThCoverageAI] Incremental done: ${r.processed} pairs`)
        invalidateFingerprintCache()
      })
      .catch(e => console.error('[ThCoverageAI] Incremental error:', e?.message))
      .finally(() => { trainingInProgress = false })
  } catch (err) {
    trainingInProgress = false
    next(err)
  }
}

// ── Admin: GET /th/ai/trend/:vehicleId/:mfyId ────────────────────────────────

export async function getAiTrend(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, mfyId } = req.params
    if (!vehicleId || !mfyId) throw new AppError('vehicleId va mfyId talab qilinadi', 400)

    const mfy = await (prisma as any).thMfy.findUnique({
      where: { id: mfyId },
      select: { id: true, polygon: true },
    })
    if (!mfy?.polygon) throw new AppError('MFY yoki polygon topilmadi', 404)

    const trend = await getMfyMonthlyTrend(vehicleId, mfyId, mfy.polygon)
    res.json({ success: true, data: trend })
  } catch (err) {
    next(err)
  }
}

// ── Admin: GET /th/ai/debug — o'qitish nima qilishini tekshiradi ─────────────

export async function getAiDebug(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const { findCredForVehicle } = await import('../services/thMonitor')

    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true, name: true },
    }).catch(() => [] as any[])
    const branchIds = branches.map((b: any) => b.id)

    const vehicles = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true, registrationNumber: true, gpsUnitName: true },
    })

    const schedules = await (prisma as any).thSchedule.findMany({
      where: { vehicleId: { in: vehicles.map(v => v.id) } },
      select: { vehicleId: true, mfyId: true },
    }).catch(() => [] as any[])

    const pairs = new Map<string, { vehicleId: string; mfyId: string }>()
    for (const s of schedules) pairs.set(`${s.vehicleId}::${s.mfyId}`, s)

    // Har mashina uchun credential mavjudligini tekshir
    const vehicleChecks = await Promise.all(vehicles.map(async v => {
      const cred = await findCredForVehicle(v.id).catch(() => null)
      return {
        vehicleId: v.id,
        regNumber: v.registrationNumber,
        gpsUnitName: v.gpsUnitName || null,
        hasCredentials: !!cred,
        lookupKey: cred?.lookupKey || null,
      }
    }))

    res.json({
      success: true,
      data: {
        orgId,
        branches: branches.length,
        vehicles: vehicles.length,
        schedulePairs: pairs.size,
        vehicleCredentials: vehicleChecks,
        trainingInProgress,
        trainingProgress,
      },
    })
  } catch (err) { next(err) }
}

// ── Admin: GET /th/ai/missed-patterns ────────────────────────────────────────

export async function getAiMissedPatterns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const threshold = Number(req.query.threshold) || 20
    const patterns = await getMissedPatterns(orgId, threshold)
    res.json({ success: true, data: patterns })
  } catch (err) {
    next(err)
  }
}

// ── POST /th/ai/fetch-streets ─────────────────────────────────────────────────
// OSM dan ko'chalarni yuklaydi. mfyId berilsa — faqat shu MFY, yo'q bo'lsa — barchasi.

let streetFetchInProgress = false

export async function fetchMfyStreetsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (streetFetchInProgress) {
      return res.json({ success: true, data: { status: 'already_running' } })
    }

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const { mfyId } = req.body as { mfyId?: string }

    if (mfyId) {
      // Bitta MFY — sinxron
      const result = await fetchAndStoreMfyStreets(mfyId)
      return res.json({ success: true, data: { status: 'done', ...result } })
    }

    // Hammasi — asinxron
    streetFetchInProgress = true
    res.json({ success: true, data: { status: 'started' } })

    fetchStreetsForAllMfys(orgId)
      .then(r => console.log(`[OSM] Streets fetched: ${r.totalStreets} for ${r.mfysProcessed} MFYs`))
      .catch(e => console.error('[OSM] fetchStreetsForAllMfys error:', e?.message))
      .finally(() => { streetFetchInProgress = false })
  } catch (err) {
    streetFetchInProgress = false
    next(err)
  }
}

// ── GET /th/ai/street-stats ───────────────────────────────────────────────────
// Tashkilot bo'yicha yoki bitta MFY bo'yicha ko'cha qamrovini qaytaradi.

export async function getStreetStatsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const { mfyId } = req.query as { mfyId?: string }

    if (mfyId) {
      // Bitta MFY — so'nggi 7 kun
      const dates: string[] = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        dates.push(d.toISOString().split('T')[0])
      }
      const trips = await (prisma as any).thServiceTrip.findMany({
        where: {
          mfyId,
          date: { in: dates.map(d => new Date(d + 'T00:00:00.000Z')) },
        },
        select: { vehicleId: true },
        distinct: ['vehicleId'],
      })
      const vehicleIds = trips.map((t: any) => t.vehicleId)
      const stats = await getMfyStreetStats(mfyId, vehicleIds, dates)
      return res.json({ success: true, data: stats })
    }

    const stats = await getOrgStreetCoverageStats(orgId)
    res.json({
      success: true,
      data: { ...stats, streetFetchInProgress },
    })
  } catch (err) {
    next(err)
  }
}

// ── GET /th/coverage/day ──────────────────────────────────────────────────────
// Kunlik ko'cha nazorati: tanlangan sana uchun BARCHA mashina treki +
// har bir ko'cha qaysidir mashina tomonidan qoplanган-qoplanmaganini qaytaradi.
// Eski sanalar uchun ham ishlaydi (SmartGPS 6+ oy tarix saqlaydi).

export async function getDayCoverage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // super_admin uchun resolveOrgId null qaytaradi — ?orgId= parametri qabul qilinadi,
    // berilmasa birinchi Toza-Hudud obunali tashkilot olinadi (single-tenant holat)
    let orgId = await resolveOrgId(req.user!)
    if (!orgId && req.user?.role === 'super_admin') {
      const qOrg = (req.query as any).orgId as string | undefined
      if (qOrg) orgId = qOrg
      else {
        const sub = await (prisma as any).subscription.findFirst({
          where: { status: 'active', features: { has: 'tozahudud_module' } },
          select: { organizationId: true },
        }).catch(() => null)
        orgId = sub?.organizationId ?? null
      }
    }
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const { date } = req.query as { date?: string }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppError('To\'g\'ri sana (YYYY-MM-DD) talab qilinadi', 400)
    }

    const settings = await loadThSettings(orgId)
    const radius = (settings as any).coverageRadiusM ?? 30

    const result = await computeDayStreetCoverage(orgId, date, radius)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
}

// ── Org-level training queue ──────────────────────────────────────────────────
// Har bir org uchun faqat 1 ta aktiv training; qolganlari navbatda kutadi.
// Bu xotirani to'lib ketishidan saqlaydi.

interface TrainingQueueItem { vehicleId: string; orgId: string }

// orgId → hozir o'qitilayotgan vehicleId (yoki undefined)
const orgActiveTraining = new Map<string, string>()
// orgId → kutayotgan vehicleId'lar navbati
const orgTrainingQueue  = new Map<string, string[]>()

function getQueuePosition(orgId: string, vehicleId: string): number {
  const active = orgActiveTraining.get(orgId)
  if (active === vehicleId) return 0 // aktiv
  const queue = orgTrainingQueue.get(orgId) ?? []
  const idx = queue.indexOf(vehicleId)
  return idx === -1 ? -1 : idx + 1 // navbat: 1, 2, 3...
}

async function processOrgQueue(orgId: string): Promise<void> {
  const queue = orgTrainingQueue.get(orgId) ?? []
  if (queue.length === 0) {
    orgActiveTraining.delete(orgId)
    return
  }
  const vehicleId = queue.shift()!
  orgTrainingQueue.set(orgId, queue)
  orgActiveTraining.set(orgId, vehicleId)

  try {
    const r = await runFingerprintBatch(orgId, 6, undefined, undefined, [vehicleId])
    console.log(`[ThQueue] ${vehicleId} trained: ${r.processed} pairs, ${r.errors} errors`)
    invalidateFingerprintCache(vehicleId)
  } catch (e: any) {
    console.error(`[ThQueue] ${vehicleId} training error:`, e?.message)
  }
  // Navbatdagi mashinani ishga tushir
  await processOrgQueue(orgId)
}

// ── GET /th/ai/vehicle-status ─────────────────────────────────────────────────
export async function getVehicleTrainingStatusHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const list = await getVehicleTrainingStatusList(orgId)
    const active = orgActiveTraining.get(orgId)
    const queue  = orgTrainingQueue.get(orgId) ?? []

    const data = list.map(v => {
      // trainingStatus — navbat holati (idle/training/queued).
      // v.status (untrained/partial/trained) — o'qitilganlik darajasi; ustiga yozilmasligi shart,
      // frontend ikkala maydonni ham alohida ishlatadi.
      let trainingStatus: 'idle' | 'training' | 'queued' = 'idle'
      let queuePosition = -1
      if (active === v.vehicleId) { trainingStatus = 'training'; queuePosition = 0 }
      else {
        const idx = queue.indexOf(v.vehicleId)
        if (idx !== -1) { trainingStatus = 'queued'; queuePosition = idx + 1 }
      }
      return { ...v, inProgress: trainingStatus === 'training', trainingStatus, queuePosition }
    })

    res.json({ success: true, data, queueLength: queue.length, activeVehicleId: active ?? null })
  } catch (err) { next(err) }
}

// ── POST /th/ai/train-vehicle ─────────────────────────────────────────────────
export async function trainSingleVehicleHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const { vehicleId } = req.body as { vehicleId?: string }
    if (!vehicleId) throw new AppError('vehicleId talab qilinadi', 400)

    const active = orgActiveTraining.get(orgId)
    const queue  = orgTrainingQueue.get(orgId) ?? []

    // Allaqachon aktiv yoki navbatda
    if (active === vehicleId) {
      return res.json({ success: true, data: { status: 'training', queuePosition: 0 } })
    }
    if (queue.includes(vehicleId)) {
      const pos = queue.indexOf(vehicleId) + 1
      return res.json({ success: true, data: { status: 'queued', queuePosition: pos } })
    }

    if (!active) {
      // Hech kim o'qitilmayapti → navbatga qo'yib darhol boshlash.
      // processOrgQueue NAVBATDAN oladi — shuning uchun mashina navbatga qo'shiladi
      // (avval faqat active set qilinardi va bo'sh navbatda training umuman boshlanmasdi).
      // active sinxron set qilinadi — parallel so'rov ikkinchi loop ochmasin.
      queue.push(vehicleId)
      orgTrainingQueue.set(orgId, queue)
      orgActiveTraining.set(orgId, vehicleId)
      res.json({ success: true, data: { status: 'started', queuePosition: 0 } })
      processOrgQueue(orgId).catch(e => console.error('[ThQueue] processOrgQueue error:', e?.message))
    } else {
      // Boshqa mashina o'qitilmoqda → navbatga qo'sh
      queue.push(vehicleId)
      orgTrainingQueue.set(orgId, queue)
      res.json({ success: true, data: { status: 'queued', queuePosition: queue.length } })
    }
  } catch (err) { next(err) }
}
