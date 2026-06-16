import { Response, NextFunction } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { resolveOrgId, getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'
import { getCareBotUsername, sendCareMessage } from '../services/careBot'
import { ensureSubmissionsForVehicle } from '../services/careScheduler'

const SCOPES = ['all', 'branch', 'vehicles']

function cleanWeekdays(raw: any): number[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
}

/** GET /vehicle-care-tasks — tashkilotning barcha texnik parvarish vazifalari */
export async function listCareTasks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) { res.json(successResponse([])); return }
    const tasks = await (prisma as any).vehicleCareTask.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(successResponse(tasks))
  } catch (err) { next(err) }
}

/** POST /vehicle-care-tasks — yangi vazifa */
export async function createCareTask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)

    const { name, description, weekdays, scope, branchId, vehicleIds, triggerType, intervalKm } = req.body
    if (!name || !String(name).trim()) throw new AppError('Vazifa nomi talab qilinadi', 400)
    const tType = triggerType === 'mileage' ? 'mileage' : 'weekly'
    let days: number[] = []
    let interval: number | null = null
    if (tType === 'mileage') {
      interval = Math.round(Number(intervalKm))
      if (!Number.isFinite(interval) || interval <= 0) throw new AppError('Kilometr oralig\'ini kiriting (masalan 5000)', 400)
    } else {
      days = cleanWeekdays(weekdays)
      if (days.length === 0) throw new AppError('Kamida bitta kun tanlang', 400)
    }
    const sc = SCOPES.includes(scope) ? scope : 'all'

    const task = await (prisma as any).vehicleCareTask.create({
      data: {
        organizationId: orgId,
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        triggerType: tType,
        weekdays: days,
        intervalKm: interval,
        scope: sc,
        branchId: sc === 'branch' ? (branchId || null) : null,
        vehicleIds: sc === 'vehicles' && Array.isArray(vehicleIds) ? vehicleIds : [],
        createdById: req.user!.id,
      },
    })
    res.status(201).json(successResponse(task, 'Vazifa yaratildi'))
  } catch (err) { next(err) }
}

/** PUT /vehicle-care-tasks/:id — tahrirlash */
export async function updateCareTask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id } = req.params
    const existing = await (prisma as any).vehicleCareTask.findUnique({ where: { id } })
    if (!existing || existing.organizationId !== orgId) throw new AppError('Vazifa topilmadi', 404)

    const { name, description, weekdays, scope, branchId, vehicleIds, isActive, triggerType, intervalKm } = req.body
    const data: any = {}
    if (name !== undefined) data.name = String(name).trim()
    if (description !== undefined) data.description = description ? String(description).trim() : null
    if (triggerType !== undefined) data.triggerType = triggerType === 'mileage' ? 'mileage' : 'weekly'
    const effType = data.triggerType ?? existing.triggerType
    if (effType === 'mileage') {
      if (intervalKm !== undefined) {
        const interval = Math.round(Number(intervalKm))
        if (!Number.isFinite(interval) || interval <= 0) throw new AppError('Kilometr oralig\'ini kiriting', 400)
        data.intervalKm = interval
      }
      // mileage'ga o'tganda haftakunlarni tozalaymiz
      if (data.triggerType === 'mileage') data.weekdays = []
    } else if (weekdays !== undefined) {
      const days = cleanWeekdays(weekdays)
      if (days.length === 0) throw new AppError('Kamida bitta kun tanlang', 400)
      data.weekdays = days
    }
    if (scope !== undefined) {
      const sc = SCOPES.includes(scope) ? scope : 'all'
      data.scope = sc
      data.branchId = sc === 'branch' ? (branchId || null) : null
      data.vehicleIds = sc === 'vehicles' && Array.isArray(vehicleIds) ? vehicleIds : []
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive)

    const task = await (prisma as any).vehicleCareTask.update({ where: { id }, data })
    res.json(successResponse(task, 'Yangilandi'))
  } catch (err) { next(err) }
}

