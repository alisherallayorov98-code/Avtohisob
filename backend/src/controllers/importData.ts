import { Response, NextFunction } from 'express'
import { AuthRequest } from '../middleware/auth'
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
    } else {
      return res.status(400).json({ error: 'Noma\'lum tur. vehicles, fuel, spare_parts bo\'lishi kerak' })
    }

    res.json({
      data: {
        type, total: rows.length, imported, skipped,
        errorCount: errors.length, errors: errors.slice(0, 20),
      }
    })
  } catch (err) { next(err) }
}

// Get Excel templates
export async function getTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type } = req.params

    const configs: Record<string, { columns: { header: string; key: string; width: number; note?: string }[]; example: Record<string, any>[] }> = {
      vehicles: {
        columns: [
          { header: 'Davlat raqami *', key: 'registrationNumber', width: 16, note: 'Masalan: 01A123AA' },
          { header: 'Marka *', key: 'brand', width: 14, note: 'Masalan: Toyota' },
          { header: 'Model *', key: 'model', width: 14, note: 'Masalan: Camry' },
          { header: 'Yil *', key: 'year', width: 8, note: '2015-2024' },
          { header: 'Yoqilgi turi *', key: 'fuelType', width: 14, note: 'petrol / diesel / gas / electric' },
          { header: 'Filial nomi *', key: 'branchName', width: 20, note: 'Tizimda mavjud filial nomi' },
          { header: 'Yurish (km)', key: 'mileage', width: 12, note: 'Raqam' },
          { header: 'Sotib olingan sana', key: 'purchaseDate', width: 18, note: 'YYYY-MM-DD' },
          { header: 'Izoh', key: 'notes', width: 20 },
        ],
        example: [
          { registrationNumber: '01A123AA', brand: 'Toyota', model: 'Camry', year: 2020, fuelType: 'petrol', branchName: 'Asosiy filial', mileage: 50000, purchaseDate: '2020-01-15', notes: '' },
          { registrationNumber: '01B456BB', brand: 'Chevrolet', model: 'Malibu', year: 2021, fuelType: 'petrol', branchName: '2-filial', mileage: 30000, purchaseDate: '2021-06-20', notes: '' },
        ],
      },
      fuel: {
        columns: [
          { header: 'Mashina ID *', key: 'vehicleId', width: 38, note: 'UUID (Mashinalar ro\'yxatidan)' },
          { header: 'Yoqilgi turi *', key: 'fuelType', width: 14, note: 'petrol / diesel / gas / electric' },
          { header: 'Miqdor (litr) *', key: 'amountLiters', width: 14, note: 'Raqam' },
          { header: 'Narxi (so\'m) *', key: 'cost', width: 14, note: 'Raqam' },
          { header: 'Odometr *', key: 'odometerReading', width: 12, note: 'Raqam' },
          { header: 'Sana *', key: 'refuelDate', width: 14, note: 'YYYY-MM-DD' },
          { header: 'Ta\'minotchi ID', key: 'supplierId', width: 38, note: 'UUID (ixtiyoriy)' },
        ],
        example: [
          { vehicleId: 'MASHINA-UUID', fuelType: 'petrol', amountLiters: 50, cost: 400000, odometerReading: 55000, refuelDate: '2024-01-15', supplierId: '' },
        ],
      },
      spare_parts: {
        columns: [
          { header: 'Nomi *', key: 'name', width: 20, note: 'Masalan: Moy filtri' },
          { header: 'Qism kodi *', key: 'partCode', width: 14, note: 'Masalan: MF-001' },
          { header: 'Kategoriya *', key: 'category', width: 14, note: 'engine / brake / suspension / electrical / body / other' },
          { header: 'Narxi (so\'m) *', key: 'unitPrice', width: 14, note: 'Raqam' },
          { header: 'Ta\'minotchi ID *', key: 'supplierId', width: 38, note: 'UUID' },
          { header: 'Tavsif', key: 'description', width: 24 },
        ],
        example: [
          { name: 'Moy filtri', partCode: 'MF-001', category: 'engine', unitPrice: 25000, supplierId: 'TAMIROTCHI-UUID', description: 'Yog\' filtri' },
        ],
      },
    }

    const cfg = configs[type]
    if (!cfg) return res.status(400).json({ error: 'Noma\'lum tur' })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Shablon')

    // Header row styling
    ws.columns = cfg.columns.map(c => ({ header: c.header, key: c.key, width: c.width }))
    const headerRow = ws.getRow(1)
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } }
    })
    headerRow.height = 28

    // Note row (row 2) — grey hint
    const noteRow = ws.getRow(2)
    cfg.columns.forEach((col, i) => {
      if (col.note) {
        const cell = noteRow.getCell(i + 1)
        cell.value = col.note
        cell.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }
        cell.alignment = { wrapText: true }
      }
    })
    noteRow.height = 20

    // Example rows start from row 3
    cfg.example.forEach(row => ws.addRow(row))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${type}-shablon.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
