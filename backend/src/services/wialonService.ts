import https from 'https'
import http from 'http'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'

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

// Haversine formula: ikki GPS nuqta orasidagi masofani km da hisoblash
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// SmartGPS/Wialon serverlari SSL sertifikatida domain mismatch bo'lishi mumkin
// (2.smartgps.uz cert 2.wialon.uz ga berilgan). Shuning uchun rejectUnauthorized: false
// Tranzient tarmoq xatolari — bularda qayta urinamiz
const TRANSIENT_CODES = new Set(['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENOTFOUND'])

function wialonPostOnce(host: string, svc: string, params: object, sid?: string): Promise<any> {
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
          if (data?.error) reject(new AppError(`GPS (Wialon) serveridan xato qaytdi (${svc}): kod ${data.error}. Tokenni qayta ulang.`, 503))
          else resolve(data)
        } catch {
          reject(new AppError(`GPS (Wialon) javobi tushunarsiz (${svc})`, 502))
        }
      })
    })
    req.on('error', (e: NodeJS.ErrnoException) => {
      const err = new AppError(`GPS serveriga ulanib bo'lmadi: ${e.message}`, 503) as AppError & { code?: string }
      err.code = e.code
      reject(err)
    })
    req.on('timeout', () => {
      req.destroy()
      const err = new AppError(`GPS serveri javob bermayapti (${svc})`, 504) as AppError & { code?: string }
      err.code = 'ETIMEDOUT'
      reject(err)
    })
    req.write(bodyStr)
    req.end()
  })
}

// Retry wrapper: tranzient tarmoq xatolari (DNS/timeout) da 2 marta qayta urinadi.
// Application xatolari (Wialon kod 1/4/8 va hokazo) — qayta urinilmaydi.
async function wialonPost(host: string, svc: string, params: object, sid?: string): Promise<any> {
  const MAX_ATTEMPTS = 3
  let lastErr: any
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await wialonPostOnce(host, svc, params, sid)
    } catch (e: any) {
      lastErr = e
      const code = e?.code
      if (!code || !TRANSIENT_CODES.has(code) || attempt === MAX_ATTEMPTS) throw e
      const backoff = 500 * attempt // 500ms, 1000ms
      console.warn(`[Wialon] ${svc} tarmoq xatosi (${code}), ${backoff}ms kutib qayta urinamiz (${attempt}/${MAX_ATTEMPTS - 1})`)
      await new Promise(r => setTimeout(r, backoff))
    }
  }
  throw lastErr
}

async function getSessionSid(host: string, username: string, password: string): Promise<string> {
  const data = await wialonPost(host, 'core/login', { user: username, password, fl: 0 })
  if (!data.eid) throw new AppError('Login muvaffaqiyatsiz: sessiya ID olinmadi', 401)
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
  if (!data.h) throw new AppError(`Token yaratib bo'lmadi: ${JSON.stringify(data)}`, 502)
  return data.h
}

async function loginWithToken(host: string, token: string): Promise<string> {
  const data = await wialonPost(host, 'token/login', { token, fl: 1 })
  if (!data.eid) throw new AppError('Token login muvaffaqiyatsiz', 401)
  return data.eid
}

