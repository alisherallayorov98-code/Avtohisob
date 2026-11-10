import { Response, NextFunction } from 'express'
import { formatUzDate, formatUzDateTime } from '../../../lib/dateFormat'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { computeExpectedBalance, computeDiscrepancy } from '../lib/kassaSmena'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'

/** Smenalar ro'yxati uchun umumiy filtr — ro'yxat va Excel eksport bir xil shartdan foydalanadi. */
function buildSmenaWhere(orgId: string, q: Record<string, string>): any {
  const where: any = { orgId }
  if (q.warehouseId) where.warehouseId = q.warehouseId
  if (q.status) where.status = q.status
  const dateFilter = buildDateRangeFilter(q.from, q.to)
  if (dateFilter) where.openedAt = dateFilter
  return where
}

/**
 * Berilgan smenalar bo'yicha sotuv soni va summasini BITTA groupBy so'rovi bilan oladi
 * (N+1 so'rovdan qochish). Faqat 'completed' sotuvlar kassaga tushgan deb hisoblanadi.
 */
async function loadSaleTotals(smenaIds: string[]): Promise<Map<string, { count: number; total: number }>> {
  const map = new Map<string, { count: number; total: number }>()
  if (smenaIds.length === 0) return map
  const rows = await (prisma as any).savdoSale.groupBy({
    by: ['kassaSmenaId'],
    where: { kassaSmenaId: { in: smenaIds }, status: 'completed' },
    _sum: { totalAmount: true },
    _count: { _all: true },
  })
  for (const r of rows) {
    map.set(r.kassaSmenaId, { count: r._count?._all ?? 0, total: Number(r._sum?.totalAmount ?? 0) })
  }
  return map
}

/** Yopilmagan smenada saqlangan qiymat yo'q — kutilgan qoldiq joyida hisoblanadi. */
function resolveExpected(smena: any, salesTotal: number): number {
  return smena.expectedBalance !== null && smena.expectedBalance !== undefined
    ? Number(smena.expectedBalance)
    : computeExpectedBalance(Number(smena.openingBalance), [salesTotal])
}

export async function getCurrentSmena(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { warehouseId } = req.query as Record<string, string>
    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }

    const smena = await (prisma as any).savdoKassaSmena.findFirst({
      where: { orgId, warehouseId, status: 'open' },
      orderBy: { openedAt: 'desc' },
    })
    res.json({ success: true, data: smena })
  } catch (err) { next(err) }
}

export async function listSmenas(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where = buildSmenaWhere(orgId, q)

    const [total, smenas] = await Promise.all([
      (prisma as any).savdoKassaSmena.count({ where }),
      (prisma as any).savdoKassaSmena.findMany({
        where, skip, take: limit,
        include: { warehouse: { select: { id: true, name: true } } },
        orderBy: { openedAt: 'desc' },
      }),
    ])

    const totals = await loadSaleTotals(smenas.map((s: any) => s.id))
    const data = smenas.map((s: any) => {
      const t = totals.get(s.id) ?? { count: 0, total: 0 }
      const expectedBalance = resolveExpected(s, t.total)
      const closing = s.closingBalance !== null && s.closingBalance !== undefined ? Number(s.closingBalance) : null
      const discrepancy = s.discrepancy !== null && s.discrepancy !== undefined
        ? Number(s.discrepancy)
        : (closing !== null ? computeDiscrepancy(closing, expectedBalance) : null)
      return { ...s, salesCount: t.count, salesTotal: t.total, expectedBalance, discrepancy }
    })

    res.json(paginatedResponse(data, total, page, limit))
  } catch (err) { next(err) }
}

export async function openSmena(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { warehouseId, openingBalance } = req.body

    if (!warehouseId) {
      res.status(400).json({ success: false, error: 'warehouseId talab qilinadi' })
      return
    }
    const warehouse = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
    if (!warehouse || warehouse.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Ombor topilmadi' })
      return
    }

    const existing = await (prisma as any).savdoKassaSmena.findFirst({
      where: { orgId, warehouseId, status: 'open' },
    })
    if (existing) {
      res.status(409).json({ success: false, error: 'Bu omborda allaqachon ochiq smena bor' })
      return
    }

    const openedById = await ensureSavdoActor(actor)
    try {
      const smena = await (prisma as any).savdoKassaSmena.create({
        data: {
          orgId, warehouseId, openedById,
          openingBalance: Number(openingBalance) || 0,
        },
      })
      res.status(201).json({ success: true, data: smena, message: 'Smena ochildi' })
    } catch (createErr: any) {
      // DB'dagi qisman unique indeks (bitta omborga bitta ochiq smena) —
      // yuqoridagi findFirst tekshiruvi bilan poyga holatida ikkalasi ham
      // "yo'q" ko'rib qolishi mumkin edi, shu yerda DB darajasida ushlanadi.
      if (createErr?.code === 'P2002' || /unique/i.test(String(createErr?.message))) {
        res.status(409).json({ success: false, error: 'Bu omborda allaqachon ochiq smena bor' })
        return
      }
      throw createErr
    }
  } catch (err) { next(err) }
}

