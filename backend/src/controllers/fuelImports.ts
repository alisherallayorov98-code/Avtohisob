import { Response, NextFunction } from 'express'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, applyNarrowedBranchFilter, resolveOrgId } from '../lib/orgFilter'
import { resolvePriceForDate } from './fuelPrices'
import { normalizeDate, normalizePlate, computeRowCost } from '../lib/vedomostMath'

// FuelImport'ga organizationId ustuni yo'q — biz createdBy.branch'i orqali tenantni aniqlaymiz.
// Foydalanuvchilar faqat o'zining org'ida yaratilgan importlarni ko'radi.
async function assertImportAccess(importId: string, user: { id: string; role: string; branchId?: string | null }) {
  const imp = await prisma.fuelImport.findUnique({ where: { id: importId } })
  if (!imp) throw new AppError('Import topilmadi', 404)
  if (user.role === 'super_admin') return imp
  const owner = await prisma.user.findUnique({
    where: { id: imp.createdById },
    select: { branchId: true },
  })
  const filter = await getOrgFilter(user)
  const ownerBranch = owner?.branchId
  if (!ownerBranch) throw new AppError('Import topilmadi', 404)
  if (filter.type === 'single' && filter.branchId !== ownerBranch) {
    throw new AppError('Bu importga kirish huquqingiz yo\'q', 403)
  }
  if (filter.type === 'org' && !filter.orgBranchIds.includes(ownerBranch)) {
    throw new AppError('Bu importga kirish huquqingiz yo\'q', 403)
  }
  return imp
}

let openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new AppError('OpenAI API key sozlanmagan', 503)
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openai
}

const PAGE_SIZE = 20

// ─── Helpers ────────────────────────────────────────────────────────────────

// Pure hisob mantiqi lib/vedomostMath'da — DB'siz unit-test qilinadi

interface ExtractedRow {
  rowNumber: number
  date?: string
  licensePlate?: string
  waybillNo?: string
  quantity?: number
  pricePerUnit?: number
  total?: number
  driverName?: string
}

// ─── AI extraction from image ───────────────────────────────────────────────

async function extractFromImage(filePath: string, mimeType: string, year: number, month: number): Promise<ExtractedRow[]> {
  const imageData = fs.readFileSync(filePath)
  const base64 = imageData.toString('base64')

  const prompt = `Bu rasmda yoqilg'i (gaz yoki benzin) vedomosti ko'rsatilgan.
Jadvalning BARCHA qatorlarini JSON formatda chiqar.
Har bir qator uchun quyidagi maydonlar:
- rowNumber: qator tartib raqami (T/p)
- date: sana (YYYY-MM-DD formatda; yil ko'rsatilmasa ${year} yil deb ol, ${month}-oy)
- licensePlate: avtomashina davlat raqami (masalan "30516RBA", nuqta va bo'shliqsiz)
- waybillNo: yo'l varaqasi raqami (faqat raqam)
- quantity: miqdor (m3 yoki litr, faqat raqam)
- pricePerUnit: 1 birlik narxi (faqat raqam, masalan 2600)
- total: jami summa (faqat raqam)
- driverName: haydovchi to'liq ismi

Faqat sof JSON qaytargil, hech qanday izoh yoki markdown yo'q:
{"rows": [...]}`

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
      ],
    }],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const text = response.choices[0].message.content || '{}'
  const parsed = JSON.parse(text)
  return parsed.rows || []
}

// ─── Extract embedded JPEG from scanned PDF binary ──────────────────────────

function extractJpegFromPdf(buffer: Buffer): Buffer | null {
  // Search for JPEG SOI marker (FF D8 FF)
  let start = -1
  for (let i = 0; i < buffer.length - 2; i++) {
    if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8 && buffer[i + 2] === 0xFF) {
      start = i
      break
    }
  }
  if (start === -1) return null

  // Search for JPEG EOI marker (FF D9) from end
  let end = -1
  for (let i = buffer.length - 2; i >= start; i--) {
    if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
      end = i + 2
      break
    }
  }
  if (end === -1) return null
  if (end - start < 1000) return null // too small, probably not a real image

  return buffer.slice(start, end)
}

// ─── AI extraction from PDF text ────────────────────────────────────────────

async function extractFromPdfText(text: string, year: number, month: number): Promise<ExtractedRow[]> {
  const prompt = `Quyidagi matn yoqilg'i vedomostidan ajratib olingan.
Jadvalning BARCHA qatorlarini JSON formatda chiqar.
Har bir qator uchun:
- rowNumber, date (YYYY-MM-DD, yil yo'q bo'lsa ${year}), licensePlate, waybillNo, quantity, pricePerUnit, total, driverName

Faqat JSON:
{"rows": [...]}

Matn:
${text.slice(0, 8000)}`

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(response.choices[0].message.content || '{}')
  return parsed.rows || []
}

// ─── XLSX extraction ─────────────────────────────────────────────────────────

