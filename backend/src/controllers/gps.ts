import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getTokenFromCredentials, testConnection, syncOrgMileage, getGpsUnitsForCred, renewTokenFromToken } from '../services/wialonService'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../lib/orgFilter'
import { encryptSecret } from '../lib/secretCrypto'
import { startOrgBackfill, getBackfillProgress } from '../lib/gpsDailyKmFill'

// SSRF himoyasi: GPS host faqat ishonchli provayderlarga (SmartGPS / Wialon)
// yo'naltirilishi kerak. Aks holda foydalanuvchi internal endpoint (masalan
// 169.254.169.254 metadata, localhost:5432, va h.k.) ga so'rov yuborishi mumkin.
const ALLOWED_GPS_HOSTS = [
  /^https?:\/\/([a-z0-9-]+\.)*smartgps\.uz(:\d+)?$/i,
  /^https?:\/\/([a-z0-9-]+\.)*wialon\.uz(:\d+)?$/i,
  /^https?:\/\/([a-z0-9-]+\.)*wialon\.com(:\d+)?$/i,
  /^https?:\/\/([a-z0-9-]+\.)*wialon\.host(:\d+)?$/i,
]

function validateGpsHost(host: string): void {
  if (typeof host !== 'string' || host.length > 200) {
    throw new AppError('GPS server manzili noto\'g\'ri', 400)
  }
  // Trailing slash, path va boshqa shubhali qismlarni kesib tashlash
  let normalized = host.trim()
  try {
    const u = new URL(normalized)
    // Faqat origin (protocol + host + port) — path/query/fragment qabul qilinmaydi
    normalized = `${u.protocol}//${u.host}`
  } catch {
    throw new AppError('GPS server manzili URL formatida bo\'lishi kerak', 400)
  }
  const ok = ALLOWED_GPS_HOSTS.some(rx => rx.test(normalized))
  if (!ok) {
    throw new AppError(
      'Faqat SmartGPS yoki Wialon serverlari ruxsat etilgan (smartgps.uz, wialon.uz, wialon.com, wialon.host)',
      400,
    )
  }
}

// GET /gps/status
export async function getGpsStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) return res.json({ success: true, data: null })

    const cred = await (prisma as any).gpsCredential.findUnique({
      where: { orgId },
      select: {
        id: true, provider: true, host: true, username: true,
        isActive: true, tokenExpiresAt: true,
        lastSyncAt: true, lastSyncStatus: true, lastSyncError: true,
        createdAt: true,
      },
    })
    res.json({ success: true, data: cred || null })
  } catch (err) { next(err) }
}

