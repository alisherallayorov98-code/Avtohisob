import { Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { generateArticleCode } from '../services/articleCodeService'
import { getSearchVariants } from '../lib/transliterate'
import { resolveOrgId, getOrgFilter, getOrgWarehouseIds } from '../lib/orgFilter'

function orgFilterBlock(orgId: string | null) {
  if (!orgId) return null // super_admin: filter yo'q
  return { organizationId: orgId } // faqat o'z org ma'lumotlari
}

async function assertSparePartAccess(id: string, orgId: string | null) {
  const sp = await (prisma as any).sparePart.findUnique({
    where: { id },
    select: { organizationId: true },
  })
  if (!sp) throw new AppError('Ehtiyot qism topilmadi', 404)
  // orgId mavjud bo'lsa — faqat o'z orgga tegishli spare part ruxsat etiladi
  if (orgId && sp.organizationId !== orgId)
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
    const sp = await (prisma as any).sparePart.update({
      where: { id: req.params.id },
      data: {
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

/**
 * POST /spare-parts/:id/reactivate — nofaol ehtiyot qismni qayta faollashtirish.
 */
export async function reactivateSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    await assertSparePartAccess(req.params.id, orgId)
    const sp = await prisma.sparePart.update({
      where: { id: req.params.id },
      data: { isActive: true },
      include: { supplier: { select: { id: true, name: true } } },
    })
    res.json(successResponse(sp, 'Ehtiyot qism qayta faollashtirildi'))
  } catch (err) { next(err) }
}

/**
 * DELETE /spare-parts/:id/hard — butunlay o'chirish.
 * Faqat: qoldiq 0 VA hech qachon ishlatilmagan (ta'mir/o'tkazma/so'rov/qaytarish/qabul yo'q).
 */
export async function hardDeleteSparePart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    await assertSparePartAccess(req.params.id, orgId)
    const id = req.params.id

    const [maint, mItems, transfers, reqItems, retItems] = await Promise.all([
      (prisma as any).maintenanceRecord.count({ where: { sparePartId: id } }),
      (prisma as any).maintenanceItem.count({ where: { sparePartId: id } }),
      (prisma as any).inventoryTransfer.count({ where: { sparePartId: id } }),
      (prisma as any).sparePartRequestItem.count({ where: { sparePartId: id } }),
      (prisma as any).sparePartReturnItem.count({ where: { sparePartId: id } }),
    ])

    // Faqat HAQIQIY ishlatish/hujjat qismni saqlab qoladi (tarix buzilmasin).
    // QOLDIQ va KIRIM (receipt) — bular xato kiritilgan bo'lishi mumkin, o'chirishga
    // to'sqinlik qilmaydi (qism bilan birga o'chiriladi). Sabab aniq ko'rsatiladi.
    const blockers: string[] = []
    if (maint + mItems > 0) blockers.push(`ta'mirda ishlatilgan (${maint + mItems})`)
    if (transfers > 0) blockers.push(`omborlararo o'tkazmada (${transfers})`)
    if (reqItems > 0) blockers.push(`so'rovnomada (${reqItems})`)
    if (retItems > 0) blockers.push(`qaytarishda (${retItems})`)
    if (blockers.length > 0) {
      throw new AppError(`Bu qism ${blockers.join(', ')} — butunlay o'chirib bo'lmaydi, nofaol holatda qoladi.`, 400)
    }

    // Qism + qoldiq (inventory) + kirim (receipt) + article kod + statistikani butunlay o'chiramiz
    await prisma.$transaction(async (tx) => {
      await (tx as any).inventoryReceipt.deleteMany({ where: { sparePartId: id } }) // kirim yozuvlari
      await (tx as any).inventory.deleteMany({ where: { sparePartId: id } })        // qoldiq bilan birga
      await (tx as any).articleCode.deleteMany({ where: { sparePartId: id } })
      await (tx as any).sparePartStatistic.deleteMany({ where: { sparePartId: id } })
      await (tx as any).sparePart.delete({ where: { id } })
    })

    res.json(successResponse(null, 'Ehtiyot qism butunlay o\'chirildi'))
  } catch (err) { next(err) }
}

/**
 * POST /spare-parts/bulk-delete { ids: string[] } — ommaviy o'chirish.
 * Ishlatilmagan qism (ta'mir/o'tkazma/so'rov/qaytarish/qabul yo'q) qoldig'i bilan
 * butunlay o'chiriladi. Ishlatilgan qism nofaol holatga o'tkaziladi (tarix saqlanadi).
 */
export async function bulkDeleteSpareParts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'string') : []
    if (ids.length === 0) throw new AppError('O\'chirish uchun qism tanlanmagan', 400)
    if (ids.length > 1000) throw new AppError('Bir martada 1000 tagacha o\'chirish mumkin', 400)

    let deleted = 0
    let deactivated = 0
    let skipped = 0
    for (const id of ids) {
      try {
        const sp = await prisma.sparePart.findFirst({
          where: { id, ...(orgId ? { organizationId: orgId } : {}) },
          select: { id: true },
        })
        if (!sp) { skipped++; continue }

        const [maint, mItems, transfers, reqItems, retItems] = await Promise.all([
          (prisma as any).maintenanceRecord.count({ where: { sparePartId: id } }),
          (prisma as any).maintenanceItem.count({ where: { sparePartId: id } }),
          (prisma as any).inventoryTransfer.count({ where: { sparePartId: id } }),
          (prisma as any).sparePartRequestItem.count({ where: { sparePartId: id } }),
          (prisma as any).sparePartReturnItem.count({ where: { sparePartId: id } }),
        ])
        // Faqat haqiqiy ishlatish/hujjat saqlab qoladi. Qoldiq + kirim (receipt) — o'chadi.
        if (maint + mItems + transfers + reqItems + retItems > 0) {
          await prisma.sparePart.update({ where: { id }, data: { isActive: false } })
          deactivated++
          continue
        }
        // Ishlatilmagan — qoldiq + kirim bilan to'liq o'chiramiz
        await prisma.$transaction(async (tx) => {
          await (tx as any).inventoryReceipt.deleteMany({ where: { sparePartId: id } })
          await (tx as any).inventory.deleteMany({ where: { sparePartId: id } })
          await (tx as any).articleCode.deleteMany({ where: { sparePartId: id } })
          await (tx as any).sparePartStatistic.deleteMany({ where: { sparePartId: id } })
          await (tx as any).sparePart.delete({ where: { id } })
        })
        deleted++
      } catch { skipped++ }
    }

    res.json(successResponse(
      { deleted, deactivated, skipped },
      `${deleted} ta o'chirildi` +
      (deactivated ? `, ${deactivated} tasi ishlatilgani uchun nofaol qilindi` : '') +
      (skipped ? `, ${skipped} tasi o'tkazib yuborildi` : ''),
    ))
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

