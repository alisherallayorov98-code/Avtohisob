import https from 'https'
import http from 'http'
import { prisma } from '../lib/prisma'

// Wialon unit flags: basic info (0x1) + last message (0x100) + counters (0x400)
const UNIT_FLAGS = 0x1 | 0x100 | 0x400
const TOKEN_DURATION = 7776000 // 90 days in seconds
const TOKEN_RENEW_THRESHOLD = 10 * 24 * 60 * 60 * 1000 // 10 kun qolsa yangilanadi

// GPS faqat km (odometr) sinxronlaydi.
// Yoqilg'i (benzin/gaz/dizel) miqdori GPS orqali ANIQLANMAYDI —
// buning uchun maxsus yoqilg'i sensori kerak bo'ladi.
// cnm.mc = Wialon mileage counter, metrda saqlanadi → km ga o'tkazish uchun / 1000

interface WialonUnit {
  id: number
  nm: string            // unit name (registration number)
  lmsg?: {
    t: number           // timestamp of last message
    pos?: { x: number; y: number; sc: number; z: number }
  } | null
  cnm?: {
    mc?: number         // mileage counter in meters
    ech?: number        // engine hours in seconds
  }
}

// ─── Low-level Wialon API calls ───────────────────────────────────────────────

// SmartGPS/Wialon serverlari SSL sertifikatida domain mismatch bo'lishi mumkin
// (2.smartgps.uz cert 2.wialon.uz ga berilgan). Shuning uchun rejectUnauthorized: false
function wialonPost(host: string, svc: string, params: object, sid?: string): Promise<any> {
  const bodyStr = new URLSearchParams({ svc, params: JSON.stringify(params), ...(sid ? { sid } : {}) }).toString()
  const url = new URL('/wialon/ajax.html', host)
  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: url.hostname,
      port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      rejectUnauthorized: false, // SmartGPS cert domain mismatch
      timeout: 20000,
    }, (res) => {
      let raw = ''
      res.on('data', (chunk: Buffer) => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw)
          if (data?.error) reject(new Error(`Wialon xatosi (${svc}): kod ${data.error}`))
          else resolve(data)
        } catch {
          reject(new Error(`JSON parse xatosi (${svc}): ${raw.slice(0, 100)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${svc}`)) })
    req.write(bodyStr)
    req.end()
  })
}

async function getSessionSid(host: string, username: string, password: string): Promise<string> {
  const data = await wialonPost(host, 'core/login', { user: username, password, fl: 1 })
  if (!data.eid) throw new Error('Login muvaffaqiyatsiz: sessiya ID olinmadi')
  return data.eid
}

async function createToken(host: string, sid: string): Promise<string> {
  const data = await wialonPost(host, 'token/update', {
    callMode: 'create',
    app: 'avtohisob',
    at: 0,
    dur: TOKEN_DURATION,
    fl: 0, // 0 = IP cheklovsiz; fl:1 bo'lsa token faqat yaratilgan IP dan ishlaydi
    p: '{}',
  }, sid)
  if (!data.h) throw new Error(`Token yaratib bo'lmadi: ${JSON.stringify(data)}`)
  return data.h
}

async function loginWithToken(host: string, token: string): Promise<string> {
  const data = await wialonPost(host, 'token/login', { token, fl: 1 })
  if (!data.eid) throw new Error('Token login muvaffaqiyatsiz')
  return data.eid
}