// Common column name variants (lowercased) mapped to internal keys
const COL_ALIASES: Record<string, string> = {
  // date
  'sana': 'date', 'дата': 'date', 'date': 'date',
  // licensePlate
  'davlat raqami': 'licensePlate', 'гос. номер': 'licensePlate', 'гос.номер': 'licensePlate',
  'raqam': 'licensePlate', 'номер': 'licensePlate', 'license plate': 'licensePlate',
  'plate': 'licensePlate', 'mashina': 'licensePlate',
  // waybillNo
  'yo\'l varaqa': 'waybillNo', 'путевой лист': 'waybillNo', 'waybill': 'waybillNo',
  'waybillno': 'waybillNo', 'вар.': 'waybillNo', 'вар': 'waybillNo',
  // quantity
  'miqdor': 'quantity', 'количество': 'quantity', 'qty': 'quantity',
  'litr': 'quantity', 'литр': 'quantity', 'm3': 'quantity', 'м3': 'quantity',
  // pricePerUnit
  'narx': 'pricePerUnit', 'цена': 'pricePerUnit', 'price': 'pricePerUnit',
  'единица': 'pricePerUnit', '1 birlik narxi': 'pricePerUnit',
  // total
  'jami': 'total', 'итого': 'total', 'сумма': 'total', 'total': 'total',
  'summa': 'total', 'summa (uzs)': 'total',
  // driverName
  'haydovchi': 'driverName', 'водитель': 'driverName', 'driver': 'driverName',
  'ismi': 'driverName', 'f.i.o': 'driverName', 'ф.и.о': 'driverName',
}

/**
 * Matritsa formati: chap ustun = oy kunlari (1-31), yuqori qator = mashina
 * raqamlari, har katak = o'sha kuni o'sha mashina olgan yoqilg'i (litr/m3).
 * Har bo'sh bo'lmagan katak alohida qatorga (refuel yozuv) aylanadi.
 */
function extractMatrixRows(data: any[][], year: number, month: number): ExtractedRow[] {
  // 1. Mashina raqamlari qatorini topamiz: 3+ ustunda raqamli qiymat bo'lgan qator
  let headerIdx = -1
  let plateCols: { col: number; plate: string }[] = []
  for (let i = 0; i < Math.min(data.length, 12); i++) {
    const row = data[i]
    if (!row) continue
    const cols: { col: number; plate: string }[] = []
    for (let j = 1; j < row.length; j++) {
      const v = String(row[j] ?? '').trim()
      // mashina raqami: kamida 2 belgi va ichida raqam bor (112, 30548OAA...)
      if (v && v.length >= 2 && /\d/.test(v)) cols.push({ col: j, plate: v })
    }
    if (cols.length >= 3) { headerIdx = i; plateCols = cols; break }
  }
  if (headerIdx === -1) return []

  // 2. Kunlar: header'dan keyingi qatorlar — birinchi ustun = oy kuni (1-31)
  const rows: ExtractedRow[] = []
  let rowNum = 0
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i]
    if (!row) continue
    const day = parseInt(String(row[0] ?? '').trim())
    if (isNaN(day) || day < 1 || day > 31) continue
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    for (const { col, plate } of plateCols) {
      const qty = parseFloat(String(row[col] ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
      if (!qty || isNaN(qty) || qty <= 0) continue
      rowNum++
      rows.push({ rowNumber: rowNum, date: dateStr, licensePlate: plate, quantity: qty })
    }
  }
  return rows
}

/**
 * Transponirlangan matritsa: yuqori qator = oy kunlari (1-31), chap ustun =
 * mashina raqamlari. 100+ mashina uchun qulay (kunlar 31 ustunga sig'adi).
 * extractMatrixRows'ning teskarisi.
 */
function extractMatrixRowsTransposed(data: any[][], year: number, month: number, headerIdx: number): ExtractedRow[] {
  const header = data[headerIdx]
  if (!header) return []
  // Ustunlar -> oy kunlari
  const dayCols: { col: number; day: number }[] = []
  for (let j = 1; j < header.length; j++) {
    const n = Number(String(header[j] ?? '').trim())
    if (Number.isInteger(n) && n >= 1 && n <= 31) dayCols.push({ col: j, day: n })
  }
  if (dayCols.length < 3) return []

  const rows: ExtractedRow[] = []
  let rowNum = 0
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i]
    if (!row) continue
    const plate = String(row[0] ?? '').trim()
    // mashina raqami: kamida 2 belgi va ichida raqam bor
    if (!plate || plate.length < 2 || !/\d/.test(plate)) continue
    for (const { col, day } of dayCols) {
      const qty = parseFloat(String(row[col] ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
      if (!qty || isNaN(qty) || qty <= 0) continue
      rowNum++
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      rows.push({ rowNumber: rowNum, date: dateStr, licensePlate: plate, quantity: qty })
    }
  }
  return rows
}

