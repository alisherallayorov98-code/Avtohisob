import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { logEkoAudit } from '../lib/ekoAudit'
import {
  detectColumns, parseImportRow, findDuplicates, collectNewPlaces, findHeaderRowIndex, mergeImportRow,
  normalizePlaceName, ColumnKey, ParsedEntityRow, RowError, ExistingForMerge, ImportChange,
} from '../lib/entityImport'
import { checkXlsxUpload } from '../lib/xlsxGuard'
import { withOrgLock } from '../lib/orgLock'

// Bitta importda ruxsat etilgan maksimal qator — tasodifiy ulkan fayl serverni
// bo'g'ib qo'ymasligi uchun. Katta shahar ham bir necha partiyaga bo'linadi.
const MAX_ROWS = 10000
/** Bitta tranzaksiyada yoziladigan qatorlar soni (orgLock ostida, uzoq qulf bo'lmasin). */
const CHUNK_SIZE = 100
/** Importni bekor qilish uchun yozib berilishi shart bo'lgan ibora (oil-change/reset namunasi). */
export const UNDO_CONFIRM_PHRASE = 'IMPORTNI BEKOR QILISH'

const GENERIC_ROW_ERROR = "Saqlashda xato — qator ma'lumotini tekshirib, qayta urinib ko'ring"

// Bir korxonada bir vaqtda faqat bitta import (jarayon ichida; bazada esa orgLock chunk darajasida himoya qiladi)
const importsInProgress = new Set<string>()

// multer `req.file` ni Express.Multer.File sifatida qo'shadi (@types/multer)
type MulterRequest = EkoRequest

class ImportInputError extends Error {
  status = 400
  code?: string
  data?: unknown
  constructor(message: string, code?: string, data?: unknown) { super(message); this.code = code; this.data = data }
}

/** Yuklangan .xlsx dan sarlavha + qatorlarni o'qiydi. Sarlavha 1–10 qator ichidan qidiriladi. */
async function readWorkbook(buffer: Buffer): Promise<{
  header: unknown[]; headerRow: number; rows: { cells: unknown[]; rowNumber: number }[]
}> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer as any)
  } catch {
    throw new ImportInputError("Faylni o'qib bo'lmadi — haqiqiy .xlsx fayl ekanini tekshiring")
  }
  const ws = wb.worksheets[0]
  if (!ws) throw new ImportInputError('Faylda varaq topilmadi')

  const all: { cells: unknown[]; rowNumber: number }[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // ExcelJS `values` 1-indeksli — 0-elementni tashlaymiz
    const cells = (row.values as unknown[]).slice(1).map((c: any) => {
      if (c == null) return ''
      if (c instanceof Date) return c
      // Formula/hyperlink katakchalari obyekt bo'lib keladi
      if (typeof c === 'object') return c.result ?? c.text ?? c.hyperlink ?? ''
      return c
    })
    if (cells.every(c => c === '' || c == null)) return
    all.push({ cells, rowNumber })
  })

  const scan = all.filter(r => r.rowNumber <= 10)
  const idx = findHeaderRowIndex(scan.map(r => r.cells), 10)
  if (idx < 0) {
    throw new ImportInputError(
      'Tashkilot nomi ustuni topilmadi. Birinchi 10 qator ichida "Nomi" (yoki "Наименование") sarlavhasi bo\'lishi kerak — namuna shablonni yuklab oling.',
    )
  }
  const headerRow = scan[idx].rowNumber
  return {
    header: scan[idx].cells,
    headerRow,
    rows: all.filter(r => r.rowNumber > headerRow),
  }
}

interface ExistingRecord extends ExistingForMerge {
  id: string
  stir: string | null
  districtId: string
  mahallId: string | null
  status: string
}

const EXISTING_SELECT = {
  id: true, name: true, stir: true, districtId: true, mahallId: true, status: true,
  code: true, address: true, phone: true, contactName: true,
  billingMode: true, monthlyFee: true, cubicPrice: true,
  contractNumber: true, contractStartMonth: true, lat: true, lon: true,
  district: { select: { name: true } },
  mahalla: { select: { name: true } },
} as const