// POST /gps/connect
// Body: { username, host?, password? } OR { username, token, host? } (token mode)
export async function connectGps(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Super admin uchun GPS sozlamalari org sahifasida boshqariladi', 403)

    const { username, password, token: directToken, host = 'http://2.smartgps.uz' } = req.body
    if (!username) throw new AppError('Login (username) majburiy', 400)
    validateGpsHost(host)

    let token: string
    let expiresAt: Date

    if (directToken) {
      // Token to'g'ridan berilgan — login/parol kerak emas
      token = directToken.trim()
      // Token muddatini bilmaymiz — null qoladi (avto yangilanmaydi, lekin ishlaydi)
      expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // taxminan 90 kun
    } else {
      if (!password) throw new AppError('Parol yoki token majburiy', 400)
      try {
        const result = await getTokenFromCredentials(host, username, password)
        token = result.token
        expiresAt = result.expiresAt
      } catch (err: any) {
        const msg = err.message || ''
        let friendly = msg
        if (msg.includes('kod 7')) friendly = 'Kirish rad etildi (kod 7). SmartGPS da ushbu akkaunt uchun API kirish yoqilmagan. Asosiy admin akkauntini ishlating.'
        else if (msg.includes('kod 8')) friendly = 'Login yoki parol noto\'g\'ri (kod 8). SmartGPS dagi haqiqiy login/parolni kiriting.'
        else if (msg.includes('kod 4')) friendly = 'Noto\'g\'ri ma\'lumot (kod 4). Server manzilini tekshiring.'
        throw new AppError(`GPS ulanishda xato: ${friendly}`, 400)
      }
    }

    // Token ishlayotganini tekshirish
    let unitCount = 0
    try {
      const result = await testConnection(host, token)
      unitCount = result.unitCount
    } catch (err: any) {
      throw new AppError(`Token yaroqsiz: ${err.message}. SmartGPS dan yangi token oling.`, 400)
    }

    // Qo'lda joylangan token bo'lsa — uni BIZ boshqaradigan aniq 90-kunlik tokenga
    // aylantiramiz. Aks holda muddat "taxminan" qoladi va avto-yangilash o'z vaqtida
    // ishlamay token kutilmaganda o'lishi mumkin (uzilishning asosiy sababi).
    if (directToken) {
      const renewed = await renewTokenFromToken(host, token)
      if (renewed) {
        token = renewed.token
        expiresAt = renewed.expiresAt
      }
    }

    // Ixtiyoriy: parol berilgan bo'lsa shifrlab saqlaymiz — token to'liq o'lsa avto re-login uchun.
    // Berilmasa avvalgi saqlangan parolga tegmaymiz (undefined).
    const encryptedPassword = password ? encryptSecret(String(password)) : undefined

    const cred = await (prisma as any).gpsCredential.upsert({
      where: { orgId },
      create: { orgId, provider: 'smartgps', host, username, token, tokenExpiresAt: expiresAt, isActive: true, ...(encryptedPassword && { password: encryptedPassword }) },
      update: { host, username, token, tokenExpiresAt: expiresAt, isActive: true, lastSyncError: null, ...(encryptedPassword && { password: encryptedPassword }) },
      select: {
        id: true, provider: true, host: true, username: true,
        isActive: true, tokenExpiresAt: true, lastSyncAt: true, createdAt: true,
      },
    })

    // Token ulangan zahoti to'liq sync'ni fonda ishga tushiramiz — cron (har 2 soat)
    // kutilmaydi. Bu mileage baseline'ini darhol o'rnatadi va token uzilib qayta
    // ulanganda yo'qolgan masofani (gap) chunked hisob orqali to'liq tiklaydi.
    // Fonda ishlaydi — connect javobi tez qaytadi (100 mashina sync uzoq cho'zilishi mumkin).
    syncOrgMileage(cred.id).catch((e: any) =>
      console.error(`[GPS] connect-after sync xato orgId=${orgId}:`, e?.message)
    )

    res.json({ success: true, data: cred, meta: { unitCount } })
  } catch (err) { next(err) }
}

// POST /gps/sync
export async function triggerGpsSync(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)

    const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
    if (!cred) throw new AppError('GPS ulanishi topilmadi. Avval ulaning.', 404)

    const result = await syncOrgMileage(cred.id)
    res.json({ success: true, data: result })
  } catch (err) { next(err) }
}

// DELETE /gps/disconnect
export async function disconnectGps(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)

    const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
    if (!cred) throw new AppError('GPS ulanishi topilmadi', 404)

    await (prisma as any).gpsCredential.delete({ where: { orgId } })
    res.json({ success: true, message: 'GPS ulanishi o\'chirildi' })
  } catch (err) { next(err) }
}

// POST /gps/backfill-daily-km — 6 oylik GPS kunlik masofani FONDA tortishni boshlaydi.
// Bir martalik: tortilgan haftalar qayta tortilmaydi (coverage), bor kunlar ikki marta
// yozilmaydi. So'rov tez qaytadi; jarayon haftalik bo'laklarda 0→100% boradi.
export async function backfillDailyKm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)

    const { started, progress } = await startOrgBackfill(orgId)
    res.json({
      success: true,
      data: progress,
      message: started
        ? 'GPS masofa fonda yuklanmoqda'
        : progress.status === 'done'
          ? 'Hammasi allaqachon yuklab olingan'
          : 'Yuklash allaqachon ketmoqda',
    })
  } catch (err) { next(err) }
}

// GET /gps/backfill-status — backfill progressi (status, total, done, percent)
export async function getBackfillStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)
    const progress = await getBackfillProgress(orgId)
    res.json({ success: true, data: progress })
  } catch (err) { next(err) }
}

