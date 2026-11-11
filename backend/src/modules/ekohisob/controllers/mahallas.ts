import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { canAccessDistrict, districtIdsFilter } from '../lib/ekoScope'
import { logEkoAudit } from '../lib/ekoAudit'
import { cleanText, parsePageParams } from '../lib/ekoValidate'
import { normalizePlaceName } from '../lib/entityImport'

function readName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const c = cleanText(raw, 100, 'Nom')
  if (!c.ok) return c
  if (!c.value) return { ok: false, error: 'name talab qilinadi' }
  return { ok: true, value: c.value }
}

async function mahallaNameTaken(districtId: string, name: string, exceptId?: string): Promise<boolean> {
  const key = normalizePlaceName(name)
  const all = await (prisma as any).ekoHisobMahalla.findMany({ where: { districtId }, select: { id: true, name: true } })
  return all.some((m: any) => m.id !== exceptId && normalizePlaceName(m.name) === key)
}

export async function listMahallas(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { districtId } = req.query

    const where: any = {}

    if (districtId) {
      // Verify district belongs to org
      const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id: String(districtId) } })
      if (!district || district.orgId !== user.orgId) {
        res.status(404).json({ success: false, error: 'Tuman topilmadi' })
        return
      }
      if (!canAccessDistrict(user, String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.districtId = String(districtId)
    } else {
      // Kirish mumkin bo'lgan tumanlar: admin — butun korxona; qolganlar — faqat o'z tumanlari
      const allowed = districtIdsFilter(user)
      where.district = { orgId: user.orgId }
      if (allowed) where.districtId = { in: allowed }
    }

    // Nom bo'yicha qidiruv — katta shaharda tuman ichida yuzlab mahalla bo'ladi
    const q = req.query as Record<string, string>
    if (q.search) {
      where.name = { contains: String(q.search).trim().slice(0, 100), mode: 'insensitive' }
    }

    // Cheklov: mahalla ro'yxati odatda tanlash uchun ishlatiladi, shuning uchun
    // sahifalash emas, oddiy chegara. Oshib ketsa `meta.truncated` bilan aytiladi.
    const { limit: take } = parsePageParams(1, q.limit, { defaultLimit: 500, maxLimit: 2000 })

    const [total, mahallas] = await Promise.all([
      (prisma as any).ekoHisobMahalla.count({ where }),
      (prisma as any).ekoHisobMahalla.findMany({
        where,
        include: {
          district: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        take,
      }),
    ])

    res.json({
      success: true,
      data: mahallas,
      meta: { total, limit: take, truncated: total > mahallas.length },
    })
  } catch (err) { next(err) }
}

export async function createMahalla(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { districtId } = req.body ?? {}
    const n = readName(req.body?.name)
    if (!n.ok) { res.status(400).json({ success: false, error: n.error }); return }
    if (!districtId || typeof districtId !== 'string') {
      res.status(400).json({ success: false, error: 'districtId talab qilinadi' })
      return
    }

    const district = await (prisma as any).ekoHisobDistrict.findUnique({ where: { id: districtId } })
    if (!district || district.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tuman topilmadi' })
      return
    }
    if (await mahallaNameTaken(districtId, n.value)) {
      res.status(409).json({ success: false, error: 'Bu tumanda shu nomli mahalla allaqachon mavjud' })
      return
    }

    const mahalla = await (prisma as any).ekoHisobMahalla.create({
      data: { name: n.value, districtId },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'mahalla.create', targetType: 'mahalla', targetId: mahalla.id, targetName: mahalla.name,
      details: { districtId, district: district.name },
    })
    res.status(201).json({ success: true, data: mahalla })
  } catch (err) { next(err) }
}

export async function updateMahalla(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
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

    const n = readName(req.body?.name)
    if (!n.ok) { res.status(400).json({ success: false, error: n.error }); return }
    if (await mahallaNameTaken(existing.districtId, n.value, id)) {
      res.status(409).json({ success: false, error: 'Bu tumanda shu nomli mahalla allaqachon mavjud' })
      return
    }

    const mahalla = await (prisma as any).ekoHisobMahalla.update({
      where: { id },
      data: { name: n.value },
    })
    await logEkoAudit(req.ekoUser, {
      action: 'mahalla.update', targetType: 'mahalla', targetId: id, targetName: n.value,
      details: { from: existing.name, to: n.value },
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

    // Tashkilotlari bor mahallani o'chirib bo'lmaydi (ular mahallasiz qolib hisobotlar buziladi)
    const entityCount = await (prisma as any).ekoHisobLegalEntity.count({ where: { mahallId: id } })
    if (entityCount > 0) {
      res.status(409).json({
        success: false, code: 'MAHALLA_HAS_ENTITIES',
        error: `Bu mahallada ${entityCount} ta tashkilot bor — avval ularni boshqa mahallaga o'tkazing`,
        data: { entityCount },
      })
      return
    }

    await (prisma as any).ekoHisobMahalla.delete({ where: { id } })
    await logEkoAudit(req.ekoUser, {
      action: 'mahalla.delete', targetType: 'mahalla', targetId: id, targetName: existing.name,
      details: { districtId: existing.districtId },
    })
    res.json({ success: true, data: null, message: "Mahalla o'chirildi" })
  } catch (err) { next(err) }
}