function toExisting(e: any): ExistingRecord {
  return {
    id: e.id, stir: e.stir, districtId: e.districtId, mahallId: e.mahallId, status: e.status,
    name: e.name, code: e.code, address: e.address, phone: e.phone, contactName: e.contactName,
    billingMode: e.billingMode, monthlyFee: e.monthlyFee ?? 0, cubicPrice: e.cubicPrice ?? 0,
    contractNumber: e.contractNumber, contractStartMonth: e.contractStartMonth,
    lat: e.lat ?? null, lon: e.lon ?? null,
    districtName: e.district?.name ?? null, mahallaName: e.mahalla?.name ?? null,
  }
}

interface Analysis {
  cols: Partial<Record<ColumnKey, number>>
  headerRow: number
  valid: ParsedEntityRow[]
  errors: RowError[]
  warnings: RowError[]
  duplicates: { rowNumber: number; stir: string; firstRowNumber: number }[]
  existingStirs: Map<string, ExistingRecord>
  newDistricts: string[]
  newMahallas: { district: string; mahalla: string }[]
  totalRows: number
}

/** Faylni o'qib, tekshirib, natijani qaytaradi (preview va confirm uchun umumiy). */
async function analyzeFile(req: MulterRequest): Promise<Analysis> {
  const { orgId } = req.ekoUser!
  const file = req.file!

  // ExcelJS ochishdan OLDIN: kengaytma, sehrli baytlar, ZIP hajmi, varaq o'lchami
  const guard = checkXlsxUpload(file)
  if (!guard.ok) throw new ImportInputError(guard.error)

  const defaultDistrictName = req.body?.defaultDistrictName
    ? String(req.body.defaultDistrictName).trim().slice(0, 100)
    : null

  const { header, headerRow, rows } = await readWorkbook(file.buffer)
  if (rows.length > MAX_ROWS) {
    throw new ImportInputError(`Faylda ${rows.length} qator — maksimal ${MAX_ROWS} ta. Faylni bo'lib yuklang.`)
  }

  const cols = detectColumns(header)
  if (cols.name === undefined) {
    throw new ImportInputError(
      'Tashkilot nomi ustuni topilmadi. Sarlavha qatorida "Nomi" (yoki "Наименование") bo\'lishi kerak — namuna shablonni yuklab oling.',
    )
  }

  const valid: ParsedEntityRow[] = []
  const errors: RowError[] = []
  const warnings: RowError[] = []
  for (const { cells, rowNumber } of rows) {
    const r = parseImportRow(cells, cols, rowNumber, { defaultDistrictName })
    warnings.push(...r.warnings)
    if (r.ok && r.row) valid.push(r.row)
    else errors.push(...r.errors)
  }

  const { unique, duplicates } = findDuplicates(valid)

  // Bazada mavjud STIRlar (yangilanadimi yoki o'tkazib yuboriladimi — foydalanuvchi tanlaydi)
  const stirs = unique.map(r => r.stir).filter(Boolean) as string[]
  const existing = stirs.length > 0
    ? await (prisma as any).ekoHisobLegalEntity.findMany({
        where: { orgId, stir: { in: stirs } },
        select: EXISTING_SELECT,
      })
    : []
  const existingStirs = new Map<string, ExistingRecord>(existing.map((e: any) => [e.stir, toExisting(e)]))

  const [districts, mahallas] = await Promise.all([
    (prisma as any).ekoHisobDistrict.findMany({ where: { orgId }, select: { id: true, name: true } }),
    (prisma as any).ekoHisobMahalla.findMany({
      where: { district: { orgId } }, select: { id: true, name: true, districtId: true },
    }),
  ])
  const { newDistricts, newMahallas } = collectNewPlaces(unique, districts, mahallas)

  return {
    cols, headerRow, valid: unique, errors, warnings, duplicates, existingStirs,
    newDistricts, newMahallas, totalRows: rows.length,
  }
}

function sendInputError(res: Response, err: any): boolean {
  if (err instanceof ImportInputError) {
    res.status(400).json({
      success: false, error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.data !== undefined ? { data: err.data } : {}),
    })
    return true
  }
  return false
}

