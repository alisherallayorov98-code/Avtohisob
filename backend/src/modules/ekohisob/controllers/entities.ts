import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

export async function listEntities(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const {
      districtId,
      mahallId,
      status,
      search,
      page = '1',
      limit = '50',
    } = req.query

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit))
    const take = Math.min(parseInt(String(limit)), 200)

    const where: any = {
      orgId,
      status: { not: 'deleted' },
    }

    // Inspector can only see their districts
    if (role === 'inspector') {
      where.districtId = { in: districtIds }
    }

    if (districtId) {
      if (role === 'inspector' && !districtIds.includes(String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.districtId = String(districtId)
    }

    if (mahallId) {
      where.mahallId = String(mahallId)
    }

    if (status) {
      where.status = String(status)
    }

    if (search) {
      const q = String(search).trim()
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { stir: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ]
    }

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

    res.json({
      success: true,
      data: entities,
      meta: { total, page: parseInt(String(page)), limit: take },
    })
  } catch (err) { next(err) }
}

export async function createEntity(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const {
      name, stir, code, address, lat, lon, phone, contactName,
      districtId, mahallId, monthlyFee, billingMode, contractStartMonth, contractNumber,
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
    }
    if (stir !== undefined) data.stir = String(stir).trim() || null
    if (code !== undefined) data.code = String(code).trim() || null
    if (address !== undefined) data.address = String(address).trim() || null
    if (phone !== undefined) data.phone = String(phone).trim() || null
    if (contactName !== undefined) data.contactName = String(contactName).trim() || null
    if (lat !== undefined) data.lat = parseFloat(lat) || null
    if (lon !== undefined) data.lon = parseFloat(lon) || null
    if (billingMode !== undefined && ['monthly_fixed', 'variable'].includes(billingMode)) {
      data.billingMode = billingMode
    }
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

    res.json({ success: true, data: entity })
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
      billingMode, contractStartMonth, contractNumber,
    } = req.body

    const data: any = {}
    if (name !== undefined) data.name = String(name).trim()
    if (stir !== undefined) data.stir = String(stir).trim() || null
    if (code !== undefined) data.code = String(code).trim() || null
    if (address !== undefined) data.address = String(address).trim() || null
    if (phone !== undefined) data.phone = String(phone).trim() || null
    if (contactName !== undefined) data.contactName = String(contactName).trim() || null
    if (monthlyFee !== undefined) data.monthlyFee = parseInt(monthlyFee)
    if (billingMode !== undefined && ['monthly_fixed', 'variable'].includes(billingMode)) {
      data.billingMode = billingMode
    }
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
    res.json({ success: true, data: null, message: 'Tashkilot deaktiv qilindi' })
  } catch (err) { next(err) }
}