/**
 * Matritsa yo'nalishini aniqlaydi va mosini o'qiydi:
 *  - kunlar chap ustunda (eski format) -> extractMatrixRows
 *  - kunlar yuqori qatorda (mashina=qator) -> extractMatrixRowsTransposed
 * Qaror: oy kunlari ketma-ketligi qaysi o'qda ko'proq uchrasa — o'sha o'q kun o'qi.
 */
function extractMatrix(data: any[][], year: number, month: number): ExtractedRow[] {
  const countDayCells = (arr: any[], startIdx: number): number => {
    let c = 0
    for (let j = startIdx; j < (arr?.length ?? 0); j++) {
      const s = String(arr[j] ?? '').trim()
      if (!s) continue
      const n = Number(s)
      if (Number.isInteger(n) && n >= 1 && n <= 31) c++
    }
    return c
  }

  // Yuqori qatorlardagi eng "kunli" qatorni topamiz (transponirlangan header nomzodi)
  let topDays = 0
  let topRowIdx = -1
  for (let i = 0; i < Math.min(data.length, 12); i++) {
    const c = countDayCells(data[i] || [], 1)
    if (c > topDays) { topDays = c; topRowIdx = i }
  }
  // Chap ustunda nechta kun bor (eski format ko'rsatkichi)
  let leftDays = 0
  for (let i = 0; i < data.length; i++) {
    const n = Number(String(data[i]?.[0] ?? '').trim())
    if (Number.isInteger(n) && n >= 1 && n <= 31) leftDays++
  }

  if (topDays >= 3 && topDays > leftDays) {
    const t = extractMatrixRowsTransposed(data, year, month, topRowIdx)
    if (t.length > 0) return t
  }
  return extractMatrixRows(data, year, month)
}

async function extractFromXlsx(filePath: string, year: number, month: number): Promise<ExtractedRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  // Build 2D array (preserving empty cells via defval)
  const data: any[][] = []
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: any[] = []
    // row.values is 1-indexed array (index 0 is null), convert to 0-indexed
    const raw = row.values as any[]
    const len = (raw.length || 1) - 1
    for (let i = 1; i <= len; i++) {
      const v = raw[i]
      // Unwrap rich text and formula results
      if (v && typeof v === 'object') {
        if ('result' in v) values.push(v.result ?? '')
        else if ('richText' in v) values.push(v.richText.map((t: any) => t.text).join(''))
        else if ('text' in v) values.push(v.text)
        else values.push(String(v))
      } else {
        values.push(v ?? '')
      }
    }
    data.push(values)
  })

  if (!data.length) return []

  // Detect header row: first row where a cell matches a known alias
  let headerRowIdx = -1
  let colMap: Record<string, number> = {}

  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const row = data[i]
    const tempMap: Record<string, number> = {}
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim()
      const key = COL_ALIASES[cell]
      if (key) tempMap[key] = j
    }
    if (Object.keys(tempMap).length >= 3) {
      headerRowIdx = i
      colMap = tempMap
      break
    }
  }

  // Qatorli header topilmadi — bu mijozning matritsa formati bo'lishi mumkin
  // (kunlar × mashinalar). Avval matritsa o'qishni urinib ko'ramiz.
  if (headerRowIdx === -1) {
    const matrixRows = extractMatrix(data, year, month)
    if (matrixRows.length > 0) return matrixRows
  }

  // Positional fallback if no header matched: assume fixed column order
  // T/r | date | licensePlate | waybillNo | quantity | pricePerUnit | total | driverName
  const positional = headerRowIdx === -1

  const rows: ExtractedRow[] = []
  let rowNum = 0
  const startRow = positional ? 0 : headerRowIdx + 1

  for (let i = startRow; i < data.length; i++) {
    const row = data[i]
    if (!row || row.length < 3) continue

    // Skip rows where first column is not a number (header/title rows)
    const firstCell = String(row[0] || '').toLowerCase()
    if (firstCell.includes('t/r') || firstCell.includes('sana') || firstCell.includes('#') ||
        firstCell.includes('т/р') || firstCell.includes('n/n') || firstCell.includes('п/п')) continue

    const num = parseInt(String(row[0]))
    if (isNaN(num)) continue

    rowNum++
    const get = (key: string, fallbackIdx: number) => {
      const idx = positional ? fallbackIdx : colMap[key]
      return idx !== undefined ? row[idx] : ''
    }

    rows.push({
      rowNumber: rowNum,
      date: String(get('date', 1) || ''),
      licensePlate: String(get('licensePlate', 2) || ''),
      waybillNo: String(get('waybillNo', 3) || ''),
      quantity: parseFloat(String(get('quantity', 4))) || 0,
      pricePerUnit: parseFloat(String(get('pricePerUnit', 5))) || 0,
      total: parseFloat(String(get('total', 6))) || 0,
      driverName: String(get('driverName', 7) || ''),
    })
  }
  return rows
}

// ─── Auto-match vehicles and drivers ────────────────────────────────────────

