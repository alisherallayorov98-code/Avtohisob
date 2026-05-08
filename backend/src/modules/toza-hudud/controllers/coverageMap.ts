import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getVehicleTrackPoints } from '../../../services/wialonService'
import { computeGridCoverageDetailed, getDayUtsRange, findCredForVehicle, TrackPoint } from '../services/thMonitor'
import { annotateWithHistory, AnnotatedCell, runFingerprintBatch, getFingerprintStatus } from '../services/thCoverageAI'
import { AuthRequest } from '../../../types'
import { resolveOrgId } from '../../../lib/orgFilter'

// ── Token: HMAC-signed payload (vehicleId + mfyId + dates + orgId) ────────────

export interface CoverageTokenPayload {
  vehicleId: string
  mfyId: string
  orgId: string
  dates: string[]   // ISO: "2026-05-05"
  v: number
}

export function signCoverageToken(payload: Omit<CoverageTokenPayload, 'v'>): string {
  const p: CoverageTokenPayload = { ...payload, v: 2 }
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

  const { cells, coveredPct } = computeGridCoverageDetailed(mfyPolygon, allTrack)
  return { allTrack, trackByDate, cells, coveredPct }
}

// ── Annotated cells (tarix bilan) → ixchamlash ───────────────────────────────

function compactCells(annotated: AnnotatedCell[]) {
  return annotated.map(c => ({
    lat: Math.round(c.lat * 1e6) / 1e6,
    lon: Math.round(c.lon * 1e6) / 1e6,
    covered: c.covered,
    state: c.state,
  }))
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

    const { trackByDate, cells, coveredPct } = await fetchCoverageData(vehicleId, mfy.polygon, dates)

    // Tarix bilan annotatsiya (AI fingerprint)
    const annotated = await annotateWithHistory(vehicleId, mfyId, cells)
    const historicalMissed = annotated.filter(c => c.state === 'historically_missed').length
    const hasHistory = annotated.some(c => c.state === 'historically_missed')

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
    const { trackByDate, cells, coveredPct } = await fetchCoverageData(vehicleId, mfy.polygon, dates)

    // Tarix bilan annotatsiya
    const annotated = await annotateWithHistory(vehicleId, mfyId, cells)
    const historicalMissed = annotated.filter(c => c.state === 'historically_missed').length

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
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── Admin: POST /th/ai/train  (fingerprint batch qurilishi) ──────────────────

// Global ishlamoqda flag — bir vaqtda ikki marta ishga tushirilmasin
let trainingInProgress = false

export async function startAiTraining(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (trainingInProgress) {
      return res.json({ success: true, data: { status: 'already_running' } })
    }

    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    trainingInProgress = true

    // Background'da ishga tushiramiz — javob darhol qaytadi
    res.json({ success: true, data: { status: 'started' } })

    runFingerprintBatch(orgId, 6)
      .then(r => console.log(`[ThCoverageAI] Training done: ${r.processed} pairs, ${r.errors} errors`))
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
      data: { ...status, trainingInProgress },
    })
  } catch (err) {
    next(err)
  }
}