/** DELETE /vehicle-care-tasks/:id */
export async function deleteCareTask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id } = req.params
    const existing = await (prisma as any).vehicleCareTask.findUnique({ where: { id } })
    if (!existing || existing.organizationId !== orgId) throw new AppError('Vazifa topilmadi', 404)
    await (prisma as any).vehicleCareTask.delete({ where: { id } })
    res.json(successResponse(null, 'O\'chirildi'))
  } catch (err) { next(err) }
}

// ── Haydovchi bog'lanishi (Telegram) ─────────────────────────────────────────

// Mashina foydalanuvchi org'iga tegishlimi tekshiradi
async function assertVehicleOrg(vehicleId: string, orgId: string | null) {
  const vehicle = await (prisma as any).vehicle.findUnique({
    where: { id: vehicleId },
    include: { branch: { select: { organizationId: true } } },
  })
  if (!vehicle || (orgId && vehicle.branch.organizationId !== orgId)) {
    throw new AppError('Mashina topilmadi', 404)
  }
  return vehicle
}

/** POST /vehicle-care-tasks/driver-token { vehicleId } — haydovchi ulanish tokeni */
export async function generateCareDriverToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { vehicleId } = req.body
    if (!vehicleId) throw new AppError('vehicleId talab qilinadi', 400)
    const vehicle = await assertVehicleOrg(vehicleId, orgId)
    // Filial muhandisi faqat o'z filiali mashinasiga bot biriktira oladi
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) throw new AppError('Bu mashina sizning filialingizga tegishli emas', 403)

    await (prisma as any).vehicleCareLinkToken.deleteMany({ where: { vehicleId } })
    const token = crypto.randomBytes(3).toString('hex').toUpperCase()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 kun
    await (prisma as any).vehicleCareLinkToken.create({ data: { token, vehicleId, expiresAt } })

    const botUsername = getCareBotUsername()
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${token}` : null
    res.json(successResponse({
      token, expiresAt, botUsername, deepLink,
      registrationNumber: vehicle.registrationNumber,
    }))
  } catch (err) { next(err) }
}

/** GET /vehicle-care-tasks/drivers — barcha mashinalar + haydovchi holati */
export async function listVehiclesCareDrivers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const vehicles = await (prisma as any).vehicle.findMany({
      where: bv !== undefined ? { branchId: bv } : {},
      select: { id: true, registrationNumber: true, brand: true, model: true },
      orderBy: { registrationNumber: 'asc' },
    })
    const drivers = await (prisma as any).vehicleCareDriver.findMany({
      where: { vehicleId: { in: vehicles.map((v: any) => v.id) } },
      select: { vehicleId: true, driverName: true, tgUsername: true, linkedAt: true },
    })
    const dMap = Object.fromEntries(drivers.map((d: any) => [d.vehicleId, d]))
    const result = vehicles.map((v: any) => ({ ...v, careDriver: dMap[v.id] || null }))
    res.json(successResponse(result))
  } catch (err) { next(err) }
}

// ── Nazorat paneli (haftalik jadval) ─────────────────────────────────────────

// UZT bo'yicha hafta boshini (dushanba 00:00) faqat-sana Date sifatida qaytaradi
function uzWeekStart(base?: Date): Date {
  const now = base ?? new Date(Date.now() + 5 * 60 * 60 * 1000)
  const dow = now.getUTCDay() // 0=Yak..6=Shan
  const diff = dow === 0 ? 6 : dow - 1 // dushanbagacha necha kun orqaga
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff))
  return monday
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
}

/** GET /vehicle-care-tasks/monitor?from=&to=&taskId= — haftalik bajarilish jadvali */
export async function getCareMonitor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) { res.json(successResponse({ tasks: [], vehicles: [], submissions: [], from: null, to: null })); return }

    const fromQ = req.query.from ? new Date(String(req.query.from)) : null
    const from = fromQ && !isNaN(fromQ.getTime())
      ? new Date(Date.UTC(fromQ.getUTCFullYear(), fromQ.getUTCMonth(), fromQ.getUTCDate()))
      : uzWeekStart()
    const to = addDays(from, 6)

    const tasks = await (prisma as any).vehicleCareTask.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { name: 'asc' },
    })

    // Mashinalar (tenant filtri) + haydovchi holati
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const vehiclesRaw = await (prisma as any).vehicle.findMany({
      where: bv !== undefined ? { branchId: bv } : { branch: { organizationId: orgId } },
      select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true, mileage: true },
      orderBy: { registrationNumber: 'asc' },
    })
    const vehicleIds = vehiclesRaw.map((v: any) => v.id)
    const drivers = await (prisma as any).vehicleCareDriver.findMany({
      where: { vehicleId: { in: vehicleIds } },
      select: { vehicleId: true, driverName: true, tgUsername: true },
    })
    const dMap = Object.fromEntries(drivers.map((d: any) => [d.vehicleId, d]))
    const vehicles = vehiclesRaw.map((v: any) => ({ ...v, mileage: Number(v.mileage || 0), careDriver: dMap[v.id] || null }))

    // Agar oraliq bugunni qamrasa — bugungi yozuvlarni darrov ochamiz (cron'ni kutmasdan)
    const todayStr = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    if (todayStr >= from.toISOString().slice(0, 10) && todayStr <= to.toISOString().slice(0, 10)) {
      for (const d of drivers) {
        await ensureSubmissionsForVehicle(d.vehicleId).catch(() => {})
      }
    }

    // Submissions (sana oralig'ida)
    const subWhere: any = { organizationId: orgId, dueDate: { gte: from, lte: to } }
    const taskId = req.query.taskId ? String(req.query.taskId) : null
    if (taskId) subWhere.taskId = taskId
    const subsRaw = await (prisma as any).vehicleCareSubmission.findMany({
      where: subWhere,
      select: {
        id: true, taskId: true, vehicleId: true, dueDate: true, status: true,
        reminderCount: true, submittedAt: true, mediaType: true, mediaPath: true,
        rejectedAt: true, rejectedReason: true,
      },
    })
    const submissions = subsRaw.map((s: any) => ({
      ...s,
      dueDate: s.dueDate instanceof Date ? s.dueDate.toISOString().slice(0, 10) : s.dueDate,
      mediaUrl: s.mediaPath ? '/uploads/' + s.mediaPath : null,
    }))

    // Kilometr vazifalari uchun holatlar (oxirgi bajarilgan probeg)
    const mileageTaskIds = tasks.filter((t: any) => t.triggerType === 'mileage').map((t: any) => t.id)
    let mileageStates: any[] = []
    if (mileageTaskIds.length) {
      const st = await (prisma as any).vehicleCareMileageState.findMany({
        where: { taskId: { in: mileageTaskIds }, vehicleId: { in: vehicleIds } },
        select: { taskId: true, vehicleId: true, lastKm: true },
      })
      mileageStates = st.map((s: any) => ({ ...s, lastKm: Number(s.lastKm) }))
    }

    res.json(successResponse({
      tasks,
      vehicles,
      submissions,
      mileageStates,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    }))
  } catch (err) { next(err) }
}

/** POST /vehicle-care-tasks/submission/:id/reject — bajarilgan isbotni rad etish (qayta ochiladi) */
export async function rejectCareSubmission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id } = req.params
    const reason = req.body?.reason ? String(req.body.reason).trim() : null
    const sub = await (prisma as any).vehicleCareSubmission.findUnique({ where: { id } })
    if (!sub || sub.organizationId !== orgId) throw new AppError('Yozuv topilmadi', 404)
    // Filial muhandisi faqat o'z filiali isbotini rad eta oladi
    const rejVehicle = await (prisma as any).vehicle.findUnique({ where: { id: sub.vehicleId }, select: { branchId: true } })
    const rejFilter = await getOrgFilter(req.user!)
    if (!rejVehicle || !isBranchAllowed(rejFilter, rejVehicle.branchId)) throw new AppError('Yozuv topilmadi', 404)
    if (sub.status !== 'done') throw new AppError('Faqat bajarilgan isbotni rad etish mumkin', 400)

    // Rad etilgan fayl diskda qolmasin (mediaHash saqlanadi — o'sha rasm qayta yuborilmaydi)
    if (sub.mediaPath) {
      const fp = path.join(process.cwd(), 'uploads', sub.mediaPath)
      try { fs.unlinkSync(fp) } catch { /* ignore */ }
    }
    await (prisma as any).vehicleCareSubmission.update({
      where: { id },
      data: {
        status: 'pending', submittedAt: null, mediaPath: null, mediaType: null,
        rejectedAt: new Date(), rejectedReason: reason, reminderCount: 0,
      },
    })

    // Haydovchiga xabar
    if (sub.driverChatId) {
      const task = await (prisma as any).vehicleCareTask.findUnique({ where: { id: sub.taskId } })
      const vehicle = await (prisma as any).vehicle.findUnique({
        where: { id: sub.vehicleId }, select: { registrationNumber: true },
      })
      await sendCareMessage(sub.driverChatId,
        `❌ <b>Isbot rad etildi.</b>\n🚗 ${vehicle?.registrationNumber || ''}\n📋 ${task?.name || ''}` +
        (reason ? `\n📝 Sabab: ${reason}` : '') +
        `\n\nIltimos, vazifani qaytadan bajarib, <b>yangi</b> rasm/video yuboring.`)
    }
    res.json(successResponse(null, 'Rad etildi — vazifa qayta ochildi'))
  } catch (err) { next(err) }
}

/** POST /vehicle-care-tasks/submission/:id/skip — kunni kechirish (remont/ta'til) yoki qaytarish */
export async function skipCareSubmission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id } = req.params
    const reason = req.body?.reason ? String(req.body.reason).trim() : null
    const sub = await (prisma as any).vehicleCareSubmission.findUnique({ where: { id } })
    if (!sub || sub.organizationId !== orgId) throw new AppError('Yozuv topilmadi', 404)
    // Filial muhandisi faqat o'z filiali yozuvini boshqaradi
    const skipVehicle = await (prisma as any).vehicle.findUnique({ where: { id: sub.vehicleId }, select: { branchId: true } })
    const skipFilter = await getOrgFilter(req.user!)
    if (!skipVehicle || !isBranchAllowed(skipFilter, skipVehicle.branchId)) throw new AppError('Yozuv topilmadi', 404)
    if (sub.status === 'done') throw new AppError('Bajarilgan vazifani kechirib bo\'lmaydi', 400)

    if (sub.status === 'skipped') {
      // Qaytarish — yana talab qilinadi
      await (prisma as any).vehicleCareSubmission.update({
        where: { id }, data: { status: 'pending', rejectedReason: null },
      })
      res.json(successResponse({ status: 'pending' }, 'Qaytadan talab qilinadi'))
    } else {
      await (prisma as any).vehicleCareSubmission.update({
        where: { id }, data: { status: 'skipped', rejectedReason: reason },
      })
      res.json(successResponse({ status: 'skipped' }, 'Kechirildi'))
    }
  } catch (err) { next(err) }
}

/** DELETE /vehicle-care-tasks/driver/:vehicleId — bog'lanishni uzish */
export async function unlinkCareDriver(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { vehicleId } = req.params
    const vehicle = await assertVehicleOrg(vehicleId, orgId)
    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, vehicle.branchId)) throw new AppError('Bu mashina sizning filialingizga tegishli emas', 403)
    await (prisma as any).vehicleCareDriver.deleteMany({ where: { vehicleId } })
    await (prisma as any).vehicleCareLinkToken.deleteMany({ where: { vehicleId } })
    res.json(successResponse(null, 'Bog\'lanish uzildi'))
  } catch (err) { next(err) }
}
