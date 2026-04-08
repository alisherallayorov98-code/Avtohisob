import { Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { prisma } from '../lib/prisma'
import ExcelJS from 'exceljs'

// Parse CSV line respecting quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += ch }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text: string): { headers: string[], rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = parseCSVLine(lines[0])
  const rows = lines.slice(1).map(line => {
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] || '' })
    return row
  })
  return { headers, rows }
}

// Preview CSV without importing
export async function previewImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type, csvText } = req.body
    if (!csvText || !type) return res.status(400).json({ error: 'type va csvText talab qilinadi' })

    const { headers, rows } = parseCSV(csvText)
    if (!rows.length) return res.status(400).json({ error: 'CSV bo\'sh yoki noto\'g\'ri format' })

    // Validate based on type
    const errors: string[] = []
    const validRows: any[] = []

    if (type === 'vehicles') {
      const required = ['registrationNumber', 'brand', 'model', 'year', 'fuelType']
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowErrors: string[] = []
        required.forEach(f => { if (!row[f]) rowErrors.push(`${f} bo'sh`) })
        if (row.year && isNaN(parseInt(row.year))) rowErrors.push('year raqam bo\'lishi kerak')
        if (row.fuelType && !['petrol', 'diesel', 'gas', 'electric'].includes(row.fuelType.toLowerCase()))
          rowErrors.push('fuelType: petrol/diesel/gas/electric')
        if (rowErrors.length) errors.push(`Qator ${i + 2}: ${rowErrors.join(', ')}`)
        else validRows.push(row)
      }
    } else if (type === 'fuel') {
      const required = ['vehicleId', 'fuelType', 'amountLiters', 'cost', 'odometerReading', 'refuelDate']
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowErrors: string[] = []
        required.forEach(f => { if (!row[f]) rowErrors.push(`${f} bo'sh`) })
        if (rowErrors.length) errors.push(`Qator ${i + 2}: ${rowErrors.join(', ')}`)
        else validRows.push(row)
      }
    } else if (type === 'spare_parts') {
      const required = ['name', 'partCode', 'category', 'unitPrice', 'supplierId']
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowErrors: string[] = []
        required.forEach(f => { if (!row[f]) rowErrors.push(`${f} bo'sh`) })
        if (rowErrors.length) errors.push(`Qator ${i + 2}: ${rowErrors.join(', ')}`)
        else validRows.push(row)
      }
    } else if (type === 'inventory') {
      const required = ['partCode', 'branchName', 'quantity']
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowErrors: string[] = []
        required.forEach(f => { if (!row[f]) rowErrors.push(`${f} bo'sh`) })
        if (row.quantity && isNaN(parseInt(row.quantity))) rowErrors.push('quantity raqam bo\'lishi kerak')
        if (rowErrors.length) errors.push(`Qator ${i + 2}: ${rowErrors.join(', ')}`)
        else validRows.push(row)
      }
    } else if (type === 'suppliers') {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowErrors: string[] = []
        if (!row.name) rowErrors.push('name bo\'sh')
        if (!row.phone) rowErrors.push('phone bo\'sh')
        if (rowErrors.length) errors.push(`Qator ${i + 2}: ${rowErrors.join(', ')}`)
        else validRows.push(row)
      }
    }

    res.json({
      data: {
        type, headers, totalRows: rows.length,
        validRows: validRows.length, errorCount: errors.length,
        errors: errors.slice(0, 20), // show max 20 errors
        preview: rows.slice(0, 5),   // show first 5 rows
      }
    })
  } catch (err) { next(err) }
}