async function matchRows(
  rawRows: ExtractedRow[],
  year: number,
  month: number,
  user: { id: string; role: string; branchId?: string | null },
): Promise<Array<{
  rowNumber: number
  refuelDate: Date | null
  licensePlate: string
  vehicleId: string | null
  waybillNo: string
  quantityM3: number
  pricePerUnit: number
  totalAmount: number
  driverName: string
  driverId: string | null
  matchStatus: string
}>> {
  // Tenant: faqat foydalanuvchi org'iga tegishli vehicle va userlar bo'yicha match qilamiz —
  // aks holda Tenant A vedomost'i Tenant B mashinalariga yopishib qolishi mumkin edi.
  const filter = await getOrgFilter(user)
  const bv = applyBranchFilter(filter)
  const vehicles = await prisma.vehicle.findMany({
    where: bv !== undefined ? { branchId: bv } : {},
    select: { id: true, registrationNumber: true },
  })
  const users = await prisma.user.findMany({
    where: {
      role: { in: ['operator', 'branch_manager', 'manager'] },
      ...(bv !== undefined ? { branchId: bv } : {}),
    },
    select: { id: true, fullName: true },
  })

  return rawRows.map(r => {
    const plate = normalizePlate(r.licensePlate)
    const refuelDate = normalizeDate(r.date, year, month)

    // Match vehicle: avval to'liq mos (30548OAA), keyin qisman — Excel faqat son
    // yozsa (548), registratsiya raqamida shu son bor mashinani topamiz.
    let vehicle = vehicles.find(v => normalizePlate(v.registrationNumber) === plate)
    let matchStatus: string
    if (vehicle) {
      matchStatus = 'matched'
    } else if (plate && /^\d{2,}$/.test(plate)) {
      // Faqat sonli qisqa raqam (548) — registratsiya ichida shu son bor mashinalar
      const candidates = vehicles.filter(v => normalizePlate(v.registrationNumber).includes(plate))
      if (candidates.length === 1) {
        vehicle = candidates[0]
        matchStatus = 'matched'
      } else if (candidates.length > 1) {
        matchStatus = 'ambiguous' // bir nechta mos — foydalanuvchi tanlaydi
      } else {
        matchStatus = 'unmatched'
      }
    } else {
      matchStatus = 'unmatched'
    }

    // Match driver (case-insensitive includes)
    const dName = (r.driverName || '').toLowerCase().trim()
    const driver = dName
      ? users.find(u => {
          const uName = u.fullName.toLowerCase()
          return uName.includes(dName) || dName.includes(uName) ||
            // Compare first word (surname)
            uName.split(' ')[0] === dName.split(' ')[0]
        })
      : null

    return {
      rowNumber: r.rowNumber,
      refuelDate,
      licensePlate: r.licensePlate || '',
      vehicleId: vehicle?.id || null,
      waybillNo: String(r.waybillNo || ''),
      quantityM3: Number(r.quantity) || 0,
      pricePerUnit: Number(r.pricePerUnit) || 0,
      totalAmount: Number(r.total) || 0,
      driverName: r.driverName || '',
      driverId: driver?.id || null,
      matchStatus,
    }
  })
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /fuel-imports/template?month=&year=
 * Mijoz matritsa shabloni (.xlsx): 1-qator = ['Kun', mashina1, mashina2, ...],
 * keyingi qatorlar = [kun_raqami, '', '', ...]. Tashkilotning haqiqiy mashinalari
 * ustun sarlavhasi sifatida qo'yiladi — foydalanuvchi faqat miqdorni to'ldiradi.
 * Format extractMatrixRows() parseri bilan to'liq mos.
 */
export async function downloadTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = parseInt(String(req.query.month)) || new Date().getMonth() + 1
    const year = parseInt(String(req.query.year)) || new Date().getFullYear()

    const filter = await getOrgFilter(req.user!)
    const branchId = (req.query.branchId as string) || undefined
    const narrowed = applyNarrowedBranchFilter(filter, branchId)
    const vehicles = await prisma.vehicle.findMany({
      where: { status: { not: 'inactive' }, ...(narrowed !== undefined && { branchId: narrowed }) },
      select: { registrationNumber: true },
      orderBy: { registrationNumber: 'asc' },
    })
    let plates = vehicles.map(v => v.registrationNumber)
    // Matritsa aniqlanishi uchun kamida 3 ta mashina kerak — kam bo'lsa namuna bilan to'ldiramiz
    if (plates.length < 3) {
      const examples = ['01A111AA', '01B222BB', '01C333CC']
      plates = [...plates, ...examples].slice(0, 3)
    }

    // layout: 'cars-rows' (default — mashina=qator, kun=ustun; 100+ mashina uchun qulay)
    //         'days-rows' (eski — kun=qator, mashina=ustun)
    const layout = String(req.query.layout || 'cars-rows') === 'days-rows' ? 'days-rows' : 'cars-rows'
    const daysInMonth = new Date(year, month, 0).getDate()

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Vedomost')

    let lastCol: number
    if (layout === 'cars-rows') {
      // 1-qator: Mashina | 1 2 3 ... (oy kunlari ustun bo'ladi)
      const header = ['Mashina', ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
      ws.addRow(header)
      for (const plate of plates) ws.addRow([plate])
      lastCol = header.length
      ws.getColumn(1).width = 14
      for (let i = 2; i <= lastCol; i++) ws.getColumn(i).width = 6
    } else {
      // 1-qator: Kun | mashina raqamlari
      const header = ['Kun', ...plates]
      ws.addRow(header)
      for (let d = 1; d <= daysInMonth; d++) ws.addRow([d])
      lastCol = header.length
      ws.getColumn(1).width = 8
      for (let i = 2; i <= lastCol; i++) ws.getColumn(i).width = 12
    }

    // Stil
    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true }
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' }
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
      cell.border = { bottom: { style: 'thin' }, right: { style: 'thin' } }
    })
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

    // Yo'riqnoma varag'i (parser faqat 1-varaqni o'qiydi — bu xavfsiz)
    const guide = wb.addWorksheet('Yo\'riqnoma')
    guide.addRow(['Vedomost shabloni — qanday to\'ldiriladi'])
    guide.addRow([])
    if (layout === 'cars-rows') {
      guide.addRow(['1.', 'Chap ustun (Mashina) — mashina raqamlari. Yangi mashina qo\'shsangiz, qator qo\'shing.'])
      guide.addRow(['2.', 'Birinchi qator — oy kunlari (1, 2, 3 ...).'])
    } else {
      guide.addRow(['1.', 'Birinchi qator (Kun) — mashina raqamlari. Yangi mashina qo\'shsangiz, ustun qo\'shing.'])
      guide.addRow(['2.', 'Chap ustun — oy kunlari (1, 2, 3 ...).'])
    }
    guide.addRow(['3.', 'Har katakka — o\'sha kuni o\'sha mashina olgan gaz miqdorini (m3) yozing.'])
    guide.addRow(['4.', 'Bo\'sh katak — o\'sha kuni quyilmagan deb hisoblanadi.'])
    guide.addRow(['5.', 'To\'ldirgach faylni "Vedomost Import" da yuklang.'])
    guide.getRow(1).font = { bold: true, size: 13 }
    guide.getColumn(1).width = 4
    guide.getColumn(2).width = 80

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="vedomost-shablon-${year}-${String(month).padStart(2, '0')}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

