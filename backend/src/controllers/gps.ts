import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getTokenFromCredentials, testConnection, syncOrgMileage } from '../services/wialonService'

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
// Body: { username, password, host? }
export async function connectGps(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Super admin uchun GPS sozlamalari org sahifasida boshqariladi', 403)

    const { username, password, host = 'http://2.smartgps.uz' } = req.body
    if (!username || !password) throw new AppError('Login va parol majburiy', 400)

    // Login/parol bilan token olamiz (parol DB ga saqlanmaydi)
    let token: string
    let expiresAt: Date
    try {
      const result = await getTokenFromCredentials(host, username, password)
      token = result.token
      expiresAt = result.expiresAt
    } catch (err: any) {
      throw new AppError(`GPS ulanishda xato: ${err.message}`, 400)
    }

    // Test: unit count (token ishlayotganini tasdiqlash)
    const { unitCount } = await testConnection(host, token)

    // Upsert: agar avval ulanish bo'lgan bo'lsa yangilaymiz
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