async function getUnits(host: string, sid: string): Promise<WialonUnit[]> {
  const data = await wialonPost(host, 'core/search_items', {
    spec: { itemsType: 'avl_unit', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
    force: 1,
    flags: UNIT_FLAGS,
    from: 0,
    to: 0,
  }, sid)
  return (data.items as WialonUnit[]) || []
}

// Token saqlash uchun muddatni hisoblash
function tokenExpiresAt(): Date {
  return new Date(Date.now() + TOKEN_DURATION * 1000)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Foydalanuvchi login/parol kiritadi → token olib saqlaymiz.
 * Parol DB ga saqlanmaydi — faqat token.
 */
export async function getTokenFromCredentials(
  host: string,
  username: string,
  password: string,
): Promise<{ token: string; expiresAt: Date }> {
  const sid = await getSessionSid(host, username, password)
  const token = await createToken(host, sid)
  return { token, expiresAt: tokenExpiresAt() }
}

/**
 * Tokenni tekshirish — login attempt, units count qaytaradi.
 */
export async function testConnection(host: string, token: string): Promise<{ unitCount: number }> {
  const sid = await loginWithToken(host, token)
  const units = await getUnits(host, sid)
  return { unitCount: units.length }
}

/**
 * Org uchun GPS mileage sync.
 * - Mileage regression va nol qiymatlar o'tkazib yuboriladi.
 * - Token 10 kun qolsa — avto yangilanadi (foydalanuvchi hech narsa qilmaydi).
 */
export async function syncOrgMileage(credentialId: string): Promise<{
  synced: number; skipped: number; errors: string[]
}> {
  const cred = await (prisma as any).gpsCredential.findUnique({ where: { id: credentialId } })
  if (!cred || !cred.isActive) throw new Error('GPS ulanishi topilmadi yoki faol emas')

  let sid: string
  try {
    sid = await loginWithToken(cred.host, cred.token)
  } catch (err: any) {
    // Wialon error 1 = invalid session/token, error 4 = token expired
    const isTokenExpired = err.message?.includes('kod 1') || err.message?.includes('kod 4')
    await (prisma as any).gpsCredential.update({
      where: { id: credentialId },
      data: {
        isActive: false,
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: isTokenExpired
          ? 'Token muddati tugagan. Qayta ulaning: Sozlamalar → GPS.'
          : err.message,
      },
    })
    throw new Error(isTokenExpired ? 'GPS token muddati tugagan, qayta ulaning' : err.message)
  }

  // ─── Avto token yangilash ───────────────────────────────────────────────────
  // Agar token muddati 10 kundan kam qolgan bo'lsa — yangi token olamiz.
  // Buning uchun parol kerak emas: joriy SID yetarli.
  // Foydalanuvchi hech qachon qayta login/parol kiritmasin.
  const expiresAt: Date | null = cred.tokenExpiresAt ? new Date(cred.tokenExpiresAt) : null
  const needsRenewal = !expiresAt || (expiresAt.getTime() - Date.now() < TOKEN_RENEW_THRESHOLD)

  if (needsRenewal) {
    try {
      const newToken = await createToken(cred.host, sid)
      await (prisma as any).gpsCredential.update({
        where: { id: credentialId },
        data: { token: newToken, tokenExpiresAt: tokenExpiresAt() },
      })
      console.log(`[GPS] Token yangilandi: orgId=${cred.orgId}`)
    } catch (renewErr: any) {
      // Token yangilash muvaffaqiyatsiz bo'lsa sync davom etadi (hali muddat tugamagan bo'lishi mumkin)
      console.error(`[GPS] Token yangilashda xato: ${renewErr.message}`)
    }
  }

  const units = await getUnits(cred.host, sid)

  // Build lookup map: unitName (trimmed, uppercase) → unit
  const unitMap = new Map<string, WialonUnit>()
  for (const u of units) {
    unitMap.set(u.nm.trim().toUpperCase(), u)
  }

  // Get all vehicles for this org (using orgId → find branches → vehicles)
  const orgBranches = await (prisma as any).branch.findMany({
    where: { OR: [{ id: cred.orgId }, { organizationId: cred.orgId }] },
    select: { id: true },
  })
  const branchIds = orgBranches.map((b: any) => b.id)

  const vehicles = await prisma.vehicle.findMany({
    where: { branchId: { in: branchIds }, status: 'active' },
    select: { id: true, registrationNumber: true, mileage: true, engineHours: true },
  })

  let synced = 0, skipped = 0
  const errors: string[] = []

  for (const vehicle of vehicles) {
    try {
      const regNum = vehicle.registrationNumber.trim().toUpperCase()
      const unit = unitMap.get(regNum)

      if (!unit) {
        // GPS da bu mashina topilmadi — skip (log emas, bu normal)
        skipped++
        continue
      }

      const gpsMc = unit.cnm?.mc ?? 0
      const gpsMileageKm = gpsMc / 1000
      const currentMileageKm = Number(vehicle.mileage)

      // cnm.ech = dvigatel soatlari (sekunda) → soat ga o'tkazish
      const gpsEch = unit.cnm?.ech ?? 0
      const gpsEngineHours = Math.round((gpsEch / 3600) * 10) / 10 // 0.1 soat aniqligi
      const currentEngineHours = Number(vehicle.engineHours ?? 0)

      // oxirgi GPS signal vaqti (unix timestamp → Date)
      const lastSignalTs = unit.lmsg?.t
      const lastGpsSignal = lastSignalTs ? new Date(lastSignalTs * 1000) : null

      // Signal bo'lmasa — GPS da bu mashina jonli emas, skip
      if (!lastGpsSignal && gpsMileageKm <= 0) {
        skipped++
        continue
      }

      // GPS 0 qaytarsa — signal yo'q yoki counter o'rnatilmagan, km skip
      if (gpsMileageKm <= 0) {
        // Signal vaqtini baribir saqlaymiz (mashina GPS da bor, faqat km counter yo'q)
        if (lastGpsSignal) {
          await prisma.vehicle.update({
            where: { id: vehicle.id },
            data: { lastGpsSignal },
          })
        }
        skipped++
        continue
      }

      // Mileage regression — GPS joriy km dan 10% kam ko'rsatsa, ishonmaymiz
      if (gpsMileageKm < currentMileageKm * 0.9) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const recentLog = await (prisma as any).gpsMileageLog.findFirst({
          where: { vehicleId: vehicle.id, skipped: true, syncedAt: { gte: oneDayAgo } },
          select: { id: true },
        })
        if (!recentLog) {
          await (prisma as any).gpsMileageLog.create({
            data: {
              vehicleId: vehicle.id,
              gpsMileageKm,
              prevMileageKm: currentMileageKm,
              skipped: true,
              skipReason: `GPS regressiya: GPS=${Math.round(gpsMileageKm)}km, DB=${Math.round(currentMileageKm)}km`,
            },
          })
        }
        // Signal vaqtini baribir saqlaymiz
        if (lastGpsSignal) await prisma.vehicle.update({ where: { id: vehicle.id }, data: { lastGpsSignal } })
        skipped++
        continue
      }

      // Km va dvigatel soatlarini yangilash
      const updateData: any = { lastGpsSignal }
      let mileageUpdated = false

      if (gpsMileageKm > currentMileageKm) {
        updateData.mileage = Math.round(gpsMileageKm)
        mileageUpdated = true
      }
      // Dvigatel soatlari — faqat o'ssa yangilaymiz (regression bo'lishi mumkin emas odatda)
      if (gpsEngineHours > currentEngineHours) {
        updateData.engineHours = gpsEngineHours
      }

      await prisma.vehicle.update({ where: { id: vehicle.id }, data: updateData })

      if (mileageUpdated) {
        await (prisma as any).gpsMileageLog.create({
          data: {
            vehicleId: vehicle.id,
            gpsMileageKm: Math.round(gpsMileageKm),
            prevMileageKm: currentMileageKm,
            skipped: false,
          },
        })
        synced++
      } else {
        skipped++
      }
    } catch (err: any) {
      errors.push(`${vehicle.registrationNumber}: ${err.message}`)
    }
  }

  await (prisma as any).gpsCredential.update({
    where: { id: credentialId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: errors.length === 0 ? 'ok' : 'error',
      lastSyncError: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
    },
  })

  return { synced, skipped, errors }
}

/**
 * Barcha faol GPS ulanishlari uchun sync (scheduler uchun).
 */
export async function syncAllGpsCredentials(): Promise<void> {
  const credentials = await (prisma as any).gpsCredential.findMany({
    where: { isActive: true },
  })
  for (const cred of credentials) {
    await syncOrgMileage(cred.id).catch(err => {
      console.error(`[GPS sync] orgId=${cred.orgId} xato:`, err.message)
      ;(prisma as any).gpsCredential.update({
        where: { id: cred.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncError: err.message },
      }).catch(() => {})
    })
  }
}