export async function parseVedomost(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fayl yuklanmadi', 400)

    const month = parseInt(req.body.month) || new Date().getMonth() + 1
    const year = parseInt(req.body.year) || new Date().getFullYear()
    const title = req.body.title || `${year}-${String(month).padStart(2, '0')} vedomost`
    const mime = req.file.mimetype
    const filePath = req.file.path
    const ext = path.extname(req.file.originalname).toLowerCase()

    let rawRows: ExtractedRow[] = []
    let fileType = 'image'

    if (ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheet') || mime.includes('excel')) {
      fileType = 'excel'
      rawRows = await extractFromXlsx(filePath, year, month)
    } else if (ext === '.pdf' || mime === 'application/pdf') {
      fileType = 'pdf'
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const pdfBuffer = fs.readFileSync(filePath)
      const pdfData = await pdfParse(pdfBuffer)
      const text = pdfData.text.trim()
      if (text.length > 50) {
        // Text-based PDF
        rawRows = await extractFromPdfText(text, year, month)
      } else {
        // Scanned PDF — try to extract embedded JPEG image
        const jpegData = extractJpegFromPdf(pdfBuffer)
        if (jpegData) {
          // Save extracted JPEG to temp file
          const tempPath = filePath + '_extracted.jpg'
          fs.writeFileSync(tempPath, jpegData)
          try {
            rawRows = await extractFromImage(tempPath, 'image/jpeg', year, month)
          } finally {
            fs.unlinkSync(tempPath)
          }
        } else {
          throw new AppError(
            'Skanerlangan PDF o\'qib bo\'lmadi. Telefonda suratga olib JPG ko\'rinishida yuklang.',
            422
          )
        }
      }
    } else {
      // Image
      const imageTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
      }
      const imageMime = imageTypes[ext] || mime
      rawRows = await extractFromImage(filePath, imageMime, year, month)
    }

    if (rawRows.length === 0) {
      throw new AppError('Jadvaldan ma\'lumot topilmadi. Rasmni tekshiring.', 422)
    }

    const matchedRows = await matchRows(rawRows, year, month, req.user!)

    // Save import session
    const importSession = await prisma.fuelImport.create({
      data: {
        title,
        month,
        year,
        status: 'draft',
        fileType,
        sourceFile: `/uploads/${req.file.filename}`,
        totalRows: matchedRows.length,
        createdById: req.user!.id,
        rows: {
          create: matchedRows.map(r => ({
            rowNumber: r.rowNumber,
            refuelDate: r.refuelDate ?? undefined,
            licensePlate: r.licensePlate,
            vehicleId: r.vehicleId,
            waybillNo: r.waybillNo,
            quantityM3: r.quantityM3,
            pricePerUnit: r.pricePerUnit,
            totalAmount: r.totalAmount,
            driverName: r.driverName,
            driverId: r.driverId,
            matchStatus: r.matchStatus,
          })),
        },
      },
      include: { rows: { orderBy: { rowNumber: 'asc' }, take: PAGE_SIZE } },
    })

    const matchedCount = matchedRows.filter(r => r.matchStatus === 'matched').length

    res.json(successResponse({
      import: importSession,
      totalRows: matchedRows.length,
      matchedCount,
      unmatchedCount: matchedRows.length - matchedCount,
      page: 1,
      totalPages: Math.ceil(matchedRows.length / PAGE_SIZE),
    }, `${matchedRows.length} ta qator topildi, ${matchedCount} ta mos keldi`))
  } catch (err) { next(err) }
}

