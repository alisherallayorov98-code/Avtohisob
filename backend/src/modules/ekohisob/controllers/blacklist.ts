import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { entityScopeWhere, canAccessEntity, canAccessDistrict } from '../lib/ekoScope'
import { logEkoAudit } from '../lib/ekoAudit'
import { parsePageParams, cleanText } from '../lib/ekoValidate'

/**
 * Tashkilotni qora ro'yxatdan chiqarganda qaysi holatga qaytarish kerak.
 * Sxemaga ustun qo'shilmagan, shuning uchun qora ro'yxatga qo'shish paytidagi holat auditga
 * (details.previousStatus) yoziladi va shu yerdan o'qiladi. Topilmasa — 'active'.
 */
async function previousEntityStatus(orgId: string, entityId: string): Promise<string> {
  try {
    const logs = await (prisma as any).ekoHisobAuditLog.findMany({
      where: { orgId, targetId: entityId, action: { in: ['blacklist.add', 'blacklist.update'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { details: true },
    })
    for (const l of logs) {
      const st = l.details?.previousStatus
      if (st === 'active' || st === 'inactive' || st === 'draft') return st
    }
  } catch { /* audit o'qilmasa standart */ }
  return 'active'
}

export async function listBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { districtId } = req.query

    const entityWhere: any = { ...entityScopeWhere(user) }
    if (districtId) {
      if (!canAccessDistrict(user, String(districtId))) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      entityWhere.districtId = String(districtId)
    }

    const q = req.query as Record<string, string>
    // Qora ro'yxat odatda kichik (o'nlab yozuv) va sahifa uni mijoz tomonda
    // sahifalaydi, shuning uchun standart chegara katta. Baribir cheksiz emas —
    // oshib ketsa `meta.truncated` bilan ochiq aytiladi.
    const { page, limit: take, skip } = parsePageParams(q.page, q.limit, { defaultLimit: 500, maxLimit: 2000 })

    if (q.search) {
      const s = String(q.search).trim().slice(0, 100)
      entityWhere.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { stir: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
      ]
    }

    // Bog'lanish filtri — ilgari barcha tashkilot id'lari xotiraga yuklanib
    // `IN (...)` ro'yxatiga solinardi (10 000 elementli so'rov).
    const where: any = { entity: entityWhere }
    if (q.status === 'active' || q.status === 'resolved') where.status = q.status

    const [total, blacklist] = await Promise.all([
      (prisma as any).ekoHisobBlacklist.count({ where }),
      (prisma as any).ekoHisobBlacklist.findMany({
        where,
        include: {
          entity: {
            select: {
              id: true, name: true, address: true, stir: true, code: true,
              district: { select: { id: true, name: true } },
              mahalla: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { addedAt: 'desc' },
        skip,
        take,
      }),
    ])

    res.json({
      success: true,
      data: blacklist,
      meta: { total, page, limit: take, truncated: total > skip + blacklist.length },
    })
  } catch (err) { next(err) }
}

export async function addToBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { entityId, reason, govOrgName, govCaseId } = req.body ?? {}

    if (!entityId || typeof entityId !== 'string' || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, error: 'entityId va reason talab qilinadi' })
      return
    }
    const reasonC = cleanText(reason, 1000, 'Sabab')
    const orgNameC = cleanText(govOrgName, 200, 'Organ nomi')
    const caseC = cleanText(govCaseId, 100, 'Ish raqami')
    if (!reasonC.ok || !orgNameC.ok || !caseC.ok) {
      const bad = [reasonC, orgNameC, caseC].find(c => !c.ok) as { ok: false; error: string }
      res.status(400).json({ success: false, error: bad.error })
      return
    }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
    if (!entity || entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    // Check if already in blacklist
    const existing = await (prisma as any).ekoHisobBlacklist.findUnique({ where: { entityId } })
    if (existing) {
      res.status(409).json({ success: false, error: "Bu tashkilot allaqachon qora ro'yxatda" })
      return
    }

    // Use transaction to update entity status and create blacklist entry
    let blacklistEntry
    try {
      const out = await (prisma as any).$transaction([
        (prisma as any).ekoHisobBlacklist.create({
          data: {
            entityId,
            reason: reasonC.value,
            addedBy: user.id,
            govOrgName: orgNameC.value,
            govCaseId: caseC.value,
          },
        }),
        (prisma as any).ekoHisobLegalEntity.update({
          where: { id: entityId },
          data: { status: 'blacklisted' },
        }),
      ])
      blacklistEntry = out[0]
    } catch (e: any) {
      // entityId unikal: ikki so'rov bir vaqtda kelsa ikkinchisi shu yerga tushadi
      if (e?.code === 'P2002') {
        res.status(409).json({ success: false, error: "Bu tashkilot allaqachon qora ro'yxatda" })
        return
      }
      throw e
    }

    await logEkoAudit(user, {
      action: 'blacklist.add', targetType: 'blacklist', targetId: entityId, targetName: entity.name,
      details: { previousStatus: entity.status, reason: reasonC.value, govOrgName: orgNameC.value, govCaseId: caseC.value },
    })

    res.status(201).json({ success: true, data: blacklistEntry })
  } catch (err) { next(err) }
}

export async function updateBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params
    const { status, reason, govOrgName, govCaseId } = req.body ?? {}

    const entry = await (prisma as any).ekoHisobBlacklist.findUnique({
      where: { id },
      include: { entity: { select: { id: true, name: true, orgId: true, districtId: true, status: true } } },
    })
    // IDOR: boshqa tuman yozuvini o'zgartirib bo'lmaydi (inspektor/boshliq uchun)
    if (!entry || !canAccessEntity(user, entry.entity)) {
      res.status(404).json({ success: false, error: "Qora ro'yxat yozuvi topilmadi" })
      return
    }

    const data: any = {}
    if (status !== undefined) {
      const allowed = ['active', 'resolved']
      if (!allowed.includes(status)) {
        res.status(400).json({ success: false, error: "Status noto'g'ri. Mumkin: active, resolved" })
        return
      }
      data.status = status
    }
    if (reason !== undefined) {
      const c = cleanText(reason, 1000, 'Sabab')
      if (!c.ok) { res.status(400).json({ success: false, error: c.error }); return }
      if (!c.value) { res.status(400).json({ success: false, error: "Sabab bo'sh bo'lmasin" }); return }
      data.reason = c.value
    }
    if (govOrgName !== undefined) {
      const c = cleanText(govOrgName, 200, 'Organ nomi')
      if (!c.ok) { res.status(400).json({ success: false, error: c.error }); return }
      data.govOrgName = c.value
    }
    if (govCaseId !== undefined) {
      const c = cleanText(govCaseId, 100, 'Ish raqami')
      if (!c.ok) { res.status(400).json({ success: false, error: c.error }); return }
      data.govCaseId = c.value
    }

    const ops: any[] = [(prisma as any).ekoHisobBlacklist.update({ where: { id }, data })]
    const details: Record<string, unknown> = { changes: data }

    if (data.status === 'resolved' && entry.status !== 'resolved') {
      // Faqat HOZIR 'blacklisted' bo'lgan tashkilotga tegamiz; avvalgi holatga (inactive/draft ham) qaytaramiz
      if (entry.entity.status === 'blacklisted') {
        const prev = await previousEntityStatus(user.orgId, entry.entityId)
        ops.push((prisma as any).ekoHisobLegalEntity.update({ where: { id: entry.entityId }, data: { status: prev } }))
        details.restoredStatus = prev
      }
    } else if (data.status === 'active' && entry.status === 'resolved') {
      // Qayta faollashtirildi — tashkilot yana qora ro'yxatda bo'lishi kerak
      if (entry.entity.status !== 'blacklisted' && entry.entity.status !== 'deleted') {
        ops.push((prisma as any).ekoHisobLegalEntity.update({ where: { id: entry.entityId }, data: { status: 'blacklisted' } }))
        details.previousStatus = entry.entity.status
      }
    }

    const results = await (prisma as any).$transaction(ops)

    await logEkoAudit(user, {
      action: 'blacklist.update', targetType: 'blacklist', targetId: entry.entityId, targetName: entry.entity.name, details,
    })

    res.json({ success: true, data: results[0] })
  } catch (err) { next(err) }
}