// GET /gps/units-mapping — GPS unitlar + bizning mashinalar + matching holati
export async function getUnitsMapping(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)

    const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
    if (!cred) throw new AppError('GPS ulanishi topilmadi', 404)

    // GPS unitlar
    const gpsUnits = await getGpsUnitsForCred(cred.id)

    // Bizning mashinalar (org ga tegishli barcha branchlar)
    const orgBranches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    })
    const branchIds = orgBranches.map((b: any) => b.id)

    const vehicles = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true, registrationNumber: true, brand: true, model: true, gpsUnitName: true, lastGpsSignal: true, mileage: true, branchId: true, branch: { select: { name: true } } },
      orderBy: { registrationNumber: 'asc' },
    })

    // GPS unit nomlarini set ga olish (tez qidirish uchun)
    const unitNameSet = new Set(gpsUnits.map(u => u.name.trim().toUpperCase()))

    // Har bir mashinaning GPS holati
    const vehiclesWithStatus = vehicles.map(v => {
      const lookupKey = (v.gpsUnitName || v.registrationNumber).trim().toUpperCase()
      const matched = unitNameSet.has(lookupKey)
      return { ...v, gpsMatched: matched, effectiveLookup: lookupKey }
    })

    res.json({ success: true, data: { gpsUnits, vehicles: vehiclesWithStatus } })
  } catch (err) { next(err) }
}

// POST /gps/set-unit-mapping — mashina uchun GPS unit nomini bog'lash
export async function setVehicleGpsUnit(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)

    const { vehicleId, gpsUnitName } = req.body
    if (!vehicleId) throw new AppError('vehicleId majburiy', 400)

    // Mashina bu orgga tegishli ekanini tekshirish
    const orgBranches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    })
    const branchIds = orgBranches.map((b: any) => b.id)

    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, branchId: { in: branchIds } } })
    if (!vehicle) throw new AppError('Mashina topilmadi', 404)

    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { gpsUnitName: gpsUnitName || null },
    })

    res.json({ success: true, message: 'GPS bog\'lash saqlandi' })
  } catch (err) { next(err) }
}

// POST /gps/auto-match — bog'lanmagan mashinalarni GPS unitlarga AVTOMATIK bog'lash.
// Eng katta ishqalanish: unit nomi "01685YKA", davlat raqami "01 685 YKA" — probel/belgi
// farqi tufayli aniq taqqoslash "bog'lanmagan" deb ko'rsatadi. Bu yerda normallashtirib
// (faqat harf+raqam) AYNAN mos kelganlarni biriktiramiz — noto'g'ri bog'lash bo'lmaydi.
export async function autoMatchUnits(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Org aniqlanmadi', 400)
    const cred = await (prisma as any).gpsCredential.findUnique({ where: { orgId } })
    if (!cred) throw new AppError('GPS ulanishi topilmadi', 404)

    const gpsUnits = await getGpsUnitsForCred(cred.id)
    const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const unitByNorm = new Map<string, string>() // normallashtirilgan → asl unit nomi
    for (const u of gpsUnits) {
      const n = norm(u.name)
      if (n && !unitByNorm.has(n)) unitByNorm.set(n, u.name)
    }

    const orgBranches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    })
    const branchIds = orgBranches.map((b: any) => b.id)
    const vehicles = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true, registrationNumber: true, gpsUnitName: true },
    })

    let linked = 0
    const details: Array<{ registrationNumber: string; unit: string }> = []
    for (const v of vehicles) {
      // Allaqachon haqiqiy unitga bog'langan bo'lsa — tegmaymiz
      if (v.gpsUnitName && unitByNorm.has(norm(v.gpsUnitName))) continue
      // Davlat raqami bo'yicha normallashtirilgan aniq moslik
      const match = unitByNorm.get(norm(v.registrationNumber))
      if (match && match !== v.gpsUnitName) {
        await prisma.vehicle.update({ where: { id: v.id }, data: { gpsUnitName: match } })
        linked++
        details.push({ registrationNumber: v.registrationNumber, unit: match })
      }
    }
    res.json({ success: true, data: { linked, details } })
  } catch (err) { next(err) }
}