export async function listImports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Tenant: createdById → user.branchId → org filter orqali faqat o'z org importlari
    const filter = await getOrgFilter(req.user!)
    let where: any = {}
    if (filter.type === 'single') {
      const owners = await prisma.user.findMany({
        where: { branchId: filter.branchId }, select: { id: true },
      })
      where = { createdById: { in: owners.map(o => o.id) } }
    } else if (filter.type === 'org') {
      const owners = await prisma.user.findMany({
        where: { branchId: { in: filter.orgBranchIds } }, select: { id: true },
      })
      where = { createdById: { in: owners.map(o => o.id) } }
    }

    const imports = await prisma.fuelImport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, title: true, month: true, year: true,
        status: true, fileType: true, totalRows: true,
        confirmedAt: true, createdAt: true,
        _count: { select: { rows: true } },
      },
    })
    res.json(successResponse(imports))
  } catch (err) { next(err) }
}

export async function getImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const page = Math.max(1, parseInt(String(req.query.page)) || 1)
    const skip = (page - 1) * PAGE_SIZE

    await assertImportAccess(id, req.user!)

    const importSession = await prisma.fuelImport.findUnique({
      where: { id },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
          skip,
          take: PAGE_SIZE,
        },
      },
    })
    if (!importSession) throw new AppError('Import topilmadi', 404)

    const totalRows = importSession.totalRows
    const totalPages = Math.ceil(totalRows / PAGE_SIZE)

    // Attach vehicle info for matched rows
    const vehicleIds = importSession.rows
      .filter(r => r.vehicleId)
      .map(r => r.vehicleId as string)

    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, registrationNumber: true, brand: true, model: true },
    })
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]))

    const rowsWithVehicle = importSession.rows.map(r => ({
      ...r,
      vehicle: r.vehicleId ? vMap[r.vehicleId] || null : null,
    }))

    // Get vehicles for unmatched dropdown — org-scoped
    const vfilter = await getOrgFilter(req.user!)
    const vbv = applyBranchFilter(vfilter)
    const allVehicles = await prisma.vehicle.findMany({
      where: vbv !== undefined ? { branchId: vbv } : {},
      select: { id: true, registrationNumber: true, brand: true, model: true },
      orderBy: { registrationNumber: 'asc' },
    })

    // Takror nazorati: butun import bo'yicha (paginatsiyadan mustaqil) bitta
    // mashina + bitta kun 2+ marta yozilgan bo'lsa, ajratib ko'rsatamiz.
    // Aksariyat joylarda kuniga 1 marta kiriladi — foydalanuvchi tekshirsin.
    const dupRows = await prisma.fuelImportRow.findMany({
      where: { importId: id, vehicleId: { not: null }, refuelDate: { not: null } },
      select: { id: true, rowNumber: true, vehicleId: true, refuelDate: true, licensePlate: true, quantityM3: true },
    })
    const dupMap = new Map<string, { vehicleId: string; plate: string; date: string; rowNumbers: number[]; count: number; totalQty: number }>()
    for (const r of dupRows) {
      const day = new Date(r.refuelDate as Date).toISOString().slice(0, 10)
      const key = `${r.vehicleId}|${day}`
      const plate = (r.vehicleId && vMap[r.vehicleId]?.registrationNumber) || r.licensePlate || ''
      const g = dupMap.get(key) || { vehicleId: r.vehicleId as string, plate, date: day, rowNumbers: [], count: 0, totalQty: 0 }
      g.rowNumbers.push(r.rowNumber)
      g.count++
      g.totalQty += Number(r.quantityM3) || 0
      dupMap.set(key, g)
    }
    const duplicateGroups = [...dupMap.values()]
      .filter(g => g.count >= 2)
      .sort((a, b) => a.date.localeCompare(b.date) || a.plate.localeCompare(b.plate))
      .map(g => ({ ...g, totalQty: Number(g.totalQty.toFixed(1)), rowNumbers: g.rowNumbers.sort((x, y) => x - y) }))

    res.json(successResponse({
      ...importSession,
      rows: rowsWithVehicle,
      page,
      totalPages,
      totalRows,
      allVehicles,
      duplicateGroups,
    }))
  } catch (err) { next(err) }
}

