import { Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { generateArticleCode } from '../services/articleCodeService'
import { getSearchVariants } from '../lib/transliterate'
import { resolveOrgId, getOrgFilter, getOrgWarehouseIds } from '../lib/orgFilter'

// Legacy null = migration'gacha yozuvlar — joriy org foydalanuvchilariga ko'rsatamiz,
// yozish paytida take-ownership bilan biriktiriladi.
function orgFilterBlock(orgId: string | null) {
  if (!orgId) return null // super_admin: filter yo'q
  return { OR: [{ organizationId: orgId }, { organizationId: null }] }
}

async function assertSparePartAccess(id: string, orgId: string | null) {
  const sp = await (prisma as any).sparePart.findUnique({
    where: { id },
    select: { organizationId: true },
  })
  if (!sp) throw new AppError('Ehtiyot qism topilmadi', 404)
  if (orgId && sp.organizationId && sp.organizationId !== orgId)
    throw new AppError("Bu ehtiyot qismga kirish huquqingiz yo'q", 403)
  return sp
}

export async function getSpareParts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, category, supplierId, isActive, select: selectAll } = req.query as any
    const orgId = await resolveOrgId(req.user!)
    const and: any[] = []
    const orgBlock = orgFilterBlock(orgId)
    if (orgBlock) and.push(orgBlock)
    if (search) {
      const variants = getSearchVariants(search)
      and.push({
        OR: variants.flatMap(v => [
          { name: { contains: v, mode: 'insensitive' } },
          { partCode: { contains: v, mode: 'insensitive' } },
        ]),
      })
    }
    if (category) and.push({ category })
    if (supplierId) and.push({ supplierId })
    if (isActive !== undefined) and.push({ isActive: isActive === 'true' })
    const where: any = and.length ? { AND: and } : {}

    // select=true: dropdown uchun — limit cheklovisiz, faqat kerakli maydonlar
    if (selectAll === 'true') {
      const spareParts = await prisma.sparePart.findMany({
        where,
        select: { id: true, name: true, partCode: true },
        orderBy: { name: 'asc' },
      })
      return res.json({ success: true, data: spareParts, meta: { total: spareParts.length, page: 1, limit: spareParts.length, totalPages: 1 } })
    }

    const [total, spareParts] = await Promise.all([
      prisma.sparePart.count({ where }),
      prisma.sparePart.findMany({
        where, skip, take: limit,
        include: {
          supplier: { select: { id: true, name: true } },
          inventories: { select: { quantityOnHand: true, warehouseId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // Attach total quantity across all warehouses
    const data = (spareParts as any[]).map(sp => ({
      ...sp,
      totalQuantity: sp.inventories.reduce((s: number, i: any) => s + i.quantityOnHand, 0),
    }))

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const sp = await (prisma as any).sparePart.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        inventories: { include: { warehouse: { select: { id: true, name: true } } } },
      },
    })
    if (!sp) throw new AppError('Ehtiyot qism topilmadi', 404)
    if (orgId && sp.organizationId && sp.organizationId !== orgId)
      throw new AppError("Bu ehtiyot qismga kirish huquqingiz yo'q", 403)
    res.json(successResponse(sp))
  } catch (err) { next(err) }
}

export async function createSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { name, partCode, category, unitPrice, supplierId, description,
      warehouseId, initialQuantity, reorderLevel } = req.body
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined

    // Optional: boshlang'ich ombor kirimi — miqdor > 0 bo'lsa sklad majburiy va org'ga tegishli bo'lishi shart
    const qty = initialQuantity !== undefined && initialQuantity !== '' ? parseInt(String(initialQuantity), 10) : 0
    if (qty > 0) {
      if (!warehouseId) throw new AppError("Miqdor kiritilgan bo'lsa sklad tanlanishi shart", 400)
      const filter = await getOrgFilter(req.user!)
      if (filter.type !== 'none') {
        const allowed = await getOrgWarehouseIds(filter)
        if (allowed !== null && !allowed.includes(warehouseId))
          throw new AppError("Bu ombor sizning tashkilotingizga tegishli emas", 403)
      }
    }

    const sp = await prisma.$transaction(async (tx) => {
      const created = await (tx as any).sparePart.create({
        data: { name, partCode, category, unitPrice: parseFloat(unitPrice), supplierId, description, imageUrl, organizationId: orgId },
        include: { supplier: { select: { id: true, name: true } } },
      })
      if (qty > 0 && warehouseId) {
        await tx.inventory.create({
          data: {
            sparePartId: created.id,
            warehouseId,
            quantityOnHand: qty,
            reorderLevel: reorderLevel ? parseInt(String(reorderLevel), 10) : 5,
            lastRestockDate: new Date(),
          },
        })
      }
      return created
    })

    // Avtomatik artikul generatsiya (non-blocking)
    generateArticleCode(sp.id).catch(() => {})

    res.status(201).json(successResponse(sp, 'Ehtiyot qism qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await assertSparePartAccess(req.params.id, orgId)
    const { name, partCode, category, unitPrice, supplierId, description, isActive } = req.body
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined
    // Legacy null sparePart tahrir qilinsa — joriy org'ga biriktiriladi (take ownership)
    const takeOwnership = existing.organizationId === null && orgId ? { organizationId: orgId } : {}
    const sp = await (prisma as any).sparePart.update({
      where: { id: req.params.id },
      data: {
        ...takeOwnership,
        ...(name && { name }),
        ...(partCode && { partCode }),
        ...(category && { category }),
        ...(unitPrice !== undefined && { unitPrice: parseFloat(unitPrice) }),
        ...(supplierId && { supplierId }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(imageUrl && { imageUrl }),
      },
      include: { supplier: { select: { id: true, name: true } } },
    })
    res.json(successResponse(sp, 'Ehtiyot qism yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    await assertSparePartAccess(req.params.id, orgId)
    await prisma.sparePart.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json(successResponse(null, 'Ehtiyot qism o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getNextPartCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { base } = req.query as { base: string }
    if (!base) return res.json(successResponse({ code: '' }))

    // prefix = letters+dash part, e.g. "BAT-001" → "BAT-"
    const match = base.match(/^([A-Za-z]+-?)/)
    const prefix = match ? match[1].toUpperCase() : base.toUpperCase().slice(0, 4) + '-'

    const and: any[] = [{ partCode: { startsWith: prefix, mode: 'insensitive' } }]
    const orgBlock = orgFilterBlock(orgId)
    if (orgBlock) and.push(orgBlock)
    const existing = await (prisma as any).sparePart.findMany({
      where: { AND: and },
      select: { partCode: true },
    })

    const nums = existing
      .map((e: any) => parseInt(e.partCode.replace(prefix, ''), 10))
      .filter((n: number) => !isNaN(n))
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
    const code = `${prefix}${String(next).padStart(3, '0')}`
    res.json(successResponse({ code }))
  } catch (err) { next(err) }
}

export async function generateAllArticleCodes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    // Artikulsiz barcha ehtiyot qismlarni topib, avtomatik kod beradi (faqat o'z org)
    const and: any[] = [{ articleCode: null }]
    const orgBlock = orgFilterBlock(orgId)
    if (orgBlock) and.push(orgBlock)
    const parts = await (prisma as any).sparePart.findMany({
      where: { AND: and },
      select: { id: true },
    })
    let generated = 0
    for (const part of parts) {
      await generateArticleCode(part.id).catch(() => {})
      generated++
    }
    res.json(successResponse({ generated }, `${generated} ta ehtiyot qismga artikul berildi`))
  } catch (err) { next(err) }
}

export async function getLowStock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    // Org'ga tegishli warehouse'lar ro'yxati (null = super_admin, cheklov yo'q)
    const allowedWarehouses = filter.type !== 'none' ? await getOrgWarehouseIds(filter) : null

    const branchId = ['branch_manager', 'operator'].includes(req.user!.role)
      ? req.user!.branchId
      : (req.query.branchId as string) || undefined

    // Tenant: faqat foydalanuvchi org'iga tegishli warehouse'lar, so'ngra branchId bilan filter
    const lowStock = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT i.id, i.quantity_on_hand, i.reorder_level, i.branch_id,
             sp.name AS spare_part_name, sp.part_code, sp.category,
             b.name AS branch_name
      FROM inventory i
      JOIN spare_parts sp ON sp.id = i.spare_part_id
      JOIN branches b ON b.id = i.branch_id
      WHERE i.quantity_on_hand <= i.reorder_level
      ${allowedWarehouses !== null
        ? Prisma.sql`AND i.warehouse_id IN (${Prisma.join(allowedWarehouses.length ? allowedWarehouses : [''])})`
        : Prisma.empty}
      ${branchId ? Prisma.sql`AND i.branch_id = ${branchId}::uuid` : Prisma.empty}
      ORDER BY (i.quantity_on_hand - i.reorder_level) ASC
    `)
    res.json(successResponse(lowStock))
  } catch (err) { next(err) }
}