export async function importData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type, csvText, branchId } = req.body
    if (!csvText || !type) return res.status(400).json({ error: 'type va csvText talab qilinadi' })

    const { rows } = parseCSV(csvText)
    let imported = 0; let skipped = 0; const errors: string[] = []

    if (type === 'vehicles') {
      // Get default branch
      const branch = branchId
        ? await prisma.branch.findUnique({ where: { id: branchId } })
        : await prisma.branch.findFirst()
      if (!branch) return res.status(400).json({ error: 'Filial topilmadi' })

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const existing = await prisma.vehicle.findUnique({ where: { registrationNumber: row.registrationNumber } })
          if (existing) { skipped++; continue }

          // Resolve branchId: from row branchName, or row branchId, or default branch
          let resolvedBranchId = branch.id
          if (row.branchName) {
            const found = await prisma.branch.findFirst({ where: { name: { equals: row.branchName, mode: 'insensitive' } } })
            if (found) resolvedBranchId = found.id
            else { errors.push(`Qator ${i + 2}: "${row.branchName}" nomli filial topilmadi`); skipped++; continue }
          } else if (row.branchId) {
            resolvedBranchId = row.branchId
          }

          await prisma.vehicle.create({
            data: {
              registrationNumber: row.registrationNumber,
              brand: row.brand,
              model: row.model,
              year: parseInt(row.year),
              fuelType: row.fuelType.toLowerCase() as any,
              branchId: resolvedBranchId,
              purchaseDate: row.purchaseDate ? new Date(row.purchaseDate) : new Date(),
              mileage: row.mileage ? parseFloat(row.mileage) : 0,
              notes: row.notes || null,
            }
          })
          imported++
        } catch (e: any) {
          errors.push(`Qator ${i + 2}: ${e.message}`)
          skipped++
        }
      }
    } else if (type === 'fuel') {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          await prisma.fuelRecord.create({
            data: {
              vehicleId: row.vehicleId,
              fuelType: row.fuelType.toLowerCase() as any,
              amountLiters: parseFloat(row.amountLiters),
              cost: parseFloat(row.cost),
              odometerReading: parseFloat(row.odometerReading),
              refuelDate: new Date(row.refuelDate),
              createdById: req.user!.id,
              supplierId: row.supplierId || null,
            }
          })
          imported++
        } catch (e: any) {
          errors.push(`Qator ${i + 2}: ${e.message}`)
          skipped++
        }
      }
    } else if (type === 'spare_parts') {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const existing = await prisma.sparePart.findUnique({ where: { partCode: row.partCode } })
          if (existing) { skipped++; continue }
          await prisma.sparePart.create({
            data: {
              name: row.name, partCode: row.partCode,
              category: row.category, unitPrice: parseFloat(row.unitPrice),
              supplierId: row.supplierId, description: row.description || null,
            }
          })
          imported++
        } catch (e: any) {
          errors.push(`Qator ${i + 2}: ${e.message}`)
          skipped++
        }
      }
    } else if (type === 'inventory') {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const part = await prisma.sparePart.findFirst({ where: { partCode: row.partCode } })
          if (!part) { errors.push(`Qator ${i + 2}: "${row.partCode}" kodli ehtiyot qism topilmadi`); skipped++; continue }
          const branch = await prisma.branch.findFirst({ where: { name: { equals: row.branchName, mode: 'insensitive' } } })
          if (!branch) { errors.push(`Qator ${i + 2}: "${row.branchName}" nomli filial topilmadi`); skipped++; continue }
          const qty = parseInt(row.quantity) || 0
          const reorder = parseInt(row.reorderLevel) || 5
          await prisma.inventory.upsert({
            where: { sparePartId_branchId: { sparePartId: part.id, branchId: branch.id } },
            create: { sparePartId: part.id, branchId: branch.id, quantityOnHand: qty, reorderLevel: reorder },
            update: { quantityOnHand: { increment: qty } },
          })
          imported++
        } catch (e: any) {
          errors.push(`Qator ${i + 2}: ${e.message}`)
          skipped++
        }
      }
    } else if (type === 'suppliers') {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          if (!row.name || !row.phone) { errors.push(`Qator ${i + 2}: name va phone majburiy`); skipped++; continue }
          await prisma.supplier.create({
            data: {
              name: row.name,
              phone: row.phone,
              email: row.email || null,
              address: row.address || null,
              contactPerson: row.contactPerson || null,
            }
          })
          imported++
        } catch (e: any) {
          errors.push(`Qator ${i + 2}: ${e.message}`)
          skipped++
        }
      }
    } else {
      return res.status(400).json({ error: 'Noma\'lum tur' })
    }

    res.json({
      data: {
        type, total: rows.length, imported, skipped,
        errorCount: errors.length, errors: errors.slice(0, 20),
      }
    })
  } catch (err) { next(err) }
}