export async function updateRow(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id, rowId } = req.params
    const { refuelDate, licensePlate, vehicleId, waybillNo, quantityM3, pricePerUnit, totalAmount, driverName, driverId, odometerReading } = req.body

    await assertImportAccess(id, req.user!)

    // Verify row belongs to this import
    const row = await prisma.fuelImportRow.findFirst({ where: { id: rowId, importId: id } })
    if (!row) throw new AppError('Qator topilmadi', 404)

    let finalVehicleId = vehicleId !== undefined ? vehicleId : row.vehicleId
    let matchStatus = row.matchStatus

    // If vehicleId manually set, mark as manual
    if (vehicleId !== undefined && vehicleId !== row.vehicleId) {
      matchStatus = vehicleId ? 'manual' : 'unmatched'
    }

    // If licensePlate changed and no manual vehicleId, try auto-match
    if (licensePlate && licensePlate !== row.licensePlate && vehicleId === undefined) {
      const normalized = normalizePlate(licensePlate)
      const vehicle = await prisma.vehicle.findFirst({
        where: { registrationNumber: { contains: normalized, mode: 'insensitive' } },
        select: { id: true },
      })
      finalVehicleId = vehicle?.id || null
      matchStatus = vehicle ? 'matched' : 'unmatched'
    }

    const updated = await prisma.fuelImportRow.update({
      where: { id: rowId },
      data: {
        ...(refuelDate !== undefined && { refuelDate: refuelDate ? new Date(refuelDate) : null }),
        ...(licensePlate !== undefined && { licensePlate }),
        vehicleId: finalVehicleId,
        ...(waybillNo !== undefined && { waybillNo }),
        ...(quantityM3 !== undefined && { quantityM3: parseFloat(quantityM3) }),
        ...(pricePerUnit !== undefined && { pricePerUnit: parseFloat(pricePerUnit) }),
        ...(totalAmount !== undefined && { totalAmount: parseFloat(totalAmount) }),
        ...(driverName !== undefined && { driverName }),
        ...(driverId !== undefined && { driverId }),
        ...(odometerReading !== undefined && { odometerReading: parseFloat(odometerReading) }),
        matchStatus,
      },
    })
    res.json(successResponse(updated, 'Qator yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteRow(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id, rowId } = req.params
    await assertImportAccess(id, req.user!)
    const row = await prisma.fuelImportRow.findFirst({ where: { id: rowId, importId: id } })
    if (!row) throw new AppError('Qator topilmadi', 404)
    await prisma.fuelImportRow.delete({ where: { id: rowId } })
    await prisma.fuelImport.update({
      where: { id },
      data: { totalRows: { decrement: 1 } },
    })
    res.json(successResponse(null, 'Qator o\'chirildi'))
  } catch (err) { next(err) }
}

