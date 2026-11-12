import { Response, NextFunction } from 'express'
import { formatUzDate } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { createSale, cancelSale, updateSale, CreateSaleLineInput } from '../services/saleService'
import { SavdoError } from '../lib/savdoError'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import { ownerScopeFilter, canSeeCost, stripCostFields } from '../lib/savdoPermissions'

function normalizeSaleLines(lines: any[]): CreateSaleLineInput[] {
  return lines.map((l: any) => ({
    productId: l.productId,
    quantity: Number(l.quantity),
    unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
  }))
}

export async function exportSalesXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const q = req.query as Record<string, string>
    const where: any = { orgId }
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter
    // "Faqat o'ziniki" doirasi — kassir/xodim hamkasbining savdosini ko'rmaydi
    const scope = ownerScopeFilter(actor.role, 'sales.viewAll', 'soldById', actor.id)
    if (scope) Object.assign(where, scope)
    const showCost = canSeeCost(actor.role)

    const sales = await (prisma as any).savdoSale.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const { wb, ws } = newWorkbook('Savdo')
    ws.columns = [
      { header: 'Faktura', key: 'doc', width: 16 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Mijoz', key: 'customer', width: 22 },
      { header: 'Ombor', key: 'warehouse', width: 18 },
      { header: 'Turi', key: 'type', width: 10 },
      { header: 'Summa', key: 'total', width: 14 },
      { header: 'QQS', key: 'vat', width: 12 },
      // Tannarx/foyda ustunlari faqat ularni ko'rish huquqi bo'lganlarga
      ...(showCost ? [
        { header: 'Tannarx', key: 'cost', width: 14 },
        { header: 'Foyda', key: 'profit', width: 14 },
      ] : []),
    ]
    for (const s of sales) {
      const total = Number(s.totalAmount)
      const cost = Number(s.totalCost)
      ws.addRow({
        doc: s.documentNumber, date: formatUzDate(new Date(s.createdAt)),
        customer: s.customer?.name || '', warehouse: s.warehouse.name,
        type: s.saleType === 'pos' ? 'Kassa' : 'Faktura',
        total, vat: Number(s.vatAmount || 0),
        ...(showCost ? { cost, profit: total - cost - Number(s.vatAmount || 0) } : {}),
      })
    }
    styleWorksheet(ws)
    await sendWorkbook(wb, 'savdo.xlsx', res)
  } catch (err) { next(err) }
}

export async function listSales(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)

    const where: any = { orgId }
    const scope = ownerScopeFilter(actor.role, 'sales.viewAll', 'soldById', actor.id)
    if (scope) Object.assign(where, scope)
    if (q.customerId) where.customerId = q.customerId
    if (q.warehouseId) where.warehouseId = q.warehouseId
    if (q.saleType) where.saleType = q.saleType
    const dateFilter = buildDateRangeFilter(q.from, q.to)
    if (dateFilter) where.createdAt = dateFilter

    const [total, sales] = await Promise.all([
      (prisma as any).savdoSale.count({ where }),
      (prisma as any).savdoSale.findMany({
        where, skip, take: limit,
        include: {
          customer: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          lines: { select: { id: true, quantity: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    res.json(paginatedResponse(stripCostFields(actor.role, sales), total, page, limit))
  } catch (err) { next(err) }
}

export async function getSale(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { id } = req.params

    const sale = await (prisma as any).savdoSale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        warehouse: { select: { id: true, name: true } },
        lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    })
    if (!sale || sale.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Sotuv topilmadi' })
      return
    }
    // Ko'rish doirasi cheklangan rol (kassir/xodim) begona sotuvga "topilmadi"
    // javobini oladi — 403 emas, 404: boshqa xodimda shunday hujjat borligi
    // ham oshkor bo'lmasin.
    const scope = ownerScopeFilter(actor.role, 'sales.viewAll', 'soldById', actor.id)
    if (scope && sale.soldById !== actor.id) {
      res.status(404).json({ success: false, error: 'Sotuv topilmadi' })
      return
    }
    res.json({ success: true, data: stripCostFields(actor.role, sale) })
  } catch (err) { next(err) }
}

export async function createSaleHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { warehouseId, customerId, lines, notes, vatRate } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta qator kerak' })
      return
    }

    const soldById = await ensureSavdoActor(actor)

    const sale = await createSale({
      orgId: actor.orgId,
      warehouseId,
      customerId: customerId || null,
      saleType: 'invoice',
      soldById,
      notes: notes || null,
      vatRate: vatRate !== undefined && vatRate !== '' ? Number(vatRate) : null,
      lines: normalizeSaleLines(lines),
    })

    res.status(201).json({ success: true, data: sale, message: `Faktura ${sale.documentNumber} yaratildi` })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

// Kassa/POS — tezkor sotish. POS sotuvi darhol to'liq naqd to'langan deb
// hisoblanadi (kassa smena hisob-kitobi shunga tayanadi). Ochiq smena
// bo'lishi shart. Mijoz ko'rsatilsa to'lov yozuvi createSale bilan BIR XIL
// tranzaksiyada yoziladi (autoSettleCustomerId) — sotuv "completed" bo'lib,
// to'lov yozish keyin muvaffaqiyatsiz bo'lib qolishining oldini oladi.
export async function createPosSaleHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { warehouseId, customerId, lines } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ success: false, error: 'Kamida bitta qator kerak' })
      return
    }

    const smena = await (prisma as any).savdoKassaSmena.findFirst({
      where: { orgId: actor.orgId, warehouseId, status: 'open' },
    })
    if (!smena) {
      res.status(409).json({ success: false, error: 'Bu omborda ochiq kassa smenasi yo\'q — avval smenani oching' })
      return
    }

    const soldById = await ensureSavdoActor(actor)

    const sale = await createSale({
      orgId: actor.orgId,
      warehouseId,
      customerId: customerId || null,
      saleType: 'pos',
      kassaSmenaId: smena.id,
      soldById,
      autoSettleCustomerId: customerId || null,
      lines: normalizeSaleLines(lines),
    })

    res.status(201).json({ success: true, data: sale, message: `Sotuv ${sale.documentNumber} yakunlandi` })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

// Sotuvni bekor qilish — faqat admin. Joyida o'zgartirmaydi, teskari
// tranzaksiya bilan qoldiq/tannarx qatlamini aniq tiklaydi (saleService.cancelSale).
export async function cancelSaleHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { id } = req.params
    const { reason } = req.body

    const cancelledById = await ensureSavdoActor(actor)
    const sale = await cancelSale({ orgId: actor.orgId, saleId: id, cancelledById, reason: reason || null })

    res.json({ success: true, data: sale, message: 'Sotuv bekor qilindi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

// Admin: tasdiqlangan sotuvni "qayta ochib" tahrirlash — eski sarf teskari
// qaytariladi, yangi qatorlar shu hujjat raqami ostida qo'llanadi (BIR tranzaksiya).
export async function updateSaleHandler(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { customerId, notes, lines, vatRate } = req.body
    const sale = await updateSale({
      orgId: actor.orgId,
      saleId: req.params.id,
      customerId,
      notes,
      lines: Array.isArray(lines) ? normalizeSaleLines(lines) : undefined,
      vatRate: vatRate !== undefined ? (vatRate === '' || vatRate === null ? null : Number(vatRate)) : undefined,
    })
    res.json({ success: true, data: sale, message: 'Sotuv yangilandi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}
