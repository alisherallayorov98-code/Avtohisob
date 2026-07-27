import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { logEkoAudit } from '../lib/ekoAudit'
import { uzDate } from '../lib/dateFormat'

const STATUS_LABEL: Record<string, string> = {
  active: 'Faol', blacklisted: "Qora ro'yxat", inactive: 'Nofaol', draft: 'Chala',
}
const MODE_LABEL: Record<string, string> = {
  monthly_fixed: 'Belgilangan oylik', variable: "O'zgaruvchan", talon: 'Talon',
}

/**
 * GET /entities/export.xlsx — filtrlangan ro'yxatning TO'LIQ nusxasi.
 *
 * Ilgari frontenddagi "Excel" tugmasi faqat ekrandagi joriy sahifani
 * (20 qator) TSV qilib `.xls` nomi bilan yuklardi — filtr qanchalik ko'p
 * mos kelsa ham, foydalanuvchi buni sezmasdan yarim ma'lumot bilan qolardi.
 * Endi ro'yxat bilan bir xil `where` (buildEntityWhere) ishlatiladi va
 * natija to'liq (10 000 tagacha) yuklanadi.
 */
export async function exportEntitiesXlsx(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { where, error } = buildEntityWhere(req)
    if (error) { res.status(error.status).json({ success: false, error: error.message }); return }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      include: {
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      // Qattiq xavfsizlik chegarasi — juda katta korxonada ham xotira bo'g'ilmasin.
      // Undan ko'p kerak bo'lsa filtr (tuman/mahalla) qo'yish taklif qilinadi.
      take: 10000,
    })

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
        code: e.code || '',
        name: e.name,
        stir: e.stir || '',
        address: e.address || '',
        phone: e.phone || '',
        district: e.district?.name || '',
        mahalla: e.mahalla?.name || '',
        mode: MODE_LABEL[e.billingMode] || e.billingMode,
        fee: e.billingMode === 'talon' ? e.cubicPrice : e.monthlyFee,
        status: STATUS_LABEL[e.status] || e.status,
        debtLevel: e.debtLevel,
        createdAt: uzDate(e.createdAt),
      })
    }
    ws.getColumn('fee').numFmt = '# ##0'

    const total = ws.addRow({ name: `JAMI: ${entities.length} ta tashkilot` })
    total.font = { bold: true }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ekohisob_tashkilotlar_${uzDate(new Date()).replace(/\./g, '-')}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

/**
 * Ro'yxat va Excel eksport BIR XIL filtrni ishlatishi shart — aks holda
 * foydalanuvchi ekranda ko'rgan ro'yxati bilan yuklab olgan fayli mos
 * kelmay qoladi. Shuning uchun `where` qurish shu yerda, bitta joyda.
 */
function buildEntityWhere(req: EkoRequest): { where: any; error?: { status: number; message: string } } {
  const { orgId, role, districtIds } = req.ekoUser!
  const { districtId, mahallId, status, debtLevel, search } = req.query

  const where: any = { orgId, status: { not: 'deleted' } }

  if (role === 'inspector') where.districtId = { in: districtIds }

  if (districtId) {
    if (role === 'inspector' && !districtIds.includes(String(districtId))) {
      return { where, error: { status: 403, message: 'Ushbu tumanga kirish taqiqlangan' } }
    }
    where.districtId = String(districtId)
  }

  if (mahallId) where.mahallId = String(mahallId)
  if (status) where.status = String(status)
  if (debtLevel) where.debtLevel = String(debtLevel)

  // "Kim kiritdi" bo'yicha filtr — bitta tumanda bir necha inspektor ishlaganda
  // qaysi yozuv kimniki ekanini ajratish uchun.
  if (req.query.createdBy) where.createdBy = String(req.query.createdBy)

  if (search) {
    const q = String(search).trim()
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { stir: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
    ]
  }

  return { where }
}