// Wialon messages/load_interval orqali davr ichida yurgan km ni hisoblash.
// cnm.mc = 0 bo'lgan holat uchun (hisoblagich sozlanmagan) alternativ usul.
async function getIntervalMileageKm(host: string, sid: string, unitId: number, fromTs: number, toTs: number): Promise<number> {
  try {
    const data = await wialonPost(host, 'messages/load_interval', {
      itemId: unitId,
      timeFrom: fromTs,
      timeTo: toTs,
      flags: 0x1,         // GPS pozitsiya ma'lumotlari
      flagsMask: 0,
      loadCount: 32768,   // Wialon max
    }, sid)

    const messages: Array<{ t: number; pos?: { y: number; x: number } }> = data.messages || []
    if (messages.length < 2) return 0

    let totalKm = 0
    let prev: { y: number; x: number } | null = null
    for (const msg of messages) {
      if (!msg.pos) continue
      if (prev) {
        const d = haversineKm(prev.y, prev.x, msg.pos.y, msg.pos.x)
        if (d < 50) totalKm += d  // 50km dan katta sakrash = GPS artefakt, o'tkazib yuboramiz
      }
      prev = { y: msg.pos.y, x: msg.pos.x }
    }
    return Math.round(totalKm * 10) / 10
  } catch {
    return 0  // Messages API ishlamasa — 0 qaytaramiz, sync o'tadi
  }
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
 * Berilgan mashina uchun aniq davr ichida yurgan km ni Wialon messages API orqali hisoblaydi.
 * cnm.mc counter kerak emas — GPS trek nuqtalaridan Haversine formula bilan hisoblanadi.
 */
export async function getVehicleIntervalKm(
  credentialId: string,
  lookupKey: string,
  fromDate: Date,
  toDate: Date,
): Promise<{ km: number; unitFound: boolean }> {
  try {
    const cred = await (prisma as any).gpsCredential.findUnique({ where: { id: credentialId } })
    if (!cred || !cred.isActive) return { km: 0, unitFound: false }

    const sid = await loginWithToken(cred.host, cred.token)
    const units = await getUnits(cred.host, sid)
    const unit = units.find(u => u.nm.trim().toUpperCase() === lookupKey.trim().toUpperCase())
    if (!unit) return { km: 0, unitFound: false }

    const fromTs = Math.floor(fromDate.getTime() / 1000)
    const toTs = Math.floor(toDate.getTime() / 1000)
    const km = await getIntervalMileageKm(cred.host, sid, unit.id, fromTs, toTs)
    return { km, unitFound: true }
  } catch {
    return { km: 0, unitFound: false }
  }
}

/**
 * GPS unitlar ro'yxatini qaytaradi (mapping sahifasi uchun).
 */
export async function getGpsUnitsForCred(credentialId: string): Promise<{
  id: number; name: string; mileageKm: number; engineHours: number; lastSignal: Date | null
}[]> {
  const cred = await (prisma as any).gpsCredential.findUnique({ where: { id: credentialId } })
  if (!cred || !cred.isActive) throw new AppError('GPS ulanishi topilmadi yoki faol emas', 404)
  const sid = await loginWithToken(cred.host, cred.token)
  const units = await getUnits(cred.host, sid)
  return units.map(u => ({
    id: u.id,
    name: u.nm,
    mileageKm: Math.round((u.cnm?.mc ?? 0) / 1000),
    engineHours: Math.round(((u.cnm?.ech ?? 0) / 3600) * 10) / 10,
    lastSignal: u.lmsg?.t ? new Date(u.lmsg.t * 1000) : null,
  }))
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
  if (!cred || !cred.isActive) throw new AppError('GPS ulanishi topilmadi yoki faol emas', 404)

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
    throw new AppError(isTokenExpired ? 'GPS token muddati tugagan, qayta ulaning' : err.message, 503)
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
    select: { id: true, registrationNumber: true, gpsUnitName: true, mileage: true, engineHours: true },
  })

  let synced = 0, skipped = 0
  const errors: string[] = []

  for (const vehicle of vehicles) {
    try {
      // gpsUnitName qo'lda sozlangan bo'lsa uni ishlatamiz, aks holda registrationNumber
      const lookupKey = (vehicle.gpsUnitName || vehicle.registrationNumber).trim().toUpperCase()
      const unit = unitMap.get(lookupKey)

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

      // GPS 0 qaytarsa — counter sozlanmagan. messages/load_interval bilan davr masofasini hisoblaymiz.
      if (gpsMileageKm <= 0) {
        if (lastGpsSignal) {
          await prisma.vehicle.update({ where: { id: vehicle.id }, data: { lastGpsSignal } })
        }

        // Oxirgi muvaffaqiyatli log dan beri qancha vaqt o'tganini aniqlaymiz
        const lastSuccessLog = await (prisma as any).gpsMileageLog.findFirst({
          where: { vehicleId: vehicle.id, skipped: false },
          orderBy: { syncedAt: 'desc' },
          select: { gpsMileageKm: true, syncedAt: true },
        })
        const fromTs = lastSuccessLog
          ? Math.floor(new Date(lastSuccessLog.syncedAt).getTime() / 1000)
          : Math.floor((Date.now() - 6 * 3600 * 1000) / 1000)
        const toTs = Math.floor(Date.now() / 1000)

        // GPS xabarlari asosida davr masofasini hisoblaymiz
        const intervalKm = await getIntervalMileageKm(cred.host, sid, unit.id, fromTs, toTs)

        if (intervalKm > 0) {
          // Qo'lda kiritilgan yoki avvalgi log qiymatidan kattasini asos sifatida olamiz.
          // Bu foydalanuvchi vehicle.mileage ni qo'lda yangilasa, keyingi sync eski log
          // qiymatiga qaytib yozmasligi uchun kerak.
          const logKm = lastSuccessLog ? lastSuccessLog.gpsMileageKm : 0
          const prevCumulativeKm = Math.max(logKm, currentMileageKm)
          const newCumulativeKm = Math.round(prevCumulativeKm + intervalKm)

          await prisma.vehicle.update({
            where: { id: vehicle.id },
            data: { mileage: newCumulativeKm, lastGpsSignal },
          })
          await (prisma as any).gpsMileageLog.create({
            data: {
              vehicleId: vehicle.id,
              gpsMileageKm: newCumulativeKm,
              prevMileageKm: prevCumulativeKm,
              skipped: false,
            },
          })
          // Motor yog'i statusini yangilash
          const oilInterval = await prisma.serviceInterval.findUnique({
            where: { vehicleId_serviceType: { vehicleId: vehicle.id, serviceType: 'oil_change' } },
          })
          if (oilInterval?.nextDueKm != null) {
            let oilStatus: 'ok' | 'due_soon' | 'overdue' = 'ok'
            if (newCumulativeKm >= oilInterval.nextDueKm) oilStatus = 'overdue'
            else if (newCumulativeKm >= oilInterval.nextDueKm - oilInterval.warningKm) oilStatus = 'due_soon'
            if (oilStatus !== oilInterval.status) {
              await prisma.serviceInterval.update({ where: { id: oilInterval.id }, data: { status: oilStatus } })
            }
          }
          synced++
        } else {
          // Mashina bu davrda yurmagandir — signal vaqtini saqlab, skip
          skipped++
        }
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
        // Motor yog'i status ni yangilash
        const newKm = Math.round(gpsMileageKm)
        const oilInterval = await prisma.serviceInterval.findUnique({
          where: { vehicleId_serviceType: { vehicleId: vehicle.id, serviceType: 'oil_change' } },
        })
        if (oilInterval?.nextDueKm != null) {
          let oilStatus: 'ok' | 'due_soon' | 'overdue' = 'ok'
          if (newKm >= oilInterval.nextDueKm) oilStatus = 'overdue'
          else if (newKm >= oilInterval.nextDueKm - oilInterval.warningKm) oilStatus = 'due_soon'
          if (oilStatus !== oilInterval.status) {
            await prisma.serviceInterval.update({ where: { id: oilInterval.id }, data: { status: oilStatus } })
          }
        }
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

// Wialon ABGR int → CSS hex color
function wialonColorToHex(c: number): string {
  const r = (c & 0xFF).toString(16).padStart(2, '0')
  const g = ((c >> 8) & 0xFF).toString(16).padStart(2, '0')
  const b = ((c >> 16) & 0xFF).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export interface WialonGeozone {
  id: number
  name: string
  color: string
  points: Array<{ lat: number; lon: number }>
}

/**
 * resource/get_zone_data orqali bir resurs uchun barcha zona nuqtalarini oladi.
 * Wialon SDK ishlatadigan to'g'ri servis (get_zone_by_id emas).
 * t=1: doira, t=2: polygon, t=3: chiziq
 */
async function fetchZoneData(host: string, sid: string, resourceId: number, zoneIds: number[]): Promise<any[]> {
  const BATCH = 50
  const results: any[] = []
  for (let i = 0; i < zoneIds.length; i += BATCH) {
    try {
      const data = await wialonPost(host, 'resource/get_zone_data', {
        itemId: resourceId,
        col: zoneIds.slice(i, i + BATCH),
        flags: 0,
      }, sid)
      const items: any[] = Array.isArray(data) ? data : Object.values(data || {})
      results.push(...items)
    } catch (e: any) {
      console.warn(`[Geozones] get_zone_data batch ${i}: ${e.message}`)
    }
  }
  return results
}

/**
 * GPS tizimidagi barcha faol ulanishlardan geozonaları (polygon tip) oladi.
 * resource/get_zone_data (SDK ishlatadigan servis) orqali polygon nuqtalarini olamiz.
 * orgId berilsa — faqat shu tashkilotning credlari ishlatiladi.
 */
export async function getWialonGeozones(orgId?: string | null): Promise<WialonGeozone[]> {
  const creds = await (prisma as any).gpsCredential.findMany({
    where: { isActive: true, ...(orgId && { orgId }) },
    select: { id: true, host: true, token: true },
  })

  const allZones: WialonGeozone[] = []

  for (const cred of creds) {
    try {
      const sid = await loginWithToken(cred.host, cred.token)

      const data = await wialonPost(cred.host, 'core/search_items', {
        spec: { itemsType: 'avl_resource', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
        force: 1,
        flags: 0xFFFFFFFF,
        from: 0,
        to: 0,
      }, sid)

      for (const resource of (data.items || []) as any[]) {
        const zl = resource.zl || {}
        const zoneIds = Object.values(zl).map((z: any) => Number(z.id))
        if (zoneIds.length === 0) continue

        const zones = await fetchZoneData(cred.host, sid, resource.id, zoneIds)

        for (const zone of zones) {
          if (!zone || zone.t !== 2) continue // t=2 polygon
          const pts: any[] = zone.p || []
          const points = pts
            .filter((p: any) => typeof p.x === 'number' && typeof p.y === 'number')
            .map((p: any) => ({ lat: p.y, lon: p.x }))
          if (points.length < 3) continue
          allZones.push({
            id: zone.id,
            name: zone.n || `Geozona ${zone.id}`,
            color: zone.c != null ? wialonColorToHex(zone.c) : '#6366f1',
            points,
          })
        }
      }
    } catch (e: any) {
      console.warn(`[Geozones] cred=${cred.id}: ${e.message}`)
    }
  }

  return allZones
}

/**
 * SmartGPS dagi barcha polygon geozonaları bo'yicha MFY chegaralarini yangilaydi.
 * Lookup: avval gpsZoneName (qo'lda moslashtirilgan), bo'lmasa name bo'yicha (case-insensitive).
 * Topilmagan zona nomlari ham qaytariladi — frontend ularni qo'lda moslashtirishi uchun.
 * orgId — multi-tenant izolyatsiya: faqat shu tashkilotning credlari va MFYlari ishlatiladi.
 */
export async function syncMfyPolygonsFromGps(orgId?: string | null): Promise<{
  updated: number
  notFound: number
  total: number
  unmatchedZones: Array<{ name: string; points: number }>
}> {
  const creds = await (prisma as any).gpsCredential.findMany({
    where: { isActive: true, ...(orgId && { orgId }) },
    select: { id: true, host: true, token: true },
  })

  // Faqat shu tashkilotning MFYlarini yuklab, lookup map quramiz (gpsZoneName + name)
  const mfys = await (prisma as any).thMfy.findMany({
    where: orgId ? { organizationId: orgId } : {},
    select: { id: true, name: true, gpsZoneName: true },
  })
  const mfyByKey = new Map<string, string>()
  for (const m of mfys) {
    if (m.gpsZoneName?.trim()) mfyByKey.set(m.gpsZoneName.trim().toLowerCase(), m.id)
    mfyByKey.set(m.name.trim().toLowerCase(), m.id)
  }

  let updated = 0, notFound = 0, total = 0
  const unmatchedZones: Array<{ name: string; points: number }> = []

  for (const cred of creds) {
    const sid = await loginWithToken(cred.host, cred.token)

    const data = await wialonPost(cred.host, 'core/search_items', {
      spec: { itemsType: 'avl_resource', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
      force: 1,
      flags: 0xFFFFFFFF,
      from: 0,
      to: 0,
    }, sid)

    for (const resource of (data.items || []) as any[]) {
      const zl = resource.zl || {}
      const zoneIds = Object.values(zl).map((z: any) => Number(z.id))
      if (zoneIds.length === 0) continue

      const zones = await fetchZoneData(cred.host, sid, resource.id, zoneIds)

      for (const zone of zones) {
        if (!zone || zone.t !== 2) continue // faqat polygon
        const pts: any[] = zone.p || []
        if (pts.length < 3) continue

        total++
        const zoneName = (zone.n as string).trim()
        const mfyId = mfyByKey.get(zoneName.toLowerCase())

        if (!mfyId) {
          notFound++
          unmatchedZones.push({ name: zoneName, points: pts.length })
          continue
        }

        const coords = pts.map((p: any) => [p.x, p.y])
        if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
          coords.push(coords[0])
        }
        const polygon = {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: { name: zoneName },
        }

        await (prisma as any).thMfy.update({
          where: { id: mfyId },
          data: { polygon },
        })
        updated++
      }
    }
  }

  // Unmatched ro'yxatini tartibga solamiz va birinchi 200 tasini qaytaramiz
  unmatchedZones.sort((a, b) => a.name.localeCompare(b.name))
  return { updated, notFound, total, unmatchedZones: unmatchedZones.slice(0, 200) }
}

/**
 * Mashina uchun berilgan vaqt oralig'idagi GPS trek nuqtalarini qaytaradi.
 * ThMonitor service uchun ishlatiladi.
 */
export async function getVehicleTrackPoints(
  credentialId: string,
  lookupKey: string,
  fromTs: number,
  toTs: number,
): Promise<Array<{ lat: number; lon: number; speed: number; ts: number }>> {
  try {
    const cred = await (prisma as any).gpsCredential.findUnique({ where: { id: credentialId } })
    if (!cred || !cred.isActive) return []

    const sid = await loginWithToken(cred.host, cred.token)
    const units = await getUnits(cred.host, sid)
    const unit = units.find(u => u.nm.trim().toUpperCase() === lookupKey.trim().toUpperCase())
    if (!unit) return []

    const data = await wialonPost(cred.host, 'messages/load_interval', {
      itemId: unit.id,
      timeFrom: fromTs,
      timeTo: toTs,
      flags: 0x1,
      flagsMask: 0,
      loadCount: 32768,
    }, sid)

    const messages: Array<{ t: number; pos?: { y: number; x: number; sc: number } }> = data.messages || []
    return messages
      .filter(m => m.pos)
      .map(m => ({
        lat: m.pos!.y,
        lon: m.pos!.x,
        speed: m.pos!.sc ?? 0,
        ts: m.t,
      }))
  } catch {
    return []
  }
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