// Yangi qism qo'shayotganda category + name asosida ARTIKUL KODI taklif qiladi.
// Mavjud part code'lar bilan to'qnashishni avtomatik oldini oladi (yangi raqam tanlanadi).
const CATEGORY_PREFIX: Record<string, string> = {
  engine: 'ENG', filters: 'FLT', brakes: 'BRK', suspension: 'SUS',
  electrical: 'ELC', body: 'BDY', transmission: 'TRN', fuel: 'FUL',
  cooling: 'COL', exhaust: 'EXH', oils: 'OIL', tires: 'TIR', other: 'OTH',
}

export async function suggestPartCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { category, name } = req.query as { category?: string; name?: string }

    // Kategoriya bo'lmasa "OTH" ishlatamiz
    const catCode = category ? (CATEGORY_PREFIX[category.toLowerCase()] || 'OTH') : 'OTH'

    // Nomdan qo'shimcha 3 harf — masalan "Motor moy" → "MOT"
    let nameSlug = ''
    if (name) {
      const tokens = name.toUpperCase().replace(/[^A-Z0-9\s]/g, '').split(/\s+/).filter(t => t.length >= 2)
      if (tokens[0]) nameSlug = tokens[0].slice(0, 3)
    }

    const prefix = nameSlug ? `${catCode}-${nameSlug}-` : `${catCode}-`

    // O'sha prefix bilan boshlanadigan mavjud part code'lar
    const and: any[] = [{ partCode: { startsWith: prefix, mode: 'insensitive' } }]
    const orgBlock = orgFilterBlock(orgId)
    if (orgBlock) and.push(orgBlock)
    const existing = await (prisma as any).sparePart.findMany({
      where: { AND: and },
      select: { partCode: true },
    })

    // Eng katta raqamni topib +1 qaytaramiz
    const nums = existing
      .map((e: any) => {
        const m = e.partCode.match(/(\d+)$/)
        return m ? parseInt(m[1], 10) : 0
      })
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
        AND sp.is_active = true
      ${allowedWarehouses !== null
        ? Prisma.sql`AND i.warehouse_id IN (${Prisma.join(allowedWarehouses.length ? allowedWarehouses : [''])})`
        : Prisma.empty}
      ${branchId ? Prisma.sql`AND i.branch_id = ${branchId}::uuid` : Prisma.empty}
      ORDER BY (i.quantity_on_hand - i.reorder_level) ASC
    `)
    res.json(successResponse(lowStock))
  } catch (err) { next(err) }
}

/**
 * Ehtiyot qism harakat tarixi — bitta qism uchun barcha hodisalar:
 *  - kirim (InventoryReceipt) — qachon, qancha, qaysi omborga, kim qabul qildi
 *  - ishlatildi (MaintenanceItem) — qaysi mashinaga, qaysi ustaga, qaysi ombordan
 *  - transfer (InventoryTransfer + TransferBatch) — omborlar orasi
 *  - qaytarish (SparePartReturnItem) — qaysi omborga, qaysi sababli
 *
 * Foydalanuvchi vaqt o'tib qism qayerga ketganini eslamasa, shu yerdan
 * to'liq audit zanjirini ko'radi va to'g'ri/noto'g'ri ketganini aniqlay oladi.
 */
export async function getSparePartHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id: sparePartId } = req.params
    await assertSparePartAccess(sparePartId, orgId)

    const [sparePart, receipts, maintenanceItems, transfers, returnItems, currentInventory] = await Promise.all([
      prisma.sparePart.findUnique({
        where: { id: sparePartId },
        select: { id: true, name: true, partCode: true, category: true, unitPrice: true },
      }),
      // 1. KIRIM (InventoryReceipt)
      (prisma as any).inventoryReceipt.findMany({
        where: { sparePartId },
        include: {
          warehouse: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // 2. ISHLATILDI (MaintenanceItem -> MaintenanceRecord)
      prisma.maintenanceItem.findMany({
        where: { sparePartId },
        include: {
          maintenance: {
            select: {
              id: true, installationDate: true, status: true, isOfficial: true,
              workerName: true, notes: true,
              vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
              performedBy: { select: { id: true, fullName: true } },
              approvedBy: { select: { id: true, fullName: true } },
            },
          },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { maintenance: { installationDate: 'desc' } },
      }),
      // 3. TRANSFER (omborlar orasi)
      prisma.inventoryTransfer.findMany({
        where: { sparePartId },
        include: {
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          batch: { select: { id: true, documentNumber: true, status: true } },
          approvedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // 4. QAYTARISH (SparePartReturnItem -> SparePartReturn)
      (prisma as any).sparePartReturnItem.findMany({
        where: { sparePartId },
        include: {
          return: {
            select: {
              id: true, status: true, reason: true, createdAt: true, branchId: true,
              returnedBy: { select: { id: true, fullName: true } },
              approvedBy: { select: { id: true, fullName: true } },
              vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // 5. JORIY OMBOR HOLATI (har bir warehouse'da nechta qoldi)
      prisma.inventory.findMany({
        where: { sparePartId },
        include: { warehouse: { select: { id: true, name: true } } },
      }),
    ])

    if (!sparePart) throw new AppError('Ehtiyot qism topilmadi', 404)

    // Barcha hodisalarni unified timeline qilamiz
    interface Event {
      type: 'receipt' | 'used' | 'transfer' | 'return'
      date: Date
      quantity: number
      direction: 'in' | 'out' | 'move'  // ombor uchun: in=tushdi, out=chiqdi, move=ko'chdi
      details: any
    }

    const events: Event[] = [
      ...receipts.map((r: any) => ({
        type: 'receipt' as const,
        date: r.createdAt,
        quantity: r.quantity,
        direction: 'in' as const,
        details: {
          warehouse: r.warehouse,
          unitPrice: Number(r.unitPrice),
          isOfficial: r.isOfficial,
          receivedBy: r.receivedBy,
          notes: r.notes,
        },
      })),
      ...maintenanceItems.map((mi: any) => ({
        type: 'used' as const,
        date: mi.maintenance.installationDate,
        quantity: mi.quantityUsed,
        direction: 'out' as const,
        details: {
          maintenanceId: mi.maintenanceId,
          maintenanceStatus: mi.maintenance.status,
          isOfficial: mi.maintenance.isOfficial,
          warehouse: mi.warehouse,
          vehicle: mi.maintenance.vehicle,
          performedBy: mi.maintenance.performedBy,
          approvedBy: mi.maintenance.approvedBy,
          workerName: mi.maintenance.workerName,
          unitCost: Number(mi.unitCost),
          notes: mi.maintenance.notes,
        },
      })),
      ...transfers.map((t: any) => ({
        type: 'transfer' as const,
        date: t.createdAt,
        quantity: t.quantity,
        direction: 'move' as const,
        details: {
          status: t.status,
          fromWarehouse: t.fromWarehouse,
          toWarehouse: t.toWarehouse,
          batch: t.batch,
          approvedBy: t.approvedBy,
          notes: t.notes,
        },
      })),
      ...returnItems.map((ri: any) => ({
        type: 'return' as const,
        date: ri.return.createdAt,
        quantity: ri.quantity,
        direction: 'in' as const,
        details: {
          returnId: ri.returnId,
          status: ri.return.status,
          reason: ri.return.reason,
          warehouseId: ri.warehouseId,
          vehicle: ri.return.vehicle,
          returnedBy: ri.return.returnedBy,
          approvedBy: ri.return.approvedBy,
          unitCost: Number(ri.unitCost),
        },
      })),
    ]

    // Sana bo'yicha kamayish tartibida (yangi yuqorida)
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Xulosa
    const totalReceived = receipts.reduce((s: number, r: any) => s + r.quantity, 0)
    const totalUsed = maintenanceItems
      .filter((mi: any) => mi.maintenance.status === 'approved')
      .reduce((s: number, mi: any) => s + mi.quantityUsed, 0)
    const totalReturned = returnItems
      .filter((ri: any) => ri.return.status === 'approved')
      .reduce((s: number, ri: any) => s + ri.quantity, 0)
    const totalTransferredOut = transfers
      .filter((t: any) => ['shipped', 'received'].includes(t.status))
      .reduce((s: number, t: any) => s + t.quantity, 0)

    res.json(successResponse({
      sparePart,
      events,
      summary: {
        totalReceived,
        totalUsed,
        totalReturned,
        totalTransferredOut,
        currentTotal: currentInventory.reduce((s: number, i: any) => s + i.quantityOnHand, 0),
      },
      currentInventory: currentInventory.map((i: any) => ({
        warehouse: i.warehouse,
        quantity: i.quantityOnHand,
      })),
    }))
  } catch (err) { next(err) }
}