// ── Excel fayl yuklash orqali import ─────────────────────────────────────
export async function importFromExcel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type } = req.body
    const file = (req as any).file as Express.Multer.File
    if (!file) return res.status(400).json({ error: 'Excel fayl yuborilmadi' })
    if (!type) return res.status(400).json({ error: 'type talab qilinadi' })

    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (wb.xlsx as any).load(file.buffer)
    const ws = wb.worksheets[0]
    if (!ws) return res.status(400).json({ error: 'Excel varaq topilmadi' })

    // Row 1 = English keys (parser keys), Row 2 = Uzbek labels (skip), Row 3+ = data
    const keyRow = ws.getRow(1)
    const keys: string[] = []
    keyRow.eachCell((cell) => { keys.push(String(cell.value || '').trim()) })

    // Check if row 2 is a label row (if first cell != key cell from row 3+, skip it)
    // We determine data start: if row 2 looks like a hint row, skip it
    let dataStartRow = 2
    const row2First = String(ws.getRow(2).getCell(1).value || '').trim()
    // If row 2 first cell doesn't look like data (is italic/grey hint), skip
    // Simple heuristic: if row 2 first cell contains spaces and Cyrillic, it's a label row
    if (/[а-яёА-ЯЁa-zA-Z ]/.test(row2First) && row2First !== keys[0]) {
      dataStartRow = 3
    }

    const rows: Record<string, string>[] = []
    ws.eachRow((row, rowNum) => {
      if (rowNum <= dataStartRow - 1) return
      const obj: Record<string, string> = {}
      let hasData = false
      keys.forEach((key, i) => {
        const val = String(row.getCell(i + 1).value ?? '').trim()
        if (val) hasData = true
        obj[key] = val
      })
      if (hasData) rows.push(obj)
    })

    if (!rows.length) return res.status(400).json({ error: 'Excel faylda ma\'lumot yo\'q' })

    // Convert to CSV text format and reuse existing parser logic
    const header = keys.join(',')
    const csvLines = rows.map(r => keys.map(k => `"${(r[k] || '').replace(/"/g, '""')}"`).join(','))
    const csvText = [header, ...csvLines].join('\n')

    // Return same format as previewImport
    res.json({ data: { csvText, rowCount: rows.length, keys } })
  } catch (err) { next(err) }
}

// ── Excel shablonlar ─────────────────────────────────────────────────────
type ColDef = { key: string; label: string; width: number; note: string; required?: boolean }