export async function closeSmena(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { id } = req.params
    const { closingBalance } = req.body

    const smena = await (prisma as any).savdoKassaSmena.findUnique({ where: { id } })
    if (!smena || smena.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Smena topilmadi' })
      return
    }
    if (smena.status !== 'open') {
      res.status(409).json({ success: false, error: 'Smena allaqachon yopilgan' })
      return
    }
    if (closingBalance === undefined || !Number.isFinite(Number(closingBalance))) {
      res.status(400).json({ success: false, error: 'closingBalance talab qilinadi' })
      return
    }

    const sales = await (prisma as any).savdoSale.findMany({
      where: { kassaSmenaId: id, status: 'completed' },
      select: { totalAmount: true },
    })
    const expectedBalance = computeExpectedBalance(
      Number(smena.openingBalance),
      sales.map((s: any) => Number(s.totalAmount)),
    )
    const discrepancy = computeDiscrepancy(Number(closingBalance), expectedBalance)
    const closedById = await ensureSavdoActor(actor)

    const updated = await (prisma as any).savdoKassaSmena.update({
      where: { id },
      data: {
        status: 'closed',
        closingBalance: Number(closingBalance),
        expectedBalance,
        discrepancy,
        closedById,
        closedAt: new Date(),
      },
    })
    res.json({ success: true, data: updated, message: 'Smena yopildi' })
  } catch (err) { next(err) }
}

export async function getSmenaReport(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params

    const smena = await (prisma as any).savdoKassaSmena.findUnique({
      where: { id },
      include: { warehouse: { select: { id: true, name: true } } },
    })
    if (!smena || smena.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Smena topilmadi' })
      return
    }

    const sales = await (prisma as any).savdoSale.findMany({
      where: { kassaSmenaId: id },
      select: {
        id: true, documentNumber: true, totalAmount: true, saleType: true,
        status: true, createdAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const completed = sales.filter((s: any) => s.status === 'completed')
    const cancelled = sales.filter((s: any) => s.status === 'cancelled')
    const salesTotal = completed.reduce((sum: number, s: any) => sum + Number(s.totalAmount), 0)
    const cancelledTotal = cancelled.reduce((sum: number, s: any) => sum + Number(s.totalAmount), 0)

    const openingBalance = Number(smena.openingBalance)
    const expectedBalance = resolveExpected(smena, salesTotal)
    const closingBalance = smena.closingBalance !== null && smena.closingBalance !== undefined
      ? Number(smena.closingBalance)
      : null
    const discrepancy = smena.discrepancy !== null && smena.discrepancy !== undefined
      ? Number(smena.discrepancy)
      : (closingBalance !== null ? computeDiscrepancy(closingBalance, expectedBalance) : null)

    res.json({
      success: true,
      data: {
        ...smena,
        sales: sales.map((s: any) => ({
          id: s.id,
          documentNumber: s.documentNumber,
          totalAmount: Number(s.totalAmount),
          saleType: s.saleType,
          status: s.status,
          createdAt: s.createdAt,
          customerName: s.customer?.name ?? null,
        })),
        summary: {
          salesCount: completed.length,
          salesTotal,
          cancelledCount: cancelled.length,
          cancelledTotal,
          openingBalance,
          expectedBalance,
          closingBalance,
          discrepancy,
        },
      },
    })
  } catch (err) { next(err) }
}

export async function exportSmenasXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const where = buildSmenaWhere(orgId, q)

    const smenas = await (prisma as any).savdoKassaSmena.findMany({
      where,
      include: { warehouse: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
    })
    const totals = await loadSaleTotals(smenas.map((s: any) => s.id))

    const { wb, ws } = newWorkbook('Kassa smenalar')
    ws.columns = [
      { header: 'Ochilgan', key: 'openedAt', width: 18 },
      { header: 'Yopilgan', key: 'closedAt', width: 18 },
      { header: 'Ombor', key: 'warehouse', width: 20 },
      { header: 'Ochilish', key: 'opening', width: 14 },
      { header: 'Sotuv summasi', key: 'sales', width: 16 },
      { header: 'Kutilgan', key: 'expected', width: 14 },
      { header: 'Haqiqiy', key: 'closing', width: 14 },
      { header: 'Farq', key: 'discrepancy', width: 14 },
      { header: 'Holat', key: 'status', width: 12 },
    ]

    let sumOpening = 0, sumSales = 0, sumExpected = 0, sumClosing = 0, sumDiscrepancy = 0
    for (const s of smenas) {
      const t = totals.get(s.id) ?? { count: 0, total: 0 }
      const opening = Number(s.openingBalance)
      const expected = resolveExpected(s, t.total)
      const closing = s.closingBalance !== null && s.closingBalance !== undefined ? Number(s.closingBalance) : null
      const discrepancy = s.discrepancy !== null && s.discrepancy !== undefined
        ? Number(s.discrepancy)
        : (closing !== null ? computeDiscrepancy(closing, expected) : null)

      sumOpening += opening
      sumSales += t.total
      sumExpected += expected
      sumClosing += closing ?? 0
      sumDiscrepancy += discrepancy ?? 0

      ws.addRow({
        openedAt: formatUzDateTime(new Date(s.openedAt)),
        closedAt: s.closedAt ? formatUzDateTime(new Date(s.closedAt)) : '',
        warehouse: s.warehouse?.name || '',
        opening,
        sales: t.total,
        expected,
        closing: closing ?? '',
        discrepancy: discrepancy ?? '',
        status: s.status === 'open' ? 'Ochiq' : 'Yopilgan',
      })
    }

    styleWorksheet(ws)

    // JAMI qatori styleWorksheet'dan KEYIN qo'shiladi — zebra fon/chegara unga tegmasin.
    const totalRow = ws.addRow({
      openedAt: 'JAMI',
      closedAt: '',
      warehouse: '',
      opening: sumOpening,
      sales: sumSales,
      expected: sumExpected,
      closing: sumClosing,
      discrepancy: sumDiscrepancy,
      status: '',
    })
    totalRow.eachCell(cell => { cell.font = { bold: true } })

    await sendWorkbook(wb, 'kassa-smenalar.xlsx', res)
  } catch (err) { next(err) }
}
