// Savdo — mahsulot katalogini Excel orqali ommaviy yuklash (import).
// Oqim: shablon yuklab olish → fayl tanlash → /preview (tekshiruv) → /confirm (yozish).
// Sof tekshiruv mantiqi lib/productImport.ts da (testlangan), bu yerda faqat I/O.

import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { newWorkbook, styleWorksheet, sendWorkbook } from '../lib/xlsx'
import { SavdoError } from '../lib/savdoError'
import {
  parseProductRows, summarizeImport, RawProductRow, ParsedProductRow,
} from '../lib/productImport'

const MAX_ROWS = 2000

/** Ustunlar tartibi: SKU | Nomi | Kategoriya | Birlik | Optom narx | Chakana narx */
async function readProductUpload(buffer: Buffer): Promise<RawProductRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)
  const ws = wb.worksheets[0]
  if (!ws) throw new SavdoError('Faylda varaq topilmadi')

  const rows: RawProductRow[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return // sarlavha
    const values = (row.values as unknown[]).slice(1)
    // Butunlay bo'sh qatorlar o'tkazib yuboriladi (Excel oxiridagi "quyruq")
    const hasAny = values.slice(0, 6).some(v => v !== null && v !== undefined && String(v).trim() !== '')
    if (!hasAny) return
    rows.push({
      sku: values[0],
      name: values[1],
      category: values[2],
      unit: values[3],
      wholesalePrice: values[4],
      retailPrice: values[5],
    })
  })
  return rows
}

function actionOf(row: ParsedProductRow, existing: Set<string>): 'create' | 'update' | 'invalid' {
  if (row.errors.length > 0) return 'invalid'
  return existing.has(row.sku) ? 'update' : 'create'
}

async function loadExistingSkus(orgId: string, skus: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(skus.filter(Boolean)))
  if (unique.length === 0) return new Set()
  const found = await (prisma as any).savdoProduct.findMany({
    where: { orgId, sku: { in: unique } },
    select: { sku: true },
  })
  return new Set(found.map((p: any) => p.sku as string))
}

export async function previewProductImport(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Excel fayl tanlanmadi' })
      return
    }

    const raw = await readProductUpload(req.file.buffer)
    if (raw.length === 0) {
      res.status(400).json({ success: false, error: 'Faylda hech qanday qator topilmadi' })
      return
    }
    if (raw.length > MAX_ROWS) {
      res.status(400).json({ success: false, error: `Fayl juda katta: ${raw.length} qator. Chegara — ${MAX_ROWS} qator` })
      return
    }

    const parsed = parseProductRows(raw)
    const existing = await loadExistingSkus(orgId, parsed.map(p => p.sku))
    const summary = summarizeImport(parsed, existing)
    const rows = parsed.map(r => ({ ...r, action: actionOf(r, existing) }))

    res.json({ success: true, data: { rows, summary } })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function confirmProductImport(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const bodyRows = req.body?.rows

    if (!Array.isArray(bodyRows) || bodyRows.length === 0) {
      res.status(400).json({ success: false, error: 'Yuklash uchun qator yo\'q' })
      return
    }
    if (bodyRows.length > MAX_ROWS) {
      res.status(400).json({ success: false, error: `Fayl juda katta: ${bodyRows.length} qator. Chegara — ${MAX_ROWS} qator` })
      return
    }

    // Klient yuborgan holatga ISHONMAYMIZ — serverda qaytadan tekshiramiz.
    const parsed = parseProductRows(bodyRows.map((r: any) => ({
      sku: r?.sku, name: r?.name, category: r?.category,
      unit: r?.unit, wholesalePrice: r?.wholesalePrice, retailPrice: r?.retailPrice,
    })))

    const valid = parsed.filter(r => r.errors.length === 0)
    const skipped = parsed.length - valid.length
    if (valid.length === 0) {
      res.status(400).json({ success: false, error: 'Barcha qatorlar xato — yuklanmadi' })
      return
    }

    const existing = await loadExistingSkus(orgId, valid.map(r => r.sku))

    let created = 0
    let updated = 0
    await prisma.$transaction(async (tx: any) => {
      for (const row of valid) {
        const data = {
          name: row.name,
          category: row.category,
          unit: row.unit,
          wholesalePrice: row.wholesalePrice,
          retailPrice: row.retailPrice,
        }
        if (existing.has(row.sku)) {
          await tx.savdoProduct.update({
            where: { orgId_sku: { orgId, sku: row.sku } },
            data,
          })
          updated++
        } else {
          await tx.savdoProduct.create({ data: { orgId, sku: row.sku, ...data } })
          created++
        }
      }
    })

    res.json({
      success: true,
      data: { created, updated, skipped },
      message: `${created} ta yangi, ${updated} ta yangilandi, ${skipped} ta o'tkazib yuborildi`,
    })
  } catch (err) {
    if (err instanceof SavdoError) {
      res.status(err.statusCode).json({ success: false, error: err.message })
      return
    }
    next(err)
  }
}

export async function downloadProductTemplateXlsx(_req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { wb, ws } = newWorkbook('Mahsulotlar')
    ws.columns = [
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Nomi', key: 'name', width: 30 },
      { header: 'Kategoriya', key: 'category', width: 18 },
      { header: 'Birlik', key: 'unit', width: 10 },
      { header: 'Optom narx', key: 'wholesalePrice', width: 14 },
      { header: 'Chakana narx', key: 'retailPrice', width: 14 },
    ]
    ws.addRow({ sku: 'A-001', name: 'Namuna mahsulot', category: 'Ehtiyot qism', unit: 'dona', wholesalePrice: 10000, retailPrice: 12000 })
    ws.addRow({ sku: 'A-002', name: 'Namuna moy 5L', category: 'Moy', unit: 'litr', wholesalePrice: 45000, retailPrice: 52000 })
    styleWorksheet(ws)
    await sendWorkbook(wb, 'mahsulot-shablon.xlsx', res)
  } catch (err) { next(err) }
}