/**
 * POST /entities/import/preview — faylni tahlil qiladi, HECH NARSA SAQLAMAYDI.
 * Foydalanuvchi natijani ko'rib, keyin tasdiqlaydi.
 */
export async function previewImport(req: MulterRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Excel fayl (.xlsx) yuklanmadi' })
      return
    }
    const a = await analyzeFile(req)

    const willUpdate = a.valid.filter(r => r.stir && a.existingStirs.has(r.stir))
    const willCreate = a.valid.filter(r => !r.stir || !a.existingStirs.has(r.stir))

    // "update" rejimida nima o'zgarishi: eski → yangi (bo'sh kataklar o'zgartirmaydi)
    const diffs = willUpdate.map(r => {
      const ex = a.existingStirs.get(r.stir!)!
      const m = mergeImportRow(ex, r)
      return { rowNumber: r.rowNumber, stir: r.stir, name: ex.name, changes: m.changes }
    })
    const changed = diffs.filter(d => d.changes.length > 0)

    res.json({
      success: true,
      data: {
        fileName: req.file.originalname,
        totalRows: a.totalRows,
        headerRow: a.headerRow,
        // Aniqlangan ustunlar — UI'da "qaysi ustun nimaga tushdi" ko'rsatiladi
        detectedColumns: a.cols,
        validCount: a.valid.length,
        createCount: willCreate.length,
        updateCount: willUpdate.length,
        errors: a.errors.slice(0, 200),
        errorCount: a.errors.length,
        warnings: a.warnings.slice(0, 200),
        warningCount: a.warnings.length,
        duplicates: a.duplicates.slice(0, 100),
        duplicateCount: a.duplicates.length,
        newDistricts: a.newDistricts,
        // true bo'lsa confirm so'rovida `confirmNewDistricts=true` yuborilishi SHART
        requiresNewDistrictConfirm: a.newDistricts.length > 0,
        newMahallas: a.newMahallas.slice(0, 200),
        newMahallaCount: a.newMahallas.length,
        // Birinchi 20 qator — foydalanuvchi to'g'ri o'qilganiga ishonch hosil qilsin
        sample: a.valid.slice(0, 20),
        existingSample: willUpdate.slice(0, 20).map(r => ({
          rowNumber: r.rowNumber, name: r.name, stir: r.stir,
          existingName: a.existingStirs.get(r.stir!)?.name,
        })),
        // Maydon diff'i (faqat 'update' rejimida qo'llanadi)
        updateDiffs: changed.slice(0, 50),
        updateChangedCount: changed.length,
        updateUnchangedCount: diffs.length - changed.length,
      },
    })
  } catch (err: any) {
    if (sendInputError(res, err)) return
    next(err)
  }
}

/**
 * POST /entities/import/confirm — tasdiqlangan qatorlarni bazaga yozadi.
 * Fayl QAYTA yuklanadi (server holat saqlamaydi — bir necha admin bir vaqtda
 * import qilsa chalkashmasin).
 *
 * Body: onDuplicate = 'skip' | 'update' (STIR bazada mavjud bo'lsa nima qilinsin)
 *       confirmNewDistricts = 'true' (yangi tuman yaratilishi kerak bo'lsa MAJBURIY)
 *
 * Yozish: CHUNK_SIZE qatorli tranzaksiyalar, har biri korxona advisory lock ostida
 * (STIR takrori poygasidan himoya). Chunk yiqilsa — faqat shu chunk qatorlari xato bo'ladi.
 */