const TEMPLATE_CONFIGS: Record<string, { title: string; cols: ColDef[]; examples: Record<string, any>[] }> = {
  vehicles: {
    title: 'Avtomobillar import shabloni',
    cols: [
      { key: 'registrationNumber', label: 'Davlat raqami', width: 16, note: 'Masalan: 01A123AA', required: true },
      { key: 'brand',              label: 'Marka',          width: 14, note: 'Toyota, Chevrolet...', required: true },
      { key: 'model',              label: 'Model',          width: 14, note: 'Camry, Malibu...', required: true },
      { key: 'year',               label: 'Yil',            width: 8,  note: '2010-2025', required: true },
      { key: 'fuelType',           label: 'Yoqilg\'i turi', width: 16, note: 'petrol | diesel | gas | electric', required: true },
      { key: 'branchName',         label: 'Filial nomi',    width: 22, note: 'Tizimda mavjud filial nomi', required: true },
      { key: 'mileage',            label: 'Yurish (km)',    width: 14, note: 'Raqam, masalan: 50000' },
      { key: 'purchaseDate',       label: 'Sotib olingan',  width: 16, note: 'YYYY-MM-DD, masalan: 2020-01-15' },
      { key: 'notes',              label: 'Izoh',           width: 22, note: 'Ixtiyoriy' },
    ],
    examples: [
      { registrationNumber: '01A123AA', brand: 'Toyota', model: 'Camry', year: 2020, fuelType: 'petrol', branchName: 'Asosiy filial', mileage: 50000, purchaseDate: '2020-01-15', notes: '' },
      { registrationNumber: '01B456BB', brand: 'Chevrolet', model: 'Malibu', year: 2021, fuelType: 'petrol', branchName: '2-filial', mileage: 30000, purchaseDate: '2021-06-20', notes: '' },
      { registrationNumber: '01C789CC', brand: 'Hyundai', model: 'Elantra', year: 2022, fuelType: 'petrol', branchName: 'Asosiy filial', mileage: 15000, purchaseDate: '2022-03-10', notes: '' },
    ],
  },
  spare_parts: {
    title: 'Ehtiyot qismlar import shabloni',
    cols: [
      { key: 'name',        label: 'Nomi',             width: 28, note: 'Masalan: Moy filtri', required: true },
      { key: 'partCode',    label: 'Artikul (kod)',     width: 16, note: 'Noyob kod, mas: MF-001', required: true },
      { key: 'category',    label: 'Kategoriya',        width: 18, note: 'engine | brake | suspension | electrical | body | other', required: true },
      { key: 'unitPrice',   label: 'Narxi (so\'m)',     width: 16, note: 'Raqam, masalan: 25000', required: true },
      { key: 'supplierId',  label: 'Yetkazuvchi ID',    width: 38, note: 'UUID (Yetkazuvchilar sahifasidan)', required: true },
      { key: 'description', label: 'Tavsif',            width: 28, note: 'Ixtiyoriy' },
    ],
    examples: [
      { name: 'Moy filtri', partCode: 'MF-001', category: 'engine', unitPrice: 25000, supplierId: 'YETKAZUVCHI-UUID', description: 'Yog\' filtri' },
      { name: 'Tormoz kolodkasi', partCode: 'TK-002', category: 'brake', unitPrice: 85000, supplierId: 'YETKAZUVCHI-UUID', description: '' },
      { name: 'Havo filtri', partCode: 'HF-003', category: 'engine', unitPrice: 18000, supplierId: 'YETKAZUVCHI-UUID', description: 'Havo tozalagichi' },
    ],
  },
  inventory: {
    title: 'Ombor stok import shabloni',
    cols: [
      { key: 'partCode',    label: 'Artikul (kod)',     width: 16, note: 'Mavjud ehtiyot qism kodi', required: true },
      { key: 'branchName',  label: 'Filial nomi',       width: 22, note: 'Tizimda mavjud filial nomi', required: true },
      { key: 'quantity',    label: 'Miqdor (dona)',      width: 14, note: 'Raqam, masalan: 10', required: true },
      { key: 'reorderLevel',label: 'Min. daraja',        width: 14, note: 'Kam qolganda ogohlantirish chegarasi' },
    ],
    examples: [
      { partCode: 'MF-001', branchName: 'Asosiy filial', quantity: 10, reorderLevel: 3 },
      { partCode: 'TK-002', branchName: 'Asosiy filial', quantity: 5, reorderLevel: 2 },
      { partCode: 'HF-003', branchName: '2-filial', quantity: 8, reorderLevel: 2 },
    ],
  },
  suppliers: {
    title: 'Yetkazuvchilar import shabloni',
    cols: [
      { key: 'name',          label: 'Nomi',            width: 26, note: 'Masalan: "Avtoehtiyot" MChJ', required: true },
      { key: 'phone',         label: 'Telefon',         width: 16, note: '+998901234567', required: true },
      { key: 'email',         label: 'Email',           width: 24, note: 'info@company.uz (ixtiyoriy)' },
      { key: 'contactPerson', label: 'Mas\'ul shaxs',   width: 22, note: 'Ism Familiya' },
      { key: 'address',       label: 'Manzil',          width: 28, note: 'Shahar, ko\'cha...' },
    ],
    examples: [
      { name: '"Avtoehtiyot" MChJ', phone: '+998901234567', email: 'info@avtoehtiyot.uz', contactPerson: 'Alisher Karimov', address: 'Toshkent, Yunusobod' },
      { name: 'Nemat Magazin', phone: '+998931234567', email: '', contactPerson: 'Nemat Toshmatov', address: 'Toshkent, Chilonzor' },
    ],
  },
  fuel: {
    title: 'Yoqilg\'i yozuvlari import shabloni',
    cols: [
      { key: 'vehicleId',      label: 'Mashina ID',        width: 38, note: 'UUID — Avtomobillar sahifasidan ko\'chiring', required: true },
      { key: 'fuelType',       label: 'Yoqilg\'i turi',    width: 16, note: 'petrol | diesel | gas | electric', required: true },
      { key: 'amountLiters',   label: 'Miqdor (litr)',      width: 14, note: 'Raqam, masalan: 50', required: true },
      { key: 'cost',           label: 'Narxi (so\'m)',      width: 16, note: 'Raqam, masalan: 400000', required: true },
      { key: 'odometerReading',label: 'Odometr (km)',       width: 16, note: 'Raqam, masalan: 55000', required: true },
      { key: 'refuelDate',     label: 'Sana',              width: 14, note: 'YYYY-MM-DD, masalan: 2024-01-15', required: true },
      { key: 'supplierId',     label: 'Yetkazuvchi ID',    width: 38, note: 'UUID (ixtiyoriy)' },
    ],
    examples: [
      { vehicleId: 'MASHINA-UUID-BU-YERGA', fuelType: 'petrol', amountLiters: 50, cost: 400000, odometerReading: 55000, refuelDate: '2024-01-15', supplierId: '' },
    ],
  },
}