export async function confirmImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    await assertImportAccess(id, req.user!)
    const importSession = await prisma.fuelImport.findUnique({
      where: { id },
      include: { rows: true },
    })
    if (!importSession) throw new AppError('Import topilmadi', 404)
    if (importSession.status === 'confirmed') throw new AppError('Bu import allaqachon tasdiqlangan', 400)

    const matchedRows = importSession.rows.filter(r => r.vehicleId)
    const skippedCount = importSession.rows.length - matchedRows.length

    // Get vehicle fuelTypes and current mileage
    const vehicleIds = [...new Set(matchedRows.map(r => r.vehicleId as string))]
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, fuelType: true, mileage: true },
    })
    const fuelTypeMap = Object.fromEntries(vehicles.map(v => [v.id, v.fuelType]))
    const currentMileageMap = Object.fromEntries(vehicles.map(v => [v.id, Number(v.mileage)]))

    // Compute max odometerReading per vehicle from import rows
    const maxOdometerByVehicle: Record<string, number> = {}
    for (const row of matchedRows) {
      const odo = Number(row.odometerReading)
      if (row.vehicleId && odo > 0) {
        const prev = maxOdometerByVehicle[row.vehicleId] || 0
        if (odo > prev) maxOdometerByVehicle[row.vehicleId] = odo
      }
    }

    // Narx 0 bo'lgan qatorlar uchun "Narxlar" tarixidan sana bo'yicha narxni
    // aniqlaymiz (shablon faqat miqdor beradi, narx yo'q). Topilmasa 0 qoladi.
    // Narx (fuelType|sana) bo'yicha KESHLAB — 2000+ qatorda takror so'rov qilmaslik uchun.
    const orgIdFC = await resolveOrgId(req.user!)
    const priceByRow = new Map<string, number>()
    if (orgIdFC) {
      const priceCache = new Map<string, number | null>()
      for (const row of matchedRows) {
        if (!row.vehicleId || Number(row.totalAmount) > 0) continue
        const fuelType = fuelTypeMap[row.vehicleId] || 'gas'
        const date = row.refuelDate || new Date(importSession.year, importSession.month - 1, 1)
        const key = `${fuelType}|${new Date(date).toISOString().slice(0, 10)}`
        let price = priceCache.get(key)
        if (price === undefined) { price = await resolvePriceForDate(orgIdFC, fuelType, date); priceCache.set(key, price) }
        if (price && price > 0) priceByRow.set(row.id, price)
      }
    }

    // Yozuvlarni OLDINDAN tayyorlaymiz (id bilan) — tranzaksiya ichida bulk createMany.
    // Avval har qatorga alohida create+update edi: 2000+ qator interaktiv tranzaksiyaning
    // 5s limitidan oshib "server xatosi" berardi. Endi createMany + bitta bulk link.
    const records: any[] = []
    const rowLinks: Array<{ rowId: string; recordId: string }> = []
    for (const row of matchedRows) {
      if (!row.vehicleId) continue
      const fuelType = fuelTypeMap[row.vehicleId] || 'gas'
      const histPrice = priceByRow.get(row.id)
      const cost = computeRowCost(Number(row.totalAmount), Number(row.quantityM3), histPrice)
      const unitPrice = histPrice ?? Number(row.pricePerUnit)
      const recordId = randomUUID()
      records.push({
        id: recordId,
        vehicleId: row.vehicleId,
        fuelType,
        amountLiters: row.quantityM3,
        cost,
        odometerReading: row.odometerReading ?? 0,
        refuelDate: row.refuelDate || new Date(importSession.year, importSession.month - 1, 1),
        aiExtractedData: {
          source: 'vedomost_import', importId: id,
          waybillNo: row.waybillNo, driverName: row.driverName, pricePerUnit: unitPrice,
        },
        createdById: req.user!.id,
      })
      rowLinks.push({ rowId: row.id, recordId })
    }
    const createdCount = records.length

    await prisma.$transaction(async (tx) => {
      // Bulk insert (1000 lik bo'laklar bilan)
      for (let i = 0; i < records.length; i += 1000) {
        await tx.fuelRecord.createMany({ data: records.slice(i, i + 1000) })
      }
      // fuelImportRow.fuelRecordId — bitta bulk UPDATE ... FROM (VALUES ...)
      if (rowLinks.length > 0) {
        const valuesSql = rowLinks.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')
        const params = rowLinks.flatMap(l => [l.rowId, l.recordId])
        await tx.$executeRawUnsafe(
          `UPDATE "fuel_import_rows" AS r SET "fuelRecordId" = v.rid
           FROM (VALUES ${valuesSql}) AS v(row_id, rid) WHERE r.id = v.row_id`,
          ...params,
        )
      }
      // Probeg — faqat oshgan mashinalar
      for (const [vehicleId, newMileage] of Object.entries(maxOdometerByVehicle)) {
        const current = currentMileageMap[vehicleId] || 0
        if (newMileage > current) {
          await tx.vehicle.update({ where: { id: vehicleId }, data: { mileage: newMileage } })
        }
      }
      await tx.fuelImport.update({ where: { id }, data: { status: 'confirmed', confirmedAt: new Date() } })
    }, { timeout: 120000, maxWait: 20000 })

    const updatedVehicleCount = Object.keys(maxOdometerByVehicle).filter(
      vid => (maxOdometerByVehicle[vid] || 0) > (currentMileageMap[vid] || 0)
    ).length

    res.json(successResponse(
      { createdCount, skippedCount, updatedVehicleCount },
      `${createdCount} ta yoqilg'i yozuvi yaratildi`
    ))
  } catch (err) { next(err) }
}

export async function unconfirmImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const imp = await assertImportAccess(id, req.user!)
    if (imp.status !== 'confirmed') throw new AppError('Bu import tasdiqlanmagan', 400)

    const rows = await prisma.fuelImportRow.findMany({
      where: { importId: id, fuelRecordId: { not: null } },
      select: { fuelRecordId: true },
    })
    const recordIds = rows.map(r => r.fuelRecordId as string)

    await prisma.$transaction(async (tx) => {
      // Faqat shu importga bog'langan yozuvlar o'chadi — qo'lda kiritilganlarga tegilmaydi
      for (let i = 0; i < recordIds.length; i += 1000) {
        await tx.fuelRecord.deleteMany({ where: { id: { in: recordIds.slice(i, i + 1000) } } })
      }
      await tx.fuelImportRow.updateMany({ where: { importId: id }, data: { fuelRecordId: null } })
      await tx.fuelImport.update({ where: { id }, data: { status: 'draft', confirmedAt: null } })
    }, { timeout: 120000, maxWait: 20000 })

    res.json(successResponse(
      { deletedCount: recordIds.length },
      `${recordIds.length} ta yoqilg'i yozuvi o'chirildi, import qoralamaga qaytarildi`
    ))
  } catch (err) { next(err) }
}

export async function deleteImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const imp = await assertImportAccess(id, req.user!)
    if (imp.status === 'confirmed') throw new AppError('Tasdiqlangan importni o\'chirib bo\'lmaydi', 400)
    await prisma.fuelImport.delete({ where: { id } })
    res.json(successResponse(null, 'Import o\'chirildi'))
  } catch (err) { next(err) }
}
