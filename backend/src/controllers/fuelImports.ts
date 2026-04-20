import { Response, NextFunction } from 'express'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../lib/orgFilter'

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

function normalizeDate(raw: string | undefined | null, year?: number, month?: number): Date | null {
  if (!raw) return null
  try {
    // Try direct ISO parse
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d

    // Try "DD.MM.YY" or "DD.MM.YYYY"
    const parts = raw.replace(/[-/]/g, '.').split('.')
    if (parts.length === 3) {
      let [d2, m2, y2] = parts.map(Number)
      if (y2 < 100) y2 += 2000
      return new Date(y2, m2 - 1, d2)
    }

    // Try "DD.MM" without year
    if (parts.length === 2) {
      const [d2, m2] = parts.map(Number)
      return new Date(year || new Date().getFullYear(), m2 - 1, d2)
    }
  } catch { /* ignore */ }
  return null
}

function normalizePlate(raw: string | undefined | null): string {
  if (!raw) return ''
  // Remove spaces, dots, keep alphanumeric
  return raw.replace(/[\s.]/g, '').toUpperCase()
}

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

function extractFromXlsx(filePath: string): ExtractedRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

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

    // Match vehicle (fuzzy: normalize both sides)
    const vehicle = vehicles.find(v => normalizePlate(v.registrationNumber) === plate)

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

    const matchStatus = vehicle ? 'matched' : 'unmatched'

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
      rawRows = extractFromXlsx(filePath)
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

    res.json(successResponse({
      ...importSession,
      rows: rowsWithVehicle,
      page,
      totalPages,
      totalRows,
      allVehicles,
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

    let createdCount = 0

    await prisma.$transaction(async (tx) => {
      for (const row of matchedRows) {
        if (!row.vehicleId) continue
        const fuelType = fuelTypeMap[row.vehicleId] || 'gas'

        const record = await tx.fuelRecord.create({
          data: {
            vehicleId: row.vehicleId,
            fuelType,
            amountLiters: row.quantityM3,
            cost: row.totalAmount,
            odometerReading: row.odometerReading ?? 0,
            refuelDate: row.refuelDate || new Date(importSession.year, importSession.month - 1, 1),
            aiExtractedData: {
              source: 'vedomost_import',
              importId: id,
              waybillNo: row.waybillNo,
              driverName: row.driverName,
              pricePerUnit: Number(row.pricePerUnit),
            },
            createdById: req.user!.id,
          },
        })

        await tx.fuelImportRow.update({
          where: { id: row.id },
          data: { fuelRecordId: record.id },
        })

        createdCount++
      }

      // Update vehicle mileage if new odometer reading is higher
      for (const [vehicleId, newMileage] of Object.entries(maxOdometerByVehicle)) {
        const current = currentMileageMap[vehicleId] || 0
        if (newMileage > current) {
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: { mileage: newMileage },
          })
        }
      }

      await tx.fuelImport.update({
        where: { id },
        data: { status: 'confirmed', confirmedAt: new Date() },
      })
    })

    const updatedVehicleCount = Object.keys(maxOdometerByVehicle).filter(
      vid => (maxOdometerByVehicle[vid] || 0) > (currentMileageMap[vid] || 0)
    ).length

    res.json(successResponse(
      { createdCount, skippedCount, updatedVehicleCount },
      `${createdCount} ta yoqilg'i yozuvi yaratildi`
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
