import { prisma } from '../lib/prisma'

const UNIT_FLAGS = 0x1 | 0x100 | 0x400 // basic info + last message + counters
const TOKEN_DURATION = 7776000           // 90 days in seconds

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

async function wialonPost(host: string, svc: string, params: object, sid?: string): Promise<any> {
  const body = new URLSearchParams({ svc, params: JSON.stringify(params) })
  if (sid) body.set('sid', sid)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const resp = await fetch(`${host}/wialon/ajax.html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    })
    const data: any = await resp.json()
    if (data?.error) throw new Error(`Wialon xatosi (${svc}): kod ${data.error}`)
    return data
  } finally {
    clearTimeout(timer)
  }
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
    fl: 1,
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Foydalanuvchi login/parol kiritadi → token olib saqlaymiz.
 * Returns the token (for saving to DB).
 */
export async function getTokenFromCredentials(
  host: string,
  username: string,
  password: string,
): Promise<string> {
  const sid = await getSessionSid(host, username, password)
  const token = await createToken(host, sid)
  return token
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
 * Faqat registrationNumber bo'yicha mos mashinalarga mileage yangilanadi.
 * Fix 1: Mileage regression va nol qiymatlar o'tkazib yuboriladi.
 */
export async function syncOrgMileage(credentialId: string): Promise<{
  synced: number; skipped: number; errors: string[]
}> {
  const cred = await (prisma as any).gpsCredential.findUnique({ where: { id: credentialId } })
  if (!cred || !cred.isActive) throw new Error('GPS ulanishi topilmadi yoki faol emas')

  const sid = await loginWithToken(cred.host, cred.token)
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
    select: { id: true, registrationNumber: true, mileage: true },
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

      // Fix 1a: GPS 0 qaytarsa — signal yo'q, o'tkazib yubor
      if (gpsMileageKm <= 0) {
        await (prisma as any).gpsMileageLog.create({
          data: {
            vehicleId: vehicle.id,
            gpsMileageKm: 0,
            prevMileageKm: currentMileageKm,
            skipped: true,
            skipReason: 'GPS 0 qaytardi (signal yo\'q)',
          },
        })
        skipped++
        continue
      }

      // Fix 1b: Regression — GPS joriy km dan 10% kam ko'rsatsa, ishonmaymiz
      if (gpsMileageKm < currentMileageKm * 0.9) {
        await (prisma as any).gpsMileageLog.create({
          data: {
            vehicleId: vehicle.id,
            gpsMileageKm,
            prevMileageKm: currentMileageKm,
            skipped: true,
            skipReason: `GPS regressiya: GPS=${Math.round(gpsMileageKm)}km, DB=${Math.round(currentMileageKm)}km`,
          },
        })
        skipped++
        continue
      }

      // Faqat GPS kattaroq ko'rsatsa yangilaymiz
      if (gpsMileageKm > currentMileageKm) {
        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: { mileage: Math.round(gpsMileageKm) },
        })
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
        // GPS = DB: hech narsa o'zgarmadi
        skipped++
      }
    } catch (err: any) {
      errors.push(`${vehicle.registrationNumber}: ${err.message}`)
    }
  }

  // Sync natijasini saqlash
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
      // Xatoni saqlash
      ;(prisma as any).gpsCredential.update({
        where: { id: cred.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncError: err.message },
      }).catch(() => {})
    })
  }
}
