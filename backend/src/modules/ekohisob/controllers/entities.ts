import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { logEkoAudit } from '../lib/ekoAudit'
import { uzDate } from '../lib/dateFormat'
import { computeCompleteness } from '../lib/entityCompleteness'
import { cleanStir, isValidStir } from '../lib/soliqNormalize'
import { entityScopeWhere, canAccessEntity, canAccessDistrict } from '../lib/ekoScope'
import {
  validateLatLon, parseMoneyInt, parsePageParams, cleanText, isEntityStatusFilter,
  BILLING_MODES, safeCell,
} from '../lib/ekoValidate'
import { MemCounter } from '../lib/memLimiter'
import { withOrgLock } from '../lib/orgLock'
import { loadEntityDebts } from '../services/entityDebtLoader'
import { currentMonthUz, todayUz } from '../lib/uzt'
import { peekSoliqCache } from '../services/soliqClient'
import { maskDuplicateForUser } from '../lib/dupMask'

const ENTITY_TYPES = ['legal', 'ip', 'person']
const DEBT_LEVEL_RE = /^[a-z_]{1,30}$/

/** Shu korxonada shu STIR bilan boshqa tashkilot bormi (takror kiritish oldini olish). */
async function findStirDuplicate(orgId: string, stir: string, excludeId?: string, client: any = prisma) {
  return (client as any).ekoHisobLegalEntity.findFirst({
    where: { orgId, stir, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, status: true, orgId: true, districtId: true },
  })
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Faol', blacklisted: "Qora ro'yxat", inactive: 'Nofaol', draft: 'Chala',
}
const MODE_LABEL: Record<string, string> = {
  monthly_fixed: 'Belgilangan oylik', variable: "O'zgaruvchan", talon: 'Talon',
}

// Eksport: foydalanuvchi boshiga daqiqasiga 3 ta, korxonada bir vaqtda ko'pi bilan 2 ta
// (ulkan ro'yxat xotirada yig'iladi — suiiste'mol serverni bo'g'ib qo'ymasin).
const exportRate = new MemCounter({ windowMs: 60_000, max: 3 })
const exportInFlight = new Map<string, number>()
const EXPORT_MAX_ROWS = 10000

/**
 * GET /entities/export.xlsx — filtrlangan ro'yxatning TO'LIQ nusxasi.
 *
 * Ro'yxat bilan bir xil `where` (buildEntityWhere) ishlatiladi. Xotira himoyasi:
 * qator chegarasi (10 000; oshsa X-Export-Truncated sarlavhasi), tezlik cheklovi,
 * bir vaqtdagi eksportlar soni cheklovi. Excel kataklaridagi formula in'ektsiyasi zararsizlantiriladi.
 */
