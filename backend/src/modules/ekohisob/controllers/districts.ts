import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { canAccessDistrict, districtIdsFilter } from '../lib/ekoScope'
import { logEkoAudit } from '../lib/ekoAudit'
import { cleanText } from '../lib/ekoValidate'
import { normalizePlaceName } from '../lib/entityImport'

/** Tuman nomini tekshiradi: bo'sh emas, uzunlik chegarasi. */
function readName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const c = cleanText(raw, 100, 'Nom')
  if (!c.ok) return c
  if (!c.value) return { ok: false, error: 'name talab qilinadi' }
  return { ok: true, value: c.value }
}

/** Korxonada shu nomli (imlo/kirill farqisiz) boshqa tuman bormi. */
async function districtNameTaken(orgId: string, name: string, exceptId?: string): Promise<boolean> {
  const key = normalizePlaceName(name)
  const all = await (prisma as any).ekoHisobDistrict.findMany({ where: { orgId }, select: { id: true, name: true } })
  return all.some((d: any) => d.id !== exceptId && normalizePlaceName(d.name) === key)
}

export async function listDistricts(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!

    const where: any = { orgId: user.orgId }
    // admin — hammasi; inspektor VA boshliq — faqat o'z tumanlari (tumani yo'q → bo'sh)
    const allowed = districtIdsFilter(user)
    if (allowed) where.id = { in: allowed }

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
    const n = readName(req.body?.name)
    if (!n.ok) { res.status(400).json({ success: false, error: n.error }); return }

    if (await districtNameTaken(orgId, n.value)) {
      res.status(409).json({ success: false, error: 'Bu nomli tuman allaqachon mavjud' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.create({
      data: { name: n.value, orgId },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'district.create', targetType: 'district', targetId: district.id, targetName: district.name,
    })
    res.status(201).json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function updateDistrict(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params

    const existing = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }

    const n = readName(req.body?.name)
    if (!n.ok) { res.status(400).json({ success: false, error: n.error }); return }
    if (await districtNameTaken(orgId, n.value, id)) {
      res.status(409).json({ success: false, error: 'Bu nomli tuman allaqachon mavjud' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.update({
      where: { id },
      data: { name: n.value },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'district.update', targetType: 'district', targetId: id, targetName: n.value,
      details: { from: existing.name, to: n.value },
    })
    res.json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function listMahallasInDistrict(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    // Verify district belongs to org and the user has access
    const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id } })
    if (!district || district.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }
    if (!canAccessDistrict(user, id)) {
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
