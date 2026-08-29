// Savdo — xarajat hisobga olish (ijara/transport/ish haqi ...).
// Maqsad: sof foyda = yalpi foyda - davr xarajatlari.
// Hisob mantiqi lib/expenseMath.ts'da (sof funksiyalar, testlangan) — bu yerda
// faqat validatsiya, tenant tekshiruvi va DB amallari.
// Xarajat O'CHIRILMAYDI — cancelled=true bilan bekor qilinadi (audit izi),
// purchases.ts'dagi cancelPurchase pattern bilan bir xil.

import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { ensureSavdoActor } from '../lib/savdoActor'
import { paginate, paginatedResponse, buildDateRangeFilter } from '../../../types'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import { SavdoError } from '../lib/savdoError'
import {
  isValidCategory,
  sumExpenses,
  groupExpensesByCategory,
  EXPENSE_CATEGORY_LABELS,
} from '../lib/expenseMath'

// Bir nol ortiq yozilgan summani ushlash uchun yuqori chegara
// (savdoPaymentService.ts'dagi MAX_PAYMENT bilan bir xil g'oya).
const MAX_EXPENSE = 1_000_000_000

function buildWhere(orgId: string, q: Record<string, string>): any {
  const where: any = { orgId }
  if (q.category) where.category = q.category
  if (q.warehouseId) where.warehouseId = q.warehouseId
  const dateFilter = buildDateRangeFilter(q.from, q.to)
  if (dateFilter) where.spentAt = dateFilter
  return where
}

/** Sana matnini xavfsiz Date'ga aylantiradi; noto'g'ri bo'lsa null. */
function parseDate(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null
  const d = new Date(String(raw))
  return isNaN(d.getTime()) ? null : d
}

async function assertWarehouse(warehouseId: string, orgId: string): Promise<void> {
  const wh = await (prisma as any).savdoWarehouse.findUnique({ where: { id: warehouseId } })
  if (!wh || wh.orgId !== orgId) throw new SavdoError('Ombor topilmadi', 404)
}

