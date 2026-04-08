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

    const { headers, rows: rawRows } = parseCSV(csvText)
    if (!rawRows.length) return res.status(400).json({ error: 'CSV bo\'sh yoki noto\'g\'ri format' })
    const rows = normalizeHeaders(rawRows)

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

    const { rows: rawRows2 } = parseCSV(csvText)
    const rows = normalizeHeaders(rawRows2)
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
      // Get default branch once for inventory creation
      const defaultBranch = branchId
        ? await prisma.branch.findUnique({ where: { id: branchId } })
        : await prisma.branch.findFirst()

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        try {
          const existing = await prisma.sparePart.findUnique({ where: { partCode: row.partCode } })
          if (existing) { skipped++; continue }
          const part = await prisma.sparePart.create({
            data: {
              name: row.name, partCode: row.partCode,
              category: row.category, unitPrice: parseFloat(row.unitPrice),
              supplierId: row.supplierId, description: row.description || null,
            }
          })

          // If quantity provided, also create inventory record
          if (row.quantity && parseInt(row.quantity) > 0) {
            let invBranchId = defaultBranch?.id
            if (row.branchName) {
              const found = await prisma.branch.findFirst({ where: { name: { equals: row.branchName, mode: 'insensitive' } } })
              if (found) invBranchId = found.id
            }
            if (invBranchId) {
              await prisma.inventory.upsert({
                where: { sparePartId_branchId: { sparePartId: part.id, branchId: invBranchId } },
                create: { sparePartId: part.id, branchId: invBranchId, quantityOnHand: parseInt(row.quantity), reorderLevel: parseInt(row.reorderLevel) || 5 },
                update: { quantityOnHand: { increment: parseInt(row.quantity) } },
              })
            }
          }

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

    // Row 1 = headers (Russian labels in new templates), Row 2 = hints (skip), Row 3+ = data
    // Find which worksheet has data (skip "Ko'rsatma" / "Инструкция" sheet)
    const dataWs = wb.worksheets.find(s =>
      s.name !== 'Ko\'rsatma' && s.name !== 'Инструкция' && s.name !== 'Инструкции'
    ) || ws

    const keyRow = dataWs.getRow(1)
    const keys: string[] = []
    keyRow.eachCell((cell) => {
      // Remove trailing " *" from required markers
      keys.push(String(cell.value || '').trim().replace(/\s*\*$/, ''))
    })

    // Row 2: check if it's a hint row (not actual data) — skip it
    const row2Val = String(dataWs.getRow(2).getCell(1).value || '').trim()
    const dataStartRow = (row2Val && row2Val !== String(dataWs.getRow(3).getCell(1).value || '').trim()) ? 3 : 2

    const rawExcelRows: Record<string, string>[] = []
    dataWs.eachRow((row, rowNum) => {
      if (rowNum <= dataStartRow - 1) return
      const obj: Record<string, string> = {}
      let hasData = false
      keys.forEach((key, i) => {
        const val = String(row.getCell(i + 1).value ?? '').trim()
        if (val) hasData = true
        obj[key] = val
      })
      if (hasData) rawExcelRows.push(obj)
    })

    if (!rawExcelRows.length) return res.status(400).json({ error: 'Excel faylda ma\'lumot yo\'q' })

    // Normalize Russian/English headers → internal English keys
    const normalizedRows = normalizeHeaders(rawExcelRows)
    const internalKeys = Object.keys(normalizedRows[0] || {})

    // Convert to CSV using internal keys
    const header = internalKeys.join(',')
    const csvLines = normalizedRows.map(r => internalKeys.map(k => `"${(r[k] || '').replace(/"/g, '""')}"`).join(','))
    const csvText = [header, ...csvLines].join('\n')

    res.json({ data: { csvText, rowCount: normalizedRows.length, keys: internalKeys } })
  } catch (err) { next(err) }
}