export async function removeFromBlacklist(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    const entry = await (prisma as any).ekoHisobBlacklist.findUnique({
      where: { id },
      include: { entity: { select: { id: true, name: true, orgId: true, districtId: true, status: true } } },
    })
    if (!entry || !canAccessEntity(user, entry.entity)) {
      res.status(404).json({ success: false, error: "Qora ro'yxat yozuvi topilmadi" })
      return
    }

    // Tashkilot holati faqat 'blacklisted' bo'lsa o'zgaradi (qo'lda 'inactive' qilingan bo'lsa tegilmaydi)
    const restore = entry.entity.status === 'blacklisted'
      ? await previousEntityStatus(user.orgId, entry.entity.id)
      : null

    await (prisma as any).$transaction([
      (prisma as any).ekoHisobBlacklist.delete({ where: { id } }),
      ...(restore
        ? [(prisma as any).ekoHisobLegalEntity.update({ where: { id: entry.entity.id }, data: { status: restore } })]
        : []),
    ])

    await logEkoAudit(user, {
      action: 'blacklist.remove', targetType: 'blacklist', targetId: entry.entity.id, targetName: entry.entity.name,
      details: { reason: entry.reason, blacklistStatus: entry.status, restoredStatus: restore },
    })

    res.json({ success: true, data: null, message: "Qora ro'yxatdan olib tashlandi" })
  } catch (err) { next(err) }
}
