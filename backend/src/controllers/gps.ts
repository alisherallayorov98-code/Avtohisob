import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getTokenFromCredentials, testConnection, syncOrgMileage, getGpsUnitsForCred } from '../services/wialonService'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

// Foydalanuvchining org ID ini topamiz (branch.organizationId ?? branch.id)
// super_admin uchun null qaytadi — GPS faqat org admin/manager tomonidan o'rnatiladi
async function resolveOrgId(user: NonNullable<AuthRequest['user']>): Promise<string | null> {
  if (user.role === 'super_admin') return null
  if (!user.branchId) return null

  const branch = await (prisma as any).branch.findUnique({
    where: { id: user.branchId },
    select: { organizationId: true },
  })
  return branch?.organizationId ?? user.branchId
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

    const cred = await (prisma as any).gpsCredential.upsert({
      where: { orgId },
      create: { orgId, provider: 'smartgps', host, username, token, tokenExpiresAt: expiresAt, isActive: true },
      update: { host, username, token, tokenExpiresAt: expiresAt, isActive: true, lastSyncError: null },
      select: {
        id: true, provider: true, host: true, username: true,
        isActive: true, tokenExpiresAt: true, lastSyncAt: true, createdAt: true,
      },
    })

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
