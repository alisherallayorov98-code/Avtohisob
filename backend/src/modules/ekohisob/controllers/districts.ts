import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

export async function listDistricts(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!

    const where: any = { orgId }
    if (role === 'inspector') {
      where.id = { in: districtIds }
    }

    const districts = await (prisma as any).ekoHisobDistrict.findMany({
      where,
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: districts })
  } catch (err) { next(err) }
}

export async function createDistrict(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { name } = req.body

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.create({
      data: {
        name: String(name).trim(),
        orgId,
      },
    })
    res.status(201).json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function updateDistrict(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { name } = req.body

    const existing = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }

    if (!name || !String(name).trim()) {
      res.status(400).json({ success: false, error: 'name talab qilinadi' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.update({
      where: { id },
      data: { name: String(name).trim() },
    })
    res.json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function listMahallasInDistrict(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params

    // Verify district belongs to org and inspector has access
    const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id } })
    if (!district || district.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(id)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const mahallas = await (prisma as any).ekoHisobMahalla.findMany({
      where: { districtId: id },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: mahallas })
  } catch (err) { next(err) }
}