export async function exportEntitiesXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  const orgId = req.ekoUser?.orgId ?? ''
  let counted = false
  try {
    const { where, error } = buildEntityWhere(req)
    if (error) { res.status(error.status).json({ success: false, error: error.message }); return }

    if (!exportRate.hit(`exp:${req.ekoUser!.id}`)) {
      res.status(429).json({ success: false, error: "Juda tez-tez eksport. Bir daqiqadan keyin urinib ko'ring." })
      return
    }
    if ((exportInFlight.get(orgId) ?? 0) >= 2) {
      res.status(429).json({ success: false, error: "Hozir boshqa eksport bajarilmoqda. Birozdan keyin urinib ko'ring." })
      return
    }
    exportInFlight.set(orgId, (exportInFlight.get(orgId) ?? 0) + 1)
    counted = true

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      include: {
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: EXPORT_MAX_ROWS + 1,
    })
    const truncated = entities.length > EXPORT_MAX_ROWS
    if (truncated) entities.length = EXPORT_MAX_ROWS

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()
    const ws = wb.addWorksheet('Tashkilotlar')
    ws.columns = [
      { header: 'Kod', key: 'code', width: 12 },
      { header: 'Nomi', key: 'name', width: 32 },
      { header: 'STIR', key: 'stir', width: 14 },
      { header: 'Manzil', key: 'address', width: 30 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Tuman', key: 'district', width: 18 },
      { header: 'Mahalla', key: 'mahalla', width: 18 },
      { header: 'Rejim', key: 'mode', width: 18 },
      { header: 'Oylik / kub narxi', key: 'fee', width: 18 },
      { header: 'Holat', key: 'status', width: 14 },
      { header: 'Qarz darajasi', key: 'debtLevel', width: 14 },
      { header: "Qo'shilgan sana", key: 'createdAt', width: 16 },
    ]
    const header = ws.getRow(1)
    header.font = { bold: true }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    header.eachCell(c => { c.border = { bottom: { style: 'thin' } } })

    for (const e of entities) {
      ws.addRow({
        code: safeCell(e.code || ''),
        name: safeCell(e.name),
        stir: e.stir || '',
        address: safeCell(e.address || ''),
        phone: safeCell(e.phone || ''),
        district: safeCell(e.district?.name || ''),
        mahalla: safeCell(e.mahalla?.name || ''),
        mode: MODE_LABEL[e.billingMode] || e.billingMode,
        fee: e.billingMode === 'talon' ? e.cubicPrice : e.monthlyFee,
        status: STATUS_LABEL[e.status] || e.status,
        debtLevel: e.debtLevel,
        createdAt: uzDate(e.createdAt),
      })
    }
    ws.getColumn('fee').numFmt = '# ##0'

    const total = ws.addRow({ name: `JAMI: ${entities.length} ta tashkilot${truncated ? ` (birinchi ${EXPORT_MAX_ROWS} ta — filtr qo'ying)` : ''}` })
    total.font = { bold: true }

    await logEkoAudit(req.ekoUser, {
      action: 'entity.export', targetType: 'entity', targetName: 'tashkilotlar.xlsx',
      details: { rows: entities.length, truncated, filters: req.query },
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ekohisob_tashkilotlar_${uzDate(new Date()).replace(/\./g, '-')}.xlsx"`)
    if (truncated) res.setHeader('X-Export-Truncated', '1')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
  finally {
    if (counted) exportInFlight.set(orgId, Math.max(0, (exportInFlight.get(orgId) ?? 1) - 1))
  }
}

/**
 * Ro'yxat va Excel eksport BIR XIL filtrni ishlatishi shart — aks holda
 * foydalanuvchi ekranda ko'rgan ro'yxati bilan yuklab olgan fayli mos
 * kelmay qoladi. Shuning uchun `where` qurish shu yerda, bitta joyda.
 * Huquq doirasi (tenant + tuman) — lib/ekoScope.ts (yagona manba).
 */
function buildEntityWhere(req: EkoRequest): { where: any; error?: { status: number; message: string } } {
  const user = req.ekoUser!
  const { districtId, mahallId, status, debtLevel, search } = req.query

  const where: any = { ...entityScopeWhere(user), status: { not: 'deleted' } }

  if (districtId) {
    if (!canAccessDistrict(user, String(districtId))) {
      return { where, error: { status: 403, message: 'Ushbu tumanga kirish taqiqlangan' } }
    }
    where.districtId = String(districtId)
  }

  if (mahallId) where.mahallId = String(mahallId)
  if (status) {
    // Ruxsat etilgan holatlar ro'yxati (ixtiyoriy qiymat bilan 'deleted' filtri aylanib o'tilmasin)
    if (!isEntityStatusFilter(status)) {
      return { where, error: { status: 400, message: "Status filtri noto'g'ri" } }
    }
    where.status = String(status)
  }
  if (req.query.billingMode) {
    const bm = String(req.query.billingMode)
    if (!['variable', 'monthly_fixed', 'talon'].includes(bm)) {
      return { where, error: { status: 400, message: "To'lov rejimi filtri noto'g'ri" } }
    }
    where.billingMode = bm
  }
  if (debtLevel) {
    if (!DEBT_LEVEL_RE.test(String(debtLevel))) {
      return { where, error: { status: 400, message: "Qarz darajasi filtri noto'g'ri" } }
    }
    where.debtLevel = String(debtLevel)
  }

  // "Kim kiritdi" bo'yicha filtr — bitta tumanda bir necha inspektor ishlaganda
  // qaysi yozuv kimniki ekanini ajratish uchun.
  if (req.query.createdBy) where.createdBy = String(req.query.createdBy).slice(0, 64)

  if (search) {
    const q = String(search).trim().slice(0, 100)
    if (q) {
      const or: any[] = [
        { name: { contains: q, mode: 'insensitive' } },
        { stir: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ]
      // Telefon bo'yicha: faqat raqamlar (kamida 4 ta) — "+998 90 123-45-67" va "1234567" ikkalasi topiladi.
      // Saqlangan telefon formatlangan bo'lishi mumkin, shuning uchun raw va raqamli variant ham tekshiriladi.
      const digits = q.replace(/\D/g, '')
      if (digits.length >= 4) {
        or.push({ phone: { contains: digits } })
        if (digits !== q) or.push({ phone: { contains: q } })
      }
      where.OR = or
    }
  }

  return { where }
}

export async function listEntities(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { where, error } = buildEntityWhere(req)
    if (error) { res.status(error.status).json({ success: false, error: error.message }); return }

    const { page, limit: take, skip } = parsePageParams(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 200 })

    const [total, entities] = await Promise.all([
      (prisma as any).ekoHisobLegalEntity.count({ where }),
      (prisma as any).ekoHisobLegalEntity.findMany({
        where,
        skip,
        take,
        include: {
          district: { select: { id: true, name: true } },
          mahalla: { select: { id: true, name: true } },
          blacklist: { select: { id: true, status: true, reason: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ])

    // Kim kiritganini nomi bilan qo'shamiz.
    // ATAYLAB Prisma bog'lanishi (FK) emas: `createdBy` da eski yozuvlarda
    // ekohisob_users da mavjud bo'lmagan id'lar bo'lishi mumkin (asosiy
    // AutoHisob admini soya yozuv paydo bo'lishidan oldin kiritgan bo'lsa).
    // FK qo'shilsa migratsiya yiqilib, barcha deploylarni bloklardi.
    const withCreator = await attachCreators(entities)

    // Kanonik qarz (dashboard, hisobot va akt sverka bilan AYNAN bir xil) — bitta SQL, N+1 yo'q.
    // Qo'shimcha maydonlar: debtAmount, debtMonths, unpaidMonths, advance. Mavjud maydonlar o'zgarmaydi.
    const user = req.ekoUser!
    const debts = await loadEntityDebts(entities, user.orgId, { currentMonth: currentMonthUz() })
    const withDebt = withCreator.map((e: any) => {
      const d = debts.get(e.id)
      return {
        ...e,
        debtAmount: d?.totalDebt ?? 0,
        debtMonths: d?.debtMonths ?? 0,
        unpaidMonths: d?.unpaidMonths ?? [],
        advance: d?.advance ?? 0,
      }
    })

    res.json({
      success: true,
      data: withDebt,
      meta: { total, page, limit: take },
    })
  } catch (err) { next(err) }
}

/** `createdBy` id'lariga xodim nomini biriktiradi. Topilmasa null qoladi. */
async function attachCreators<T extends { createdBy?: string | null }>(rows: T[]): Promise<(T & { creatorName: string | null })[]> {
  const ids = Array.from(new Set(rows.map(r => r.createdBy).filter(Boolean))) as string[]
  if (ids.length === 0) {
    return rows.map(r => ({ ...r, creatorName: null }))
  }
  const users = await (prisma as any).ekoHisobUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  }).catch(() => [] as any[])
  const byId = new Map<string, string>(users.map((u: any) => [u.id, u.fullName]))
  return rows.map(r => ({ ...r, creatorName: r.createdBy ? (byId.get(r.createdBy) ?? null) : null }))
}

/** Matn maydonlarini bir joyda tekshiradi; xato bo'lsa birinchisini qaytaradi. */
function readTextFields(body: any, keys: [string, number, string][]): { values: Record<string, string | null>; error?: string } {
  const values: Record<string, string | null> = {}
  for (const [key, max, label] of keys) {
    if (body[key] === undefined) continue
    const c = cleanText(body[key], max, label)
    if (!c.ok) return { values, error: c.error }
    values[key] = c.value
  }
  return { values }
}

const TEXT_FIELDS: [string, number, string][] = [
  ['code', 50, 'Kod'],
  ['address', 300, 'Manzil'],
  ['phone', 30, 'Telefon'],
  ['contactName', 120, "Mas'ul shaxs"],
  ['contractNumber', 60, 'Shartnoma raqami'],
]

export async function createEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { orgId } = user
    const body = req.body ?? {}
    const {
      name, stir, lat, lon,
      districtId, mahallId, monthlyFee, billingMode, cubicPrice, contractStartMonth,
      entityType, soliqSynced,
    } = body

    const nameC = cleanText(name, 200, 'Nom')
    if (!nameC.ok) { res.status(400).json({ success: false, error: nameC.error }); return }
    if (!nameC.value) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }
    if (!districtId || typeof districtId !== 'string') {
      res.status(400).json({ success: false, error: 'districtId talab qilinadi' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id: districtId } })
    if (!district || district.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }
    if (!canAccessDistrict(user, districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const fee = parseMoneyInt(monthlyFee, 'Oylik summa')
    if (!fee.ok) { res.status(400).json({ success: false, error: fee.error }); return }
    const cubic = parseMoneyInt(cubicPrice, 'Kub narxi')
    if (!cubic.ok) { res.status(400).json({ success: false, error: cubic.error }); return }
    const texts = readTextFields(body, TEXT_FIELDS)
    if (texts.error) { res.status(400).json({ success: false, error: texts.error }); return }

    const data: any = {
      name: nameC.value,
      districtId,
      orgId,
      monthlyFee: fee.value,
      createdBy: user.id, // kim kiritdi — plan progressi uchun
      ...texts.values,
    }
    if (entityType !== undefined) {
      if (!ENTITY_TYPES.includes(entityType)) {
        res.status(400).json({ success: false, error: "Tashkilot turi noto'g'ri" })
        return
      }
      data.entityType = entityType
    }
    // Jismoniy shaxsda STIR bo'lmaydi; boshqalarda kiritilsa 9 xonali bo'lishi va takror bo'lmasligi shart
    const stirClean = data.entityType === 'person' ? '' : cleanStir(stir)
    if (stirClean) {
      if (!isValidStir(stirClean)) {
        res.status(400).json({ success: false, error: "STIR 9 ta raqamdan iborat bo'lishi kerak" })
        return
      }
      data.stir = stirClean
      // soliqSynced mijoz tomonidan YOLG'ON yuborilishi mumkin: faqat serverda shu STIR bo'yicha
      // yaqinda muvaffaqiyatli lookup bo'lgan bo'lsa ishonamiz.
      if (soliqSynced === true && peekSoliqCache(stirClean)) data.soliqSyncedAt = new Date()
    } else if (stir !== undefined) {
      data.stir = null
    }
    if (lat !== undefined || lon !== undefined) {
      const emptyBoth = (lat === null || lat === '' || lat === undefined) && (lon === null || lon === '' || lon === undefined)
      if (!emptyBoth) {
        const ll = validateLatLon(lat, lon)
        if (!ll.ok) { res.status(400).json({ success: false, error: ll.error }); return }
        data.lat = ll.value.lat
        data.lon = ll.value.lon
      }
    }
    if (billingMode !== undefined) {
      if (!(BILLING_MODES as readonly string[]).includes(billingMode)) {
        res.status(400).json({ success: false, error: "To'lov rejimi noto'g'ri" })
        return
      }
      data.billingMode = billingMode
    }
    if (cubicPrice !== undefined) data.cubicPrice = cubic.value
    if (contractStartMonth !== undefined) {
      data.contractStartMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(contractStartMonth)) ? String(contractStartMonth) : null
    }
    if (mahallId) {
      const mahalla = await (prisma as any).ekoHisobMahalla.findUnique({ where: { id: mahallId } })
      if (!mahalla || mahalla.districtId !== districtId) {
        res.status(400).json({ success: false, error: 'Mahalla ushbu tumanga tegishli emas' })
        return
      }
      data.mahallId = mahallId
    }

    const include = {
      district: { select: { id: true, name: true } },
      mahalla: { select: { id: true, name: true } },
    }
    let entity: any
    if (data.stir) {
      // STIR takrorini poygadan himoya: tekshirish va yaratish bitta korxona qulfi ostida
      const out = await withOrgLock(orgId, 'entity-stir', async tx => {
        const dup = await findStirDuplicate(orgId, data.stir, undefined, tx)
        if (dup) return { dup }
        return { created: await tx.ekoHisobLegalEntity.create({ data, include }) }
      })
      if ('dup' in out && out.dup) {
        res.status(409).json({ success: false, code: 'DUPLICATE_STIR', error: `Bu STIR bilan tashkilot allaqachon kiritilgan: ${maskDuplicateForUser(user, out.dup).name}`, data: { existing: maskDuplicateForUser(user, out.dup) } })
        return
      }
      entity = (out as any).created
    } else {
      entity = await (prisma as any).ekoHisobLegalEntity.create({ data, include })
    }

    await logEkoAudit(user, {
      action: 'entity.create', targetType: 'entity', targetId: entity.id, targetName: entity.name,
      details: { districtId, billingMode: entity.billingMode, hasLocation: entity.lat != null },
    })
    res.status(201).json({ success: true, data: entity })
  } catch (err) { next(err) }
}

export async function getEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      include: {
        district: { select: { id: true, name: true } },
        mahalla: { select: { id: true, name: true } },
        blacklist: true,
        payments: {
          orderBy: { month: 'desc' },
          take: 24,
          include: {
            receiver: { select: { id: true, fullName: true } },
          },
        },
      },
    })

    if (!entity || entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const [withCreator] = await attachCreators([entity])
    res.json({ success: true, data: withCreator })
  } catch (err) { next(err) }
}

export async function updateEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { orgId } = user
    const { id } = req.params
    const body = req.body ?? {}

    const existing = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, existing)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const {
      name, stir, mahallId, monthlyFee, status,
      billingMode, cubicPrice, contractStartMonth, districtId, lat, lon,
      entityType, soliqSynced,
    } = body

    const data: any = {}
    if (name !== undefined) {
      const c = cleanText(name, 200, 'Nom')
      if (!c.ok) { res.status(400).json({ success: false, error: c.error }); return }
      if (!c.value) {
        res.status(400).json({ success: false, error: "Nom bo'sh bo'lishi mumkin emas" })
        return
      }
      data.name = c.value
    }

    // Tuman almashtirish: yangi tuman shu korxonaniki bo'lishi va (admin bo'lmasa)
    // unga biriktirilgan bo'lishi shart. Mahalla eski tumanniki bo'lib qolmasin.
    let effectiveDistrictId: string = existing.districtId
    if (districtId !== undefined && districtId !== existing.districtId) {
      const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id: String(districtId) } })
      if (!district || district.orgId !== orgId) {
        res.status(404).json({ success: false, error: 'Tuman topilmadi' })
        return
      }
      if (!canAccessDistrict(user, district.id)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      data.districtId = district.id
      effectiveDistrictId = district.id
      if (mahallId === undefined) data.mahallId = null
    }

    // Joylashuv: ikkalasi ham to'g'ri raqam bo'lishi shart, yoki ikkalasi ham null (olib tashlash)
    if (lat !== undefined || lon !== undefined) {
      if (lat === null && lon === null) {
        data.lat = null; data.lon = null
      } else {
        const ll = validateLatLon(lat, lon)
        if (!ll.ok) { res.status(400).json({ success: false, error: ll.error }); return }
        data.lat = ll.value.lat; data.lon = ll.value.lon
      }
    }
    if (entityType !== undefined) {
      if (!ENTITY_TYPES.includes(entityType)) {
        res.status(400).json({ success: false, error: "Tashkilot turi noto'g'ri" })
        return
      }
      data.entityType = entityType
    }
    const nextType = data.entityType ?? existing.entityType
    let stirToCheck: string | null = null
    if (nextType === 'person' && existing.stir) {
      data.stir = null // jismoniy shaxsga o'tkazilganda STIR olib tashlanadi
    } else if (stir !== undefined && nextType !== 'person') {
      const stirClean = cleanStir(stir)
      // Eski (o'zgarmagan) qiymat tekshirilmaydi: bazadagi eski noto'g'ri STIR boshqa tahrirni to'smasin
      if (stirClean !== (existing.stir ?? '')) {
        if (stirClean && !isValidStir(stirClean)) {
          res.status(400).json({ success: false, error: "STIR 9 ta raqamdan iborat bo'lishi kerak" })
          return
        }
        if (stirClean) stirToCheck = stirClean
        data.stir = stirClean || null
      }
    }
    const effectiveStir = data.stir !== undefined ? data.stir : existing.stir
    if (soliqSynced === true && effectiveStir && peekSoliqCache(effectiveStir)) data.soliqSyncedAt = new Date()

    const texts = readTextFields(body, TEXT_FIELDS)
    if (texts.error) { res.status(400).json({ success: false, error: texts.error }); return }
    Object.assign(data, texts.values)

    if (monthlyFee !== undefined) {
      const m = parseMoneyInt(monthlyFee, 'Oylik summa')
      if (!m.ok) { res.status(400).json({ success: false, error: m.error }); return }
      data.monthlyFee = m.value
    }
    if (cubicPrice !== undefined) {
      const c = parseMoneyInt(cubicPrice, 'Kub narxi')
      if (!c.ok) { res.status(400).json({ success: false, error: c.error }); return }
      data.cubicPrice = c.value
    }
    if (billingMode !== undefined) {
      if (!(BILLING_MODES as readonly string[]).includes(billingMode)) {
        res.status(400).json({ success: false, error: "To'lov rejimi noto'g'ri" })
        return
      }
      data.billingMode = billingMode
    }
    if (contractStartMonth !== undefined) {
      data.contractStartMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(contractStartMonth)) ? String(contractStartMonth) : null
    }
    if (status !== undefined) {
      // 'draft' qo'lda qo'yilmaydi — faqat bot yaratadi. 'blacklisted' esa faqat qora ro'yxat
      // bo'limi orqali (aks holda yozuvsiz "qora ro'yxat" holati paydo bo'ladi).
      const allowed = ['active', 'inactive']
      if (status === 'blacklisted' && existing.status === 'blacklisted') {
        // o'zgarish yo'q
      } else if (status === 'blacklisted') {
        res.status(400).json({ success: false, error: "Qora ro'yxatga faqat 'Qora ro'yxat' bo'limi orqali qo'shiladi" })
        return
      } else if (!allowed.includes(status)) {
        res.status(400).json({ success: false, error: "Status noto'g'ri" })
        return
      } else if (existing.status === 'blacklisted') {
        res.status(400).json({ success: false, error: "Tashkilot qora ro'yxatda — avval qora ro'yxatdan chiqaring" })
        return
      } else {
        data.status = status
      }
    }
    if (mahallId !== undefined) {
      if (mahallId === null || mahallId === '') {
        data.mahallId = null
      } else {
        const mahalla = await (prisma as any).ekoHisobMahalla.findUnique({ where: { id: mahallId } })
        if (!mahalla || mahalla.districtId !== effectiveDistrictId) {
          res.status(400).json({ success: false, error: 'Mahalla ushbu tumanga tegishli emas' })
          return
        }
        data.mahallId = mahallId
      }
    }

    // Chala tashkilotni faollashtirish: majburiy maydonlar to'liq bo'lishi shart —
    // aks holda "faol" tashkilot nol oylik bilan qarz hisobiga tushib qoladi.
    if (existing.status === 'draft' && data.status === 'active') {
      const merged = { ...existing, ...data }
      const c = computeCompleteness(merged)
      if (!c.isReady) {
        res.status(400).json({
          success: false,
          error: `Faollashtirish uchun to'ldiring: ${c.missingRequired.map(f => f.label).join(', ')}`,
        })
        return
      }
    }

    const include = {
      district: { select: { id: true, name: true } },
      mahalla: { select: { id: true, name: true } },
    }
    let entity: any
    if (stirToCheck) {
      const out = await withOrgLock(orgId, 'entity-stir', async tx => {
        const dup = await findStirDuplicate(orgId, stirToCheck as string, id, tx)
        if (dup) return { dup }
        return { updated: await tx.ekoHisobLegalEntity.update({ where: { id }, data, include }) }
      })
      if ('dup' in out && out.dup) {
        res.status(409).json({ success: false, code: 'DUPLICATE_STIR', error: `Bu STIR bilan tashkilot allaqachon kiritilgan: ${maskDuplicateForUser(user, out.dup).name}`, data: { existing: maskDuplicateForUser(user, out.dup) } })
        return
      }
      entity = (out as any).updated
    } else {
      entity = await (prisma as any).ekoHisobLegalEntity.update({ where: { id }, data, include })
    }

    // Audit: faqat haqiqatan o'zgargan maydonlar (eski → yangi)
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of Object.keys(data)) {
      if ((existing as any)[k] !== data[k]) changes[k] = { from: (existing as any)[k] ?? null, to: data[k] }
    }
    // Joylashuv va to'lov rejimi o'zgarishi alohida (qidirish oson) yozuv bo'ladi
    if (changes.lat || changes.lon) {
      await logEkoAudit(user, {
        action: 'entity.location', targetType: 'entity', targetId: id, targetName: entity.name,
        details: { from: { lat: existing.lat ?? null, lon: existing.lon ?? null }, to: { lat: entity.lat ?? null, lon: entity.lon ?? null } },
      })
      delete changes.lat; delete changes.lon
    }
    if (changes.billingMode) {
      await logEkoAudit(user, {
        action: 'entity.billing_mode', targetType: 'entity', targetId: id, targetName: entity.name,
        details: { from: changes.billingMode.from, to: changes.billingMode.to, monthlyFee: entity.monthlyFee, cubicPrice: entity.cubicPrice },
      })
      delete changes.billingMode
    }
    if (Object.keys(changes).length > 0) {
      await logEkoAudit(user, {
        action: 'entity.update',
        targetType: 'entity',
        targetId: id,
        targetName: entity.name,
        details: { changes },
      })
    }

    res.json({ success: true, data: entity })
  } catch (err) { next(err) }
}

