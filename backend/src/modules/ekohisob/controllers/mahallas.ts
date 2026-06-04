import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

export async function listMahallas(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { districtId } = req.query

    const where: any = {}

    if (districtId) {
      // Verify district belongs to org
      const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id: String(districtId) } })
      if (!district || district.orgId !== orgId) {
        res.status(404).json({ success: false, error: 'Tuman topilmadi' })
        return
      }
      if (role === 'inspector' && !districtIds.includes(String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.districtId = String(districtId)
    } else {
      // Filter by accessible districts
      if (role === 'inspector') {
        where.districtId = { in: districtIds }
      } else {
        // Admin: filter by org
        const orgDistricts = await (prisma as any).ekoHisobDistrict.findMany({
          where: { orgId },
          select: { id: true },
        })
        where.districtId = { in: orgDistricts.map((d: any) => d.id) }
      }
    }

    const mahallas = await (prisma as any).ekoHisobMahalla.findMany({
      where,
      include: {
        district: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: mahallas })
  } catch (err) { next(err) }
}

export async function createMahalla(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { name, districtId } = req.body

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

    const mahalla = await (prisma as any).ekoHisobMahalla.create({
      data: {
        name: String(name).trim(),
        districtId,
      },
    })
    res.status(201).json({ success: true, data: mahalla })
  } catch (err) { next(err) }
}

export async function updateMahalla(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { name } = req.body

    const existing = await (prisma as any).ekoHisobMahalla.findUnique({
      where: { id },
      include: { district: { select: { orgId: true } } },
    })
    if (!existing || existing.district.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mahalla topilmadi' })
      return
    }

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }

    const mahalla = await (prisma as any).ekoHisobMahalla.update({
      where: { id },
      data: { name: String(name).trim() },
    })
    res.json({ success: true, data: mahalla })
  } catch (err) { next(err) }
}

export async function deleteMahalla(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params

    const existing = await (prisma as any).ekoHisobMahalla.findUnique({
      where: { id },
      include: { district: { select: { orgId: true } } },
    })
    if (!existing || existing.district.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Mahalla topilmadi' })
      return
    }

    await (prisma as any).ekoHisobMahalla.delete({ where: { id } })
    res.json({ success: true, data: null, message: 'Mahalla o\'chirildi' })
  } catch (err) { next(err) }
}