// ── Excel shablonlar ─────────────────────────────────────────────────────
// label = rus tili (foydalanuvchi ko'radi, CSV/Excel header sifatida yoziladi)
// key   = ichki ingliz nomi (parser ishlatadi)
type ColDef = { key: string; label: string; width: number; note: string; required?: boolean }

const TEMPLATE_CONFIGS: Record<string, { title: string; cols: ColDef[]; examples: Record<string, any>[] }> = {
  vehicles: {
    title: 'Шаблон импорта автомобилей',
    cols: [
      { key: 'registrationNumber', label: 'Гос. номер',          width: 16, note: 'Пример: 01A123AA', required: true },
      { key: 'brand',              label: 'Марка',                width: 14, note: 'Toyota, Chevrolet...', required: true },
      { key: 'model',              label: 'Модель',               width: 14, note: 'Camry, Malibu...', required: true },
      { key: 'year',               label: 'Год',                  width: 8,  note: '2010-2025', required: true },
      { key: 'fuelType',           label: 'Тип топлива',          width: 16, note: 'petrol | diesel | gas | electric', required: true },
      { key: 'branchName',         label: 'Название филиала',     width: 22, note: 'Точное название филиала в системе', required: true },
      { key: 'mileage',            label: 'Пробег (км)',          width: 14, note: 'Число, например: 50000' },
      { key: 'purchaseDate',       label: 'Дата покупки',         width: 16, note: 'Формат: YYYY-MM-DD, пример: 2020-01-15' },
      { key: 'notes',              label: 'Примечание',           width: 22, note: 'Необязательно' },
    ],
    examples: [
      { 'Гос. номер': '01A123AA', 'Марка': 'Toyota', 'Модель': 'Camry', 'Год': 2020, 'Тип топлива': 'petrol', 'Название филиала': 'Основной филиал', 'Пробег (км)': 50000, 'Дата покупки': '2020-01-15', 'Примечание': '' },
      { 'Гос. номер': '01B456BB', 'Марка': 'Chevrolet', 'Модель': 'Malibu', 'Год': 2021, 'Тип топлива': 'petrol', 'Название филиала': 'Филиал 2', 'Пробег (км)': 30000, 'Дата покупки': '2021-06-20', 'Примечание': '' },
      { 'Гос. номер': '01C789CC', 'Марка': 'Hyundai', 'Модель': 'Elantra', 'Год': 2022, 'Тип топлива': 'petrol', 'Название филиала': 'Основной филиал', 'Пробег (км)': 15000, 'Дата покупки': '2022-03-10', 'Примечание': '' },
    ],
  },
  spare_parts: {
    title: 'Шаблон импорта запчастей',
    cols: [
      { key: 'name',         label: 'Наименование',         width: 28, note: 'Пример: Масляный фильтр', required: true },
      { key: 'partCode',     label: 'Артикул',              width: 16, note: 'Уникальный код, пример: MF-001', required: true },
      { key: 'category',     label: 'Категория',            width: 18, note: 'engine | brake | suspension | electrical | body | other', required: true },
      { key: 'unitPrice',    label: 'Цена (сум)',           width: 16, note: 'Число, пример: 25000', required: true },
      { key: 'supplierId',   label: 'ID поставщика',        width: 38, note: 'UUID (со страницы Поставщики)', required: true },
      { key: 'quantity',     label: 'Количество (шт)',       width: 16, note: 'Начальный остаток на складе, пример: 10' },
      { key: 'branchName',   label: 'Название филиала',     width: 22, note: 'Для складского учёта (если указано количество)' },
      { key: 'reorderLevel', label: 'Мин. остаток',         width: 14, note: 'Уведомление при достижении (по умолч. 5)' },
      { key: 'description',  label: 'Описание',             width: 28, note: 'Необязательно' },
    ],
    examples: [
      { 'Наименование': 'Масляный фильтр', 'Артикул': 'MF-001', 'Категория': 'engine', 'Цена (сум)': 25000, 'ID поставщика': 'ПОСТАВЩИК-UUID', 'Количество (шт)': 10, 'Название филиала': 'Основной филиал', 'Мин. остаток': 3, 'Описание': 'Фильтр моторного масла' },
      { 'Наименование': 'Тормозные колодки', 'Артикул': 'TK-002', 'Категория': 'brake', 'Цена (сум)': 85000, 'ID поставщика': 'ПОСТАВЩИК-UUID', 'Количество (шт)': 5, 'Название филиала': 'Основной филиал', 'Мин. остаток': 2, 'Описание': '' },
      { 'Наименование': 'Воздушный фильтр', 'Артикул': 'HF-003', 'Категория': 'engine', 'Цена (сум)': 18000, 'ID поставщика': 'ПОСТАВЩИК-UUID', 'Количество (шт)': 8, 'Название филиала': 'Филиал 2', 'Мин. остаток': 2, 'Описание': 'Очиститель воздуха' },
    ],
  },
  inventory: {
    title: 'Шаблон импорта складских остатков',
    cols: [
      { key: 'partCode',    label: 'Артикул',              width: 16, note: 'Код существующей запчасти', required: true },
      { key: 'branchName',  label: 'Название филиала',     width: 22, note: 'Точное название филиала в системе', required: true },
      { key: 'quantity',    label: 'Количество (шт)',       width: 16, note: 'Число, пример: 10', required: true },
      { key: 'reorderLevel',label: 'Мин. остаток',         width: 14, note: 'Уведомление при достижении' },
    ],
    examples: [
      { 'Артикул': 'MF-001', 'Название филиала': 'Основной филиал', 'Количество (шт)': 10, 'Мин. остаток': 3 },
      { 'Артикул': 'TK-002', 'Название филиала': 'Основной филиал', 'Количество (шт)': 5, 'Мин. остаток': 2 },
      { 'Артикул': 'HF-003', 'Название филиала': 'Филиал 2', 'Количество (шт)': 8, 'Мин. остаток': 2 },
    ],
  },
  suppliers: {
    title: 'Шаблон импорта поставщиков',
    cols: [
      { key: 'name',          label: 'Название',           width: 26, note: 'Пример: ООО "Автозапчасти"', required: true },
      { key: 'phone',         label: 'Телефон',            width: 16, note: '+998901234567', required: true },
      { key: 'email',         label: 'Email',              width: 24, note: 'info@company.uz (необязательно)' },
      { key: 'contactPerson', label: 'Контактное лицо',    width: 22, note: 'Имя Фамилия' },
      { key: 'address',       label: 'Адрес',              width: 28, note: 'Город, улица...' },
    ],
    examples: [
      { 'Название': 'ООО "Автозапчасти"', 'Телефон': '+998901234567', 'Email': 'info@avtozap.uz', 'Контактное лицо': 'Алишер Каримов', 'Адрес': 'Ташкент, Юнусобад' },
      { 'Название': 'Магазин Немат', 'Телефон': '+998931234567', 'Email': '', 'Контактное лицо': 'Немат Тошматов', 'Адрес': 'Ташкент, Чиланзар' },
    ],
  },
  fuel: {
    title: 'Шаблон импорта записей топлива',
    cols: [
      { key: 'vehicleId',      label: 'ID автомобиля',     width: 38, note: 'UUID — скопируйте со страницы Автомобили', required: true },
      { key: 'fuelType',       label: 'Тип топлива',       width: 16, note: 'petrol | diesel | gas | electric', required: true },
      { key: 'amountLiters',   label: 'Литры',             width: 14, note: 'Число, пример: 50', required: true },
      { key: 'cost',           label: 'Стоимость (сум)',   width: 18, note: 'Число, пример: 400000', required: true },
      { key: 'odometerReading',label: 'Одометр (км)',      width: 16, note: 'Число, пример: 55000', required: true },
      { key: 'refuelDate',     label: 'Дата',              width: 14, note: 'Формат: YYYY-MM-DD, пример: 2024-01-15', required: true },
      { key: 'supplierId',     label: 'ID поставщика',     width: 38, note: 'UUID (необязательно)' },
    ],
    examples: [
      { 'ID автомобиля': 'АВТО-UUID-СЮДА', 'Тип топлива': 'petrol', 'Литры': 50, 'Стоимость (сум)': 400000, 'Одометр (км)': 55000, 'Дата': '2024-01-15', 'ID поставщика': '' },
    ],
  },
}