export async function listEntities(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page = '1', limit = '50' } = req.query
    const { where, error } = buildEntityWhere(req)
    if (error) { res.status(error.status).json({ success: false, error: error.message }); return }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit))
    const take = Math.min(parseInt(String(limit)), 200)

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

    res.json({
      success: true,
      data: withCreator,
      meta: { total, page: parseInt(String(page)), limit: take },
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

export async function createEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const {
      name, stir, code, address, lat, lon, phone, contactName,
      districtId, mahallId, monthlyFee, billingMode, cubicPrice, contractStartMonth, contractNumber,
    } = req.body

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }
    if (!districtId) {
      res.status(400).json({ success: false, error: 'districtId talab qilinadi' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id: districtId } })
    if (!district || district.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const data: any = {
      name: String(name).trim(),
      districtId,
      orgId,
      monthlyFee: monthlyFee ? parseInt(monthlyFee) : 0,
      createdBy: req.ekoUser!.id, // kim kiritdi — plan progressi uchun
    }
    if (stir !== undefined) data.stir = String(stir).trim() || null
    if (code !== undefined) data.code = String(code).trim() || null
    if (address !== undefined) data.address = String(address).trim() || null
    if (phone !== undefined) data.phone = String(phone).trim() || null
    if (contactName !== undefined) data.contactName = String(contactName).trim() || null
    if (lat !== undefined) data.lat = parseFloat(lat) || null
    if (lon !== undefined) data.lon = parseFloat(lon) || null
    if (billingMode !== undefined && ['monthly_fixed', 'variable', 'talon'].includes(billingMode)) {
      data.billingMode = billingMode
    }
    if (cubicPrice !== undefined) data.cubicPrice = parseInt(cubicPrice) || 0
    if (contractStartMonth !== undefined) {
      data.contractStartMonth = /^\d{4}-\d{2}$/.test(String(contractStartMonth)) ? String(contractStartMonth) : null
    }
    if (contractNumber !== undefined) data.contractNumber = String(contractNumber).trim() || null
    if (mahallId) {
      const mahalla = await (prisma as any).ekoHisobMahalla.findUnique({ where: { id: mahallId } })
      if (!mahalla || mahalla.districtId !== districtId) {
        res.status(400).json({ success: false, error: 'Mahalla ushbu tumanga tegishli emas' })
        return
      }
      data.mahallId = mahallId
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.create({
      data,
      include: {
        district: { select: { id: true, name: true } },
        mahalla: { select: { id: true, name: true } },
      },
    })
    res.status(201).json({ success: true, data: entity })
  } catch (err) { next(err) }
}

export async function getEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
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

    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const [withCreator] = await attachCreators([entity])
    res.json({ success: true, data: withCreator })
  } catch (err) { next(err) }
}

export async function updateEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params

    const existing = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(existing.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const {
      name, stir, code, address, phone, contactName, mahallId, monthlyFee, status,
      billingMode, cubicPrice, contractStartMonth, contractNumber,
    } = req.body

    const data: any = {}
    if (name !== undefined) data.name = String(name).trim()
    if (stir !== undefined) data.stir = String(stir).trim() || null
    if (code !== undefined) data.code = String(code).trim() || null
    if (address !== undefined) data.address = String(address).trim() || null
    if (phone !== undefined) data.phone = String(phone).trim() || null
    if (contactName !== undefined) data.contactName = String(contactName).trim() || null
    if (monthlyFee !== undefined) data.monthlyFee = parseInt(monthlyFee)
    if (billingMode !== undefined && ['monthly_fixed', 'variable', 'talon'].includes(billingMode)) {
      data.billingMode = billingMode
    }
    if (cubicPrice !== undefined) data.cubicPrice = parseInt(cubicPrice) || 0
    if (contractStartMonth !== undefined) {
      data.contractStartMonth = /^\d{4}-\d{2}$/.test(String(contractStartMonth)) ? String(contractStartMonth) : null
    }
    if (contractNumber !== undefined) data.contractNumber = String(contractNumber).trim() || null
    if (status !== undefined) {
      const allowed = ['active', 'blacklisted', 'inactive']
      if (!allowed.includes(status)) {
        res.status(400).json({ success: false, error: 'Status noto\'g\'ri' })
        return
      }
      data.status = status
    }
    if (mahallId !== undefined) {
      if (mahallId === null || mahallId === '') {
        data.mahallId = null
      } else {
        const mahalla = await (prisma as any).ekoHisobMahalla.findUnique({ where: { id: mahallId } })
        if (!mahalla || mahalla.districtId !== existing.districtId) {
          res.status(400).json({ success: false, error: 'Mahalla ushbu tumanga tegishli emas' })
          return
        }
        data.mahallId = mahallId
      }
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.update({
      where: { id },
      data,
      include: {
        district: { select: { id: true, name: true } },
        mahalla: { select: { id: true, name: true } },
      },
    })
    res.json({ success: true, data: entity })
  } catch (err) { next(err) }
}

export async function updateLocation(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params
    const { lat, lon } = req.body

    if (lat === undefined || lon === undefined) {
      res.status(400).json({ success: false, error: 'lat va lon talab qilinadi' })
      return
    }

    const existing = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(existing.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.update({
      where: { id },
      data: { lat: parseFloat(lat), lon: parseFloat(lon) },
    })
    res.json({ success: true, data: entity })
  } catch (err) { next(err) }
}

export async function softDeleteEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params

    const existing = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(existing.districtId)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    await (prisma as any).ekoHisobLegalEntity.update({
      where: { id },
      data: { status: 'inactive' },
    })

    await logEkoAudit(req.ekoUser, {
      action: 'entity.deactivate',
      targetType: 'entity',
      targetId: id,
      targetName: existing.name,
      details: { billingMode: existing.billingMode, monthlyFee: existing.monthlyFee },
    })

    res.json({ success: true, data: null, message: 'Tashkilot deaktiv qilindi' })
  } catch (err) { next(err) }
}