export async function confirmImport(req: MulterRequest, res: Response, next: NextFunction): Promise<void> {
  const { orgId } = req.ekoUser ?? ({} as any)
  let locked = false
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Excel fayl (.xlsx) yuklanmadi' })
      return
    }
    const { id: userId, email } = req.ekoUser!
    const onDuplicate = req.body?.onDuplicate === 'update' ? 'update' : 'skip'
    const confirmNew = req.body?.confirmNewDistricts === true || String(req.body?.confirmNewDistricts) === 'true'

    if (importsInProgress.has(orgId)) {
      res.status(409).json({ success: false, error: "Boshqa import hozir bajarilmoqda — tugashini kuting" })
      return
    }
    importsInProgress.add(orgId); locked = true

    const a = await analyzeFile(req)
    if (a.valid.length === 0) {
      res.status(400).json({
        success: false,
        error: `Import qilinadigan to'g'ri qator yo'q (${a.errors.length} ta xato)`,
      })
      return
    }
    if (a.newDistricts.length > 0 && !confirmNew) {
      res.status(400).json({
        success: false, code: 'NEW_DISTRICTS_CONFIRM_REQUIRED',
        error: `Faylda bazada yo'q ${a.newDistricts.length} ta yangi tuman bor. Imlo xatosi bo'lmasa, tasdiqlang (confirmNewDistricts=true).`,
        data: { newDistricts: a.newDistricts },
      })
      return
    }

    const batch = await (prisma as any).ekoHisobImportBatch.create({
      data: {
        orgId,
        userId: userId || null,
        userName: email || '—',
        fileName: String(req.file.originalname ?? '').slice(0, 200),
        totalRows: a.totalRows,
        failed: a.errors.length,
      },
    })

    // ── Tuman/mahalla lug'ati: mavjudlarini yuklab, yetishmayotganini yaratamiz (bitta lock ostida) ──
    let createdDistricts = 0
    let createdMahallas = 0
    const districtByKey = new Map<string, string>()
    const mahallaByKey = new Map<string, string>()
    await withOrgLock(orgId, 'entity-place', async tx => {
      const districts = await tx.ekoHisobDistrict.findMany({ where: { orgId }, select: { id: true, name: true } })
      for (const d of districts) districtByKey.set(normalizePlaceName(d.name), d.id)
      const mahallas = await tx.ekoHisobMahalla.findMany({
        where: { district: { orgId } }, select: { id: true, name: true, districtId: true },
      })
      for (const m of mahallas) mahallaByKey.set(`${m.districtId}|${normalizePlaceName(m.name)}`, m.id)

      for (const r of a.valid) {
        const dKey = normalizePlaceName(r.districtName!)
        let districtId = districtByKey.get(dKey)
        if (!districtId) {
          const c = await tx.ekoHisobDistrict.create({ data: { name: r.districtName!.trim(), orgId }, select: { id: true } })
          districtId = c.id as string
          districtByKey.set(dKey, districtId)
          createdDistricts++
        }
        if (r.mahallaName) {
          const mKey = `${districtId}|${normalizePlaceName(r.mahallaName)}`
          if (!mahallaByKey.has(mKey)) {
            const c = await tx.ekoHisobMahalla.create({ data: { name: r.mahallaName.trim(), districtId }, select: { id: true } })
            mahallaByKey.set(mKey, c.id)
            createdMahallas++
          }
        }
      }
    })

    let created = 0, updated = 0, skipped = 0, unchanged = 0
    const failures: RowError[] = []
    const updates: { id: string; name: string; stir: string | null; changes: ImportChange[] }[] = []

    for (let i = 0; i < a.valid.length; i += CHUNK_SIZE) {
      const chunk = a.valid.slice(i, i + CHUNK_SIZE)
      try {
        const out = await withOrgLock(orgId, 'entity-stir', async tx => {
          // Qulf ostida YANGI holat: boshqa import/qo'lda kiritish bilan poyga bo'lmasin
          const stirs = chunk.map(r => r.stir).filter(Boolean) as string[]
          const fresh = stirs.length > 0
            ? await tx.ekoHisobLegalEntity.findMany({ where: { orgId, stir: { in: stirs } }, select: EXISTING_SELECT })
            : []
          const freshByStir = new Map<string, ExistingRecord>(fresh.map((e: any) => [e.stir, toExisting(e)]))

          const local = { created: 0, updated: 0, skipped: 0, unchanged: 0, updates: [] as typeof updates }
          for (const r of chunk) {
            const districtId = districtByKey.get(normalizePlaceName(r.districtName!))!
            const mahallId = r.mahallaName
              ? (mahallaByKey.get(`${districtId}|${normalizePlaceName(r.mahallaName)}`) ?? null)
              : null
            const ex = r.stir ? freshByStir.get(r.stir) : undefined

            if (ex) {
              if (onDuplicate === 'skip') { local.skipped++; continue }
              const m = mergeImportRow(ex, r)
              if (m.changes.length === 0) { local.unchanged++; continue }
              const data: Record<string, unknown> = { ...m.patch }
              if (m.districtChanged) data.districtId = districtId
              if (m.districtChanged || m.mahallaChanged) data.mahallId = mahallId
              await tx.ekoHisobLegalEntity.update({ where: { id: ex.id }, data })
              local.updated++
              local.updates.push({ id: ex.id, name: ex.name, stir: ex.stir, changes: m.changes })
            } else {
              await tx.ekoHisobLegalEntity.create({
                data: {
                  name: r.name, stir: r.stir, code: r.code, address: r.address, phone: r.phone,
                  contactName: r.contactName, districtId, mahallId: mahallId, billingMode: r.billingMode,
                  monthlyFee: r.monthlyFee, cubicPrice: r.cubicPrice, contractNumber: r.contractNumber,
                  contractStartMonth: r.contractStartMonth, lat: r.lat, lon: r.lon,
                  orgId, createdBy: userId || null, importBatchId: batch.id,
                },
              })
              local.created++
              if (r.stir) freshByStir.set(r.stir, { id: '', stir: r.stir } as any)
            }
          }
          return local
        })
        created += out.created; updated += out.updated; skipped += out.skipped; unchanged += out.unchanged
        updates.push(...out.updates)
      } catch (chunkErr: any) {
        // Prisma/DB xato matni foydalanuvchiga CHIQMAYDI (sxema/maydon nomlari sizib chiqmasin) — faqat logga
        console.error('[EkoImport] chunk xatosi:', chunkErr?.code ?? '', chunkErr?.message ?? chunkErr)
        for (const r of chunk) failures.push({ rowNumber: r.rowNumber, message: GENERIC_ROW_ERROR })
      }
    }

    const finalBatch = await (prisma as any).ekoHisobImportBatch.update({
      where: { id: batch.id },
      data: { created, updated, skipped, failed: a.errors.length + failures.length },
    })

    await logEkoAudit(req.ekoUser, {
      action: 'entity.import',
      targetType: 'entity',
      targetId: batch.id,
      targetName: req.file.originalname,
      details: {
        created, updated, skipped, unchanged,
        failed: a.errors.length + failures.length,
        createdDistricts, createdMahallas, onDuplicate,
        warnings: a.warnings.length,
        // Yangilangan yozuvlarning ESKI qiymatlari (qaytarish/tekshirish uchun) — 200 tagacha
        updates: updates.slice(0, 200),
        updatesTruncated: updates.length > 200,
      },
    })

    res.json({
      success: true,
      data: {
        batch: finalBatch,
        created, updated, skipped, unchanged,
        createdDistricts, createdMahallas,
        failed: a.errors.length + failures.length,
        failures: [...a.errors, ...failures].slice(0, 200),
        warnings: a.warnings.slice(0, 200),
        warningCount: a.warnings.length,
      },
    })
  } catch (err: any) {
    if (sendInputError(res, err)) return
    next(err)
  } finally {
    if (locked) importsInProgress.delete(orgId)
  }
}