export async function listExpenses(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const { page, limit, skip } = paginate(req.query)
    const where = buildWhere(orgId, q)

    const [total, rows, allRows] = await Promise.all([
      (prisma as any).savdoExpense.count({ where }),
      (prisma as any).savdoExpense.findMany({
        where, skip, take: limit,
        include: { warehouse: { select: { id: true, name: true } } },
        orderBy: { spentAt: 'desc' },
      }),
      // Xulosa BUTUN filtr bo'yicha hisoblanadi (faqat joriy sahifa emas)
      (prisma as any).savdoExpense.findMany({
        where, select: { category: true, amount: true, cancelled: true },
      }),
    ])

    const plain = allRows.map((r: any) => ({
      category: r.category,
      amount: Number(r.amount),
      cancelled: r.cancelled,
    }))
    const summary = {
      totalAmount: sumExpenses(plain),
      byCategory: groupExpensesByCategory(plain),
    }

    const body = paginatedResponse(rows, total, page, limit)
    res.json({ ...body, summary })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function createExpense(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { category, amount, spentAt, note, warehouseId } = req.body

    if (!isValidCategory(category)) {
      res.status(400).json({ success: false, error: 'Kategoriya noto\'g\'ri' })
      return
    }
    const sum = Number(amount)
    if (!Number.isFinite(sum) || sum <= 0) {
      res.status(400).json({ success: false, error: 'Summa musbat son bo\'lishi kerak' })
      return
    }
    if (sum > MAX_EXPENSE) {
      res.status(400).json({ success: false, error: 'Summa juda katta — bir nol ortiq yozilmadimi?' })
      return
    }
    const date = parseDate(spentAt)
    if (spentAt && !date) {
      res.status(400).json({ success: false, error: 'Sana noto\'g\'ri' })
      return
    }
    if (warehouseId) await assertWarehouse(String(warehouseId), orgId)

    const createdById = await ensureSavdoActor(actor)

    const expense = await (prisma as any).savdoExpense.create({
      data: {
        orgId,
        category,
        amount: sum,
        spentAt: date || new Date(),
        note: note ? String(note).trim() || null : null,
        warehouseId: warehouseId || null,
        createdById,
      },
      include: { warehouse: { select: { id: true, name: true } } },
    })

    res.status(201).json({ success: true, data: expense, message: 'Xarajat qayd etildi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function updateExpense(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const { id } = req.params
    const { category, amount, spentAt, note, warehouseId } = req.body

    const existing = await (prisma as any).savdoExpense.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Xarajat topilmadi' })
      return
    }
    if (existing.cancelled) {
      res.status(400).json({ success: false, error: 'Bekor qilingan xarajatni tahrirlab bo\'lmaydi' })
      return
    }

    const data: any = {}

    if (category !== undefined) {
      if (!isValidCategory(category)) {
        res.status(400).json({ success: false, error: 'Kategoriya noto\'g\'ri' })
        return
      }
      data.category = category
    }
    if (amount !== undefined) {
      const sum = Number(amount)
      if (!Number.isFinite(sum) || sum <= 0) {
        res.status(400).json({ success: false, error: 'Summa musbat son bo\'lishi kerak' })
        return
      }
      if (sum > MAX_EXPENSE) {
        res.status(400).json({ success: false, error: 'Summa juda katta — bir nol ortiq yozilmadimi?' })
        return
      }
      data.amount = sum
    }
    if (spentAt !== undefined) {
      const date = parseDate(spentAt)
      if (!date) {
        res.status(400).json({ success: false, error: 'Sana noto\'g\'ri' })
        return
      }
      data.spentAt = date
    }
    if (note !== undefined) data.note = note ? String(note).trim() || null : null
    if (warehouseId !== undefined) {
      if (warehouseId) await assertWarehouse(String(warehouseId), orgId)
      data.warehouseId = warehouseId || null
    }

    const updated = await (prisma as any).savdoExpense.update({
      where: { id },
      data,
      include: { warehouse: { select: { id: true, name: true } } },
    })

    res.json({ success: true, data: updated, message: 'Xarajat yangilandi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

// O'chirmaydi — bekor qiladi (kim va qachon bekor qilgani saqlanadi).
export async function cancelExpense(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.savdoUser!
    const { orgId } = actor
    const { id } = req.params

    const existing = await (prisma as any).savdoExpense.findUnique({ where: { id } })
    if (!existing || existing.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Xarajat topilmadi' })
      return
    }
    if (existing.cancelled) {
      res.status(400).json({ success: false, error: 'Bu xarajat allaqachon bekor qilingan' })
      return
    }

    const cancelledById = await ensureSavdoActor(actor)

    await (prisma as any).savdoExpense.update({
      where: { id },
      data: { cancelled: true, cancelledById, cancelledAt: new Date() },
    })

    res.json({ success: true, data: null, message: 'Xarajat bekor qilindi' })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function exportExpensesXlsx(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const q = req.query as Record<string, string>
    const where = buildWhere(orgId, q)

    const rows = await (prisma as any).savdoExpense.findMany({
      where,
      include: { warehouse: { select: { name: true } } },
      orderBy: { spentAt: 'desc' },
    })

    const { wb, ws } = newWorkbook('Xarajatlar')
    ws.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Kategoriya', key: 'category', width: 18 },
      { header: 'Summa', key: 'amount', width: 16 },
      { header: 'Ombor', key: 'warehouse', width: 18 },
      { header: 'Izoh', key: 'note', width: 32 },
      { header: 'Holat', key: 'status', width: 16 },
    ]
    for (const r of rows) {
      ws.addRow({
        date: new Date(r.spentAt).toLocaleDateString('uz-UZ'),
        category: EXPENSE_CATEGORY_LABELS[r.category] || r.category,
        amount: Number(r.amount),
        warehouse: r.warehouse?.name || '',
        note: r.note || '',
        status: r.cancelled ? 'Bekor qilingan' : 'Faol',
      })
    }

    // JAMI qatori — faqat bekor qilinmagan xarajatlar
    const total = sumExpenses(rows.map((r: any) => ({ amount: Number(r.amount), cancelled: r.cancelled })))
    const totalRow = ws.addRow({ date: 'JAMI', amount: total })
    totalRow.font = { bold: true }

    styleWorksheet(ws)
    await sendWorkbook(wb, 'xarajatlar.xlsx', res)
  } catch (err) { next(err) }
}