export async function getTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type } = req.params
    const cfg = TEMPLATE_CONFIGS[type]
    if (!cfg) return res.status(400).json({ error: `Noma'lum tur. Mavjud: ${Object.keys(TEMPLATE_CONFIGS).join(', ')}` })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AutoHisob'
    wb.created = new Date()

    // ── Info varaq ────────────────────────────────────────────────────
    const wsInfo = wb.addWorksheet('Ko\'rsatma')
    wsInfo.getColumn(1).width = 50
    wsInfo.getColumn(2).width = 40
    const infoTitle = wsInfo.getRow(1)
    infoTitle.getCell(1).value = cfg.title
    infoTitle.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1B5E20' } }
    infoTitle.height = 28

    wsInfo.getRow(2).getCell(1).value = `Yaratildi: ${new Date().toLocaleDateString('uz-UZ')} | AutoHisob`
    wsInfo.getRow(2).getCell(1).font = { italic: true, color: { argb: 'FF757575' }, size: 9 }

    wsInfo.addRow([])
    const headRow = wsInfo.addRow(['Ustun nomi', 'Tavsif'])
    headRow.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } } })

    cfg.cols.forEach(col => {
      const r = wsInfo.addRow([`${col.key}${col.required ? ' *' : ''}`, col.note])
      r.getCell(1).font = { bold: col.required, color: { argb: col.required ? 'FFC62828' : 'FF1A237E' } }
      r.getCell(2).font = { color: { argb: 'FF424242' } }
    })

    wsInfo.addRow([])
    const noteRow2 = wsInfo.addRow(['* majburiy ustunlar'])
    noteRow2.getCell(1).font = { italic: true, color: { argb: 'FFC62828' }, size: 10 }

    // ── Ma'lumot varaq ────────────────────────────────────────────────
    const wsData = wb.addWorksheet('Ma\'lumot (bu yerga yozing)')

    // Row 1: English keys (parser uses this row)
    wsData.columns = cfg.cols.map(c => ({ key: c.key, width: c.width }))
    const keyRow = wsData.getRow(1)
    cfg.cols.forEach((col, i) => {
      const cell = keyRow.getCell(i + 1)
      cell.value = col.key
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    keyRow.height = 22

    // Row 2: Uzbek labels + notes
    const labelRow = wsData.getRow(2)
    cfg.cols.forEach((col, i) => {
      const cell = labelRow.getCell(i + 1)
      cell.value = `${col.label}${col.required ? ' *' : ''}  |  ${col.note}`
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } }
      cell.font = { italic: true, color: { argb: 'FF880E4F' }, size: 9 }
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    labelRow.height = 30

    // Row 3+: Example data (green background)
    cfg.examples.forEach((ex, ei) => {
      const r = wsData.addRow(cfg.cols.map(c => ex[c.key] ?? ''))
      r.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ei === 0 ? 'FFE8F5E9' : 'FFF1F8E9' } }
        cell.font = { color: { argb: 'FF1B5E20' }, italic: true }
        cell.alignment = { vertical: 'middle' }
      })
      r.height = 18
    })

    // Empty rows for user to fill
    for (let i = 0; i < 20; i++) {
      const r = wsData.addRow(cfg.cols.map(() => ''))
      r.eachCell(cell => {
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFBDBDBD' } },
          bottom: { style: 'hair', color: { argb: 'FFBDBDBD' } },
          left: { style: 'hair', color: { argb: 'FFBDBDBD' } },
          right: { style: 'hair', color: { argb: 'FFBDBDBD' } },
        }
      })
    }

    wsData.views = [{ state: 'frozen', ySplit: 2, activeCell: 'A3' }]

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${type}-shablon.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