/** GET /entities/import/template — namuna .xlsx (sarlavhalar + misol + izoh varag'i) */
export async function downloadImportTemplate(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()

    const ws = wb.addWorksheet('Tashkilotlar')
    const headers = [
      'Nomi', 'STIR', 'Manzil', 'Telefon', "Mas'ul shaxs",
      'Tuman', 'Mahalla', 'Rejim', 'Oylik', 'Kub narxi',
      'Shartnoma', 'Shartnoma sanasi',
    ]
    const hdr = ws.addRow(headers)
    hdr.font = { bold: true }
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    hdr.eachCell(c => { c.border = { bottom: { style: 'thin' } } })
    ws.columns = headers.map((h, i) => ({ width: i === 0 ? 32 : i === 2 ? 28 : 16 }))

    ws.addRow(['"Oq Yo\'l" MChJ', '123456789', 'Chilonzor 12-uy', '901234567', 'Aliyev A.',
      'Chilonzor', 'Navbahor', 'Belgilangan oylik', 450000, '', 'SH-2026/14', '2026-01'])
    ws.addRow(['"Bahor" savdo markazi', '987654321', 'Yunusobod 4-mavze', '935556677', 'Karimov B.',
      'Yunusobod', 'Bodomzor', 'Talon', '', 35000, 'SH-2026/15', '2026-03'])

    const info = wb.addWorksheet('Izoh')
    info.columns = [{ width: 22 }, { width: 80 }]
    const infoHdr = info.addRow(['Ustun', 'Tushuntirish'])
    infoHdr.font = { bold: true }
    const notes: [string, string][] = [
      ['Nomi', 'MAJBURIY. Tashkilotning to\'liq nomi.'],
      ['STIR', 'Ixtiyoriy, lekin 9 xonali bo\'lishi kerak. Takroriy importda tashkilotni tanish uchun ishlatiladi.'],
      ['Tuman', 'MAJBURIY. Bazada bo\'lmasa yaratiladi (tasdiqlash so\'raladi). Kirill/lotin imlosi farq qilmaydi.'],
      ['Mahalla', 'Ixtiyoriy. Bazada bo\'lmasa avtomatik yaratiladi.'],
      ['Rejim', '"Belgilangan oylik" | "O\'zgaruvchan" | "Talon". Bo\'sh qoldirilsa — yangi tashkilot uchun O\'zgaruvchan; mavjud tashkilot yangilanganda o\'zgarmaydi.'],
      ['Oylik', '"Belgilangan oylik" rejimida MAJBURIY. Masalan: 450000, 450 000 yoki 450.000.'],
      ['Kub narxi', '"Talon" rejimida MAJBURIY — bir kub chiqindi narxi.'],
      ['Telefon', 'Ixtiyoriy. 901234567, +998 90 123-45-67 — hammasi qabul qilinadi. SMS eslatma shu raqamga boradi.'],
      ['Shartnoma sanasi', 'Ixtiyoriy. 2026-03 yoki 01.03.2026. Hisoblar shu oydan boshlab yoziladi.'],
      ['Yangilash qoidasi', 'Mavjud tashkilot (STIR bo\'yicha) yangilanganda faylda BO\'SH qolgan katak bazadagi qiymatni o\'chirmaydi.'],
    ]
    for (const [col, text] of notes) {
      const row = info.addRow([col, text])
      row.getCell(1).font = { bold: true }
      row.getCell(2).alignment = { wrapText: true }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="ekohisob_import_namuna.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

/** GET /entities/import/batches — import tarixi */
export async function listImportBatches(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const batches = await (prisma as any).ekoHisobImportBatch.findMany({
      where: { orgId }, orderBy: { createdAt: 'desc' }, take: 50,
    })
    // Har partiyada nechta tashkilot HOZIR ham mavjud (undo imkoniyatini ko'rsatish uchun)
    const withCounts = await Promise.all(batches.map(async (b: any) => ({
      ...b,
      remaining: b.undoneAt ? 0 : await (prisma as any).ekoHisobLegalEntity.count({
        where: { importBatchId: b.id },
      }),
    })))
    res.json({ success: true, data: withCounts })
  } catch (err) { next(err) }
}

/**
 * POST /entities/import/batches/:id/undo { confirmPhrase: "IMPORTNI BEKOR QILISH" } — importni bekor qiladi.
 * (Faqat admin; marshrutda requireEkoAdmin.)
 *
 * confirmPhrase yo'q/noto'g'ri bo'lsa HECH NARSA O'ZGARMAYDI — 400 va nimalar o'chishi (dry-run) qaytadi.
 *
 * FAQAT "toza" tashkilotlar o'chiriladi: to'lovi, taloni yoki hisobi yo'q. O'chirish bitta
 * tranzaksiyada, korxona qulfi ostida, va `deleteMany` shartida bu "yo'q" sharti QAYTA tekshiriladi
 * (tekshiruv bilan o'chirish orasida to'lov yozilsa, o'chirilmaydi — to'lov Cascade bilan yo'qolmasin).
 * Pul aylanmasi boshlangan tashkilotlar 'inactive' qilinadi va javobda sanab beriladi.
 * ESLATMA: 'update' rejimida yangilangan MAVJUD tashkilotlar qaytarilmaydi (eski qiymatlar auditda).
 */
export async function undoImportBatch(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const { id } = req.params

    const batch0 = await (prisma as any).ekoHisobImportBatch.findUnique({ where: { id } })
    if (!batch0 || batch0.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Import partiyasi topilmadi' })
      return
    }
    if (batch0.undoneAt) {
      res.status(400).json({ success: false, error: 'Bu import allaqachon bekor qilingan' })
      return
    }

    const phraseOk = String(req.body?.confirmPhrase ?? '').trim() === UNDO_CONFIRM_PHRASE
    if (!phraseOk) {
      // Dry-run: nimalar bo'lishini ko'rsatamiz
      const preview = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: { importBatchId: id, orgId },
        select: { id: true, _count: { select: { payments: true, talons: true, charges: true } } },
      })
      const keep = preview.filter((e: any) => e._count.payments + e._count.talons + e._count.charges > 0).length
      res.status(400).json({
        success: false, code: 'CONFIRM_REQUIRED',
        error: `Importni bekor qilish uchun tasdiq iborasini yozing: ${UNDO_CONFIRM_PHRASE}`,
        data: { confirmPhrase: UNDO_CONFIRM_PHRASE, willDelete: preview.length - keep, willKeep: keep },
      })
      return
    }

    const result = await withOrgLock(orgId, 'entity-stir', async tx => {
      const batch = await tx.ekoHisobImportBatch.findUnique({ where: { id } })
      if (!batch || batch.orgId !== orgId || batch.undoneAt) throw new ImportInputError('Bu import allaqachon bekor qilingan')

      const entities = await tx.ekoHisobLegalEntity.findMany({
        where: { importBatchId: id, orgId },
        select: { id: true, _count: { select: { payments: true, talons: true, charges: true } } },
      })
      const cleanIds = entities
        .filter((e: any) => e._count.payments === 0 && e._count.talons === 0 && e._count.charges === 0)
        .map((e: any) => e.id)

      let deleted = 0
      if (cleanIds.length > 0) {
        const del = await tx.ekoHisobLegalEntity.deleteMany({
          where: {
            id: { in: cleanIds }, orgId, importBatchId: id,
            payments: { none: {} }, talons: { none: {} }, charges: { none: {} },
          },
        })
        deleted = del.count ?? 0
      }

      // O'chmay qolganlar (pul aylanmasi bor yoki orada to'lov yozilgan): nofaol qilinadi
      const kept = await tx.ekoHisobLegalEntity.findMany({
        where: { importBatchId: id, orgId },
        select: { id: true, name: true, status: true },
      })
      let deactivated = 0
      if (kept.length > 0) {
        const up = await tx.ekoHisobLegalEntity.updateMany({
          where: { id: { in: kept.map((e: any) => e.id) }, orgId, status: { in: ['active', 'draft'] } },
          data: { status: 'inactive' },
        })
        deactivated = up.count ?? 0
      }

      await tx.ekoHisobImportBatch.update({ where: { id }, data: { undoneAt: new Date(), undoneBy: userId || null } })
      return { deleted, kept, deactivated, fileName: batch.fileName }
    })

    await logEkoAudit(req.ekoUser, {
      action: 'entity.import_undo',
      targetType: 'entity',
      targetId: id,
      targetName: result.fileName,
      details: {
        deleted: result.deleted,
        kept: result.kept.length,
        deactivated: result.deactivated,
        keptNames: result.kept.slice(0, 50).map((e: any) => e.name),
      },
    })

    res.json({
      success: true,
      data: {
        deleted: result.deleted,
        kept: result.kept.length,
        deactivated: result.deactivated,
        keptEntities: result.kept.slice(0, 50).map((e: any) => ({ id: e.id, name: e.name })),
      },
      message: result.kept.length > 0
        ? `${result.deleted} ta tashkilot o'chirildi. ${result.kept.length} tasida to'lov/talon bor — ular saqlanib, nofaol qilindi.`
        : `${result.deleted} ta tashkilot o'chirildi`,
    })
  } catch (err: any) {
    if (sendInputError(res, err)) return
    next(err)
  }
}
