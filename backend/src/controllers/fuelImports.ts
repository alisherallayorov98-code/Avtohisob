import { Response, NextFunction } from 'express'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

  const response = await openai.chat.completions.create({
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

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(response.choices[0].message.content || '{}')
  return parsed.rows || []
}

// ─── XLSX extraction ─────────────────────────────────────────────────────────

function extractFromXlsx(filePath: string): ExtractedRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  const rows: ExtractedRow[] = []
  let rowNum = 0

  for (const row of data) {
    if (!row || row.length < 3) continue
    // Try to detect header row and skip
    const firstCell = String(row[0] || '').toLowerCase()
    if (firstCell.includes('t/r') || firstCell.includes('sana') || firstCell.includes('#')) continue

    const num = parseInt(String(row[0]))
    if (isNaN(num)) continue

    rowNum++
    rows.push({
      rowNumber: rowNum,
      date: String(row[1] || ''),
      licensePlate: String(row[2] || ''),
      waybillNo: String(row[3] || ''),
      quantity: parseFloat(String(row[4])) || 0,
      pricePerUnit: parseFloat(String(row[5])) || 0,
      total: parseFloat(String(row[6])) || 0,
      driverName: String(row[7] || ''),
    })
  }
  return rows
}

// ─── Auto-match vehicles and drivers ────────────────────────────────────────

async function matchRows(
  rawRows: ExtractedRow[],
  year: number,
  month: number,
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
  // Load all vehicles and users once
  const vehicles = await prisma.vehicle.findMany({ select: { id: true, registrationNumber: true } })
  const users = await prisma.user.findMany({
    where: { role: { in: ['operator', 'branch_manager', 'manager'] } },
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
        rawRows = await extractFromPdfText(text, year, month)
      } else {
        // Scanned PDF — can't read as image via this path, return error with guidance
        throw new AppError('Skanerlangan PDF o\'qib bo\'lmadi. Iltimos, rasmga (JPG/PNG) o\'girib yuklang.', 422)
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

    const matchedRows = await matchRows(rawRows, year, month)

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
    const imports = await prisma.fuelImport.findMany({
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

    // Get all vehicles for unmatched dropdown
    const allVehicles = await prisma.vehicle.findMany({
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
    const { refuelDate, licensePlate, vehicleId, waybillNo, quantityM3, pricePerUnit, totalAmount, driverName, driverId } = req.body

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
        matchStatus,
      },
    })
    res.json(successResponse(updated, 'Qator yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteRow(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id, rowId } = req.params
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
    const importSession = await prisma.fuelImport.findUnique({
      where: { id },
      include: { rows: true },
    })
    if (!importSession) throw new AppError('Import topilmadi', 404)
    if (importSession.status === 'confirmed') throw new AppError('Bu import allaqachon tasdiqlangan', 400)

    const matchedRows = importSession.rows.filter(r => r.vehicleId)

    // Get vehicle fuelTypes
    const vehicleIds = [...new Set(matchedRows.map(r => r.vehicleId as string))]
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, fuelType: true },
    })
    const fuelTypeMap = Object.fromEntries(vehicles.map(v => [v.id, v.fuelType]))

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
            odometerReading: 0,
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

        // Link fuelRecordId back to row
        await tx.fuelImportRow.update({
          where: { id: row.id },
          data: { fuelRecordId: record.id },
        })

        createdCount++
      }

      await tx.fuelImport.update({
        where: { id },
        data: { status: 'confirmed', confirmedAt: new Date() },
      })
    })

    res.json(successResponse({ createdCount }, `${createdCount} ta yoqilg'i yozuvi yaratildi`))
  } catch (err) { next(err) }
}

export async function deleteImport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params
    const imp = await prisma.fuelImport.findUnique({ where: { id } })
    if (!imp) throw new AppError('Import topilmadi', 404)
    if (imp.status === 'confirmed') throw new AppError('Tasdiqlangan importni o\'chirib bo\'lmaydi', 400)
    await prisma.fuelImport.delete({ where: { id } })
    res.json(successResponse(null, 'Import o\'chirildi'))
  } catch (err) { next(err) }
}