export async function updateLocation(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params
    const { lat, lon } = req.body ?? {}

    if (lat === undefined || lon === undefined) {
      res.status(400).json({ success: false, error: 'lat va lon talab qilinadi' })
      return
    }
    const ll = validateLatLon(lat, lon)
    if (!ll.ok) { res.status(400).json({ success: false, error: ll.error }); return }

    const existing = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id } })
    if (!existing || existing.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, existing)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.update({
      where: { id },
      data: { lat: ll.value.lat, lon: ll.value.lon },
    })
    await logEkoAudit(user, {
      action: 'entity.location', targetType: 'entity', targetId: id, targetName: existing.name,
      details: { from: { lat: existing.lat ?? null, lon: existing.lon ?? null }, to: ll.value },
    })
    res.json({ success: true, data: entity })
  } catch (err) { next(err) }
}

/**
 * DELETE /entities/:id — tashkilotni deaktiv qiladi (o'chirmaydi).
 * `reason` MAJBURIY (body yoki ?reason=): kim, nega o'chirgani auditda qoladi.
 * Qarzi bo'lsa amal bajariladi, lekin javobda `warning` + `debt` qaytadi.
 */
export async function softDeleteEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    const reasonC = cleanText(req.body?.reason ?? req.query.reason, 300, 'Sabab')
    if (!reasonC.ok) { res.status(400).json({ success: false, error: reasonC.error }); return }
    if (!reasonC.value || reasonC.value.length < 3) {
      res.status(400).json({ success: false, code: 'REASON_REQUIRED', error: "Deaktiv qilish sababini kiriting (kamida 3 belgi)" })
      return
    }

    const existing = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
    })
    if (!existing || existing.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, existing)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    // Qarz — yagona kanonik manba (kartochka/ro'yxat/hisobot bilan bir xil)
    const debt = (await loadEntityDebts([existing], user.orgId, {
      currentMonth: currentMonthUz(),
      paidCurrentMonth: true,
    })).get(existing.id)!

    await (prisma as any).ekoHisobLegalEntity.update({
      where: { id },
      data: { status: 'inactive' },
    })

    await logEkoAudit(user, {
      action: 'entity.deactivate',
      targetType: 'entity',
      targetId: id,
      targetName: existing.name,
      amount: debt.totalDebt > 0 ? debt.totalDebt : null,
      details: {
        reason: reasonC.value,
        previousStatus: existing.status,
        billingMode: existing.billingMode,
        monthlyFee: existing.monthlyFee,
        debt: debt.totalDebt,
        at: todayUz(),
      },
    })

    const hasDebt = debt.totalDebt > 0
    res.json({
      success: true,
      data: hasDebt ? { hadDebt: true, debt: debt.totalDebt, debtMonths: debt.debtMonths } : null,
      message: hasDebt
        ? `Tashkilot deaktiv qilindi. DIQQAT: ${debt.totalDebt.toLocaleString('en-US').replace(/,/g, ' ')} so'm qarzi qolgan`
        : 'Tashkilot deaktiv qilindi',
      ...(hasDebt ? { warning: 'Tashkilotning to\'lanmagan qarzi bor' } : {}),
    })
  } catch (err) { next(err) }
}