// ── Rus ustun nomlari → ichki kalit (key) moslash ─────────────────────────
function buildHeaderMap(): Record<string, string> {
  const map: Record<string, string> = {}
  Object.values(TEMPLATE_CONFIGS).forEach(cfg => {
    cfg.cols.forEach(col => {
      // Russian label → key
      map[col.label.toLowerCase().trim()] = col.key
      // Also accept English key as-is (backwards compat)
      map[col.key.toLowerCase().trim()] = col.key
    })
  })
  return map
}
const HEADER_MAP = buildHeaderMap()

function normalizeHeaders(rows: Record<string, string>[]): Record<string, string>[] {
  if (!rows.length) return rows
  const sample = Object.keys(rows[0])
  // Check if headers are already English keys
  const alreadyEnglish = sample.every(h => HEADER_MAP[h.toLowerCase().trim()] === h)
  if (alreadyEnglish) return rows
  return rows.map(row => {
    const normalized: Record<string, string> = {}
    Object.entries(row).forEach(([h, v]) => {
      const mapped = HEADER_MAP[h.toLowerCase().trim()]
      normalized[mapped || h] = v
    })
    return normalized
  })
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
    const wsInfo = wb.addWorksheet('Инструкция')
    wsInfo.getColumn(1).width = 40
    wsInfo.getColumn(2).width = 50
    const infoTitle = wsInfo.getRow(1)
    infoTitle.getCell(1).value = cfg.title
    infoTitle.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1B5E20' } }
    infoTitle.height = 28

    wsInfo.getRow(2).getCell(1).value = `Создан: ${new Date().toLocaleDateString('ru-RU')} | AutoHisob`
    wsInfo.getRow(2).getCell(1).font = { italic: true, color: { argb: 'FF757575' }, size: 9 }

    wsInfo.addRow([])
    const headRow = wsInfo.addRow(['Название столбца', 'Описание / допустимые значения'])
    headRow.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } } })

    cfg.cols.forEach(col => {
      const r = wsInfo.addRow([`${col.label}${col.required ? ' *' : ''}`, col.note])
      r.getCell(1).font = { bold: col.required, color: { argb: col.required ? 'FFC62828' : 'FF1A237E' } }
      r.getCell(2).font = { color: { argb: 'FF424242' } }
    })

    wsInfo.addRow([])
    const noteRow2 = wsInfo.addRow(['* — обязательные столбцы'])
    noteRow2.getCell(1).font = { italic: true, color: { argb: 'FFC62828' }, size: 10 }

    // ── Ma'lumot varaq ────────────────────────────────────────────────
    const wsData = wb.addWorksheet('Данные (заполните здесь)')

    // Row 1: Russian labels (foydalanuvchi ko'radi VA parser shu qatorni o'qiydi)
    wsData.columns = cfg.cols.map(c => ({ key: c.label, width: c.width }))
    const keyRow = wsData.getRow(1)
    cfg.cols.forEach((col, i) => {
      const cell = keyRow.getCell(i + 1)
      cell.value = col.label + (col.required ? ' *' : '')
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    })
    keyRow.height = 28

    // Row 2: Notes / hints (pushti rang)
    const labelRow = wsData.getRow(2)
    cfg.cols.forEach((col, i) => {
      const cell = labelRow.getCell(i + 1)
      cell.value = col.note
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } }
      cell.font = { italic: true, color: { argb: 'FF6D4C41' }, size: 9 }
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    labelRow.height = 28

    // Row 3+: Example data (green background)
    cfg.examples.forEach((ex, ei) => {
      const r = wsData.addRow(cfg.cols.map(c => ex[c.label] ?? ex[c.label + ' *'] ?? ''))
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
