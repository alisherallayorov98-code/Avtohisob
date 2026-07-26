import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { logEkoAudit } from '../lib/ekoAudit'
import {
  detectColumns, parseImportRow, findDuplicates, collectNewPlaces,
  normalizePlaceName, ColumnKey, ParsedEntityRow, RowError,
} from '../lib/entityImport'

// Bitta importda ruxsat etilgan maksimal qator — tasodifiy ulkan fayl serverni
// bo'g'ib qo'ymasligi uchun. Katta shahar ham bir necha partiyaga bo'linadi.
const MAX_ROWS = 10000

// multer `req.file` ni Express.Multer.File sifatida qo'shadi (@types/multer)
type MulterRequest = EkoRequest

/** Yuklangan .xlsx dan sarlavha + qatorlarni o'qiydi. */
async function readWorkbook(buffer: Buffer): Promise<{ header: unknown[]; rows: { cells: unknown[]; rowNumber: number }[] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('Faylda varaq topilmadi')

  let header: unknown[] = []
  const rows: { cells: unknown[]; rowNumber: number }[] = []

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // ExcelJS `values` 1-indeksli — 0-elementni tashlaymiz
    const cells = (row.values as unknown[]).slice(1).map((c: any) => {
      if (c == null) return ''
      if (c instanceof Date) return c
      // Formula/hyperlink katakchalari obyekt bo'lib keladi
      if (typeof c === 'object') return c.result ?? c.text ?? c.hyperlink ?? ''
      return c
    })
    if (rowNumber === 1) { header = cells; return }
    // To'liq bo'sh qatorni o'tkazib yuboramiz
    if (cells.every(c => c === '' || c == null)) return
    rows.push({ cells, rowNumber })
  })

  return { header, rows }
}

/** Faylni o'qib, tekshirib, natijani qaytaradi (preview va confirm uchun umumiy). */
async function analyzeFile(
  req: MulterRequest,
): Promise<{
  cols: Partial<Record<ColumnKey, number>>
  valid: ParsedEntityRow[]
  errors: RowError[]
  duplicates: { rowNumber: number; stir: string; firstRowNumber: number }[]
  existingStirs: Map<string, { id: string; name: string; districtId: string }>
  newDistricts: string[]
  newMahallas: { district: string; mahalla: string }[]
  totalRows: number
}> {
  const { orgId } = req.ekoUser!
  const defaultDistrictName = req.body?.defaultDistrictName
    ? String(req.body.defaultDistrictName).trim()
    : null

  const { header, rows } = await readWorkbook(req.file!.buffer)
  if (rows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Faylda ${rows.length} qator — maksimal ${MAX_ROWS} ta. Faylni bo'lib yuklang.`), { status: 400 })
  }

  const cols = detectColumns(header)
  if (cols.name === undefined) {
    throw Object.assign(
      new Error('Tashkilot nomi ustuni topilmadi. Sarlavha qatorida "Nomi" (yoki "Наименование") bo\'lishi kerak — namuna shablonni yuklab oling.'),
      { status: 400 },
    )
  }

  const valid: ParsedEntityRow[] = []
  const errors: RowError[] = []
  for (const { cells, rowNumber } of rows) {
    const r = parseImportRow(cells, cols, rowNumber, { defaultDistrictName })
    if (r.ok && r.row) valid.push(r.row)
    else errors.push(...r.errors)
  }

  const { unique, duplicates } = findDuplicates(valid)

  // Bazada mavjud STIRlar (yangilanadimi yoki o'tkazib yuboriladimi — foydalanuvchi tanlaydi)
  const stirs = unique.map(r => r.stir).filter(Boolean) as string[]
  const existing = stirs.length > 0
    ? await (prisma as any).ekoHisobLegalEntity.findMany({
        where: { orgId, stir: { in: stirs } },
        select: { id: true, name: true, stir: true, districtId: true },
      })
    : []
  const existingStirs = new Map<string, { id: string; name: string; districtId: string }>(
    existing.map((e: any) => [e.stir, { id: e.id, name: e.name, districtId: e.districtId }]),
  )

  const [districts, mahallas] = await Promise.all([
    (prisma as any).ekoHisobDistrict.findMany({ where: { orgId }, select: { id: true, name: true } }),
    (prisma as any).ekoHisobMahalla.findMany({
      where: { district: { orgId } }, select: { id: true, name: true, districtId: true },
    }),
  ])
  const { newDistricts, newMahallas } = collectNewPlaces(unique, districts, mahallas)

  return {
    cols, valid: unique, errors, duplicates, existingStirs,
    newDistricts, newMahallas, totalRows: rows.length,
  }
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

    res.json({
      success: true,
      data: {
        fileName: req.file.originalname,
        totalRows: a.totalRows,
        // Aniqlangan ustunlar — UI'da "qaysi ustun nimaga tushdi" ko'rsatiladi
        detectedColumns: a.cols,
        validCount: a.valid.length,
        createCount: willCreate.length,
        updateCount: willUpdate.length,
        errors: a.errors.slice(0, 200),
        errorCount: a.errors.length,
        duplicates: a.duplicates.slice(0, 100),
        duplicateCount: a.duplicates.length,
        newDistricts: a.newDistricts,
        newMahallas: a.newMahallas.slice(0, 200),
        newMahallaCount: a.newMahallas.length,
        // Birinchi 20 qator — foydalanuvchi to'g'ri o'qilganiga ishonch hosil qilsin
        sample: a.valid.slice(0, 20),
        existingSample: willUpdate.slice(0, 20).map(r => ({
          rowNumber: r.rowNumber, name: r.name, stir: r.stir,
          existingName: a.existingStirs.get(r.stir!)?.name,
        })),
      },
    })
  } catch (err: any) {
    if (err?.status === 400) { res.status(400).json({ success: false, error: err.message }); return }
    next(err)
  }
}

/**
 * POST /entities/import/confirm — tasdiqlangan qatorlarni bazaga yozadi.
 * Fayl QAYTA yuklanadi (server holat saqlamaydi — bir necha admin bir vaqtda
 * import qilsa chalkashmasin).
 *
 * Body: onDuplicate = 'skip' | 'update' (STIR bazada mavjud bo'lsa nima qilinsin)
 */
export async function confirmImport(req: MulterRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Excel fayl (.xlsx) yuklanmadi' })
      return
    }
    const { orgId, id: userId, email } = req.ekoUser!
    const onDuplicate = req.body?.onDuplicate === 'update' ? 'update' : 'skip'

    const a = await analyzeFile(req)
    if (a.valid.length === 0) {
      res.status(400).json({
        success: false,
        error: `Import qilinadigan to'g'ri qator yo'q (${a.errors.length} ta xato)`,
      })
      return
    }

    const batch = await (prisma as any).ekoHisobImportBatch.create({
      data: {
        orgId,
        userId: userId || null,
        userName: email || '—',
        fileName: req.file.originalname,
        totalRows: a.totalRows,
        failed: a.errors.length,
      },
    })

    // ── Tuman/mahalla lug'ati: mavjudlarini yuklab, yetishmayotganini yaratamiz ──
    const districts = await (prisma as any).ekoHisobDistrict.findMany({
      where: { orgId }, select: { id: true, name: true },
    })
    const districtByKey = new Map<string, string>(
      districts.map((d: any) => [normalizePlaceName(d.name), d.id]),
    )
    const mahallas = await (prisma as any).ekoHisobMahalla.findMany({
      where: { district: { orgId } }, select: { id: true, name: true, districtId: true },
    })
    const mahallaByKey = new Map<string, string>(
      mahallas.map((m: any) => [`${m.districtId}|${normalizePlaceName(m.name)}`, m.id]),
    )

    let createdDistricts = 0
    let createdMahallas = 0

    async function resolveDistrictId(name: string): Promise<string> {
      const key = normalizePlaceName(name)
      const found = districtByKey.get(key)
      if (found) return found
      const created = await (prisma as any).ekoHisobDistrict.create({
        data: { name: name.trim(), orgId }, select: { id: true },
      })
      districtByKey.set(key, created.id)
      createdDistricts++
      return created.id
    }

    async function resolveMahallaId(districtId: string, name: string | null): Promise<string | null> {
      if (!name) return null
      const key = `${districtId}|${normalizePlaceName(name)}`
      const found = mahallaByKey.get(key)
      if (found) return found
      const created = await (prisma as any).ekoHisobMahalla.create({
        data: { name: name.trim(), districtId }, select: { id: true },
      })
      mahallaByKey.set(key, created.id)
      createdMahallas++
      return created.id
    }

    let created = 0, updated = 0, skipped = 0
    const failures: RowError[] = []

    for (const r of a.valid) {
      try {
        const districtId = await resolveDistrictId(r.districtName!)
        const mahallId = await resolveMahallaId(districtId, r.mahallaName)

        const data: any = {
          name: r.name,
          stir: r.stir,
          code: r.code,
          address: r.address,
          phone: r.phone,
          contactName: r.contactName,
          districtId,
          mahallId,
          billingMode: r.billingMode,
          monthlyFee: r.monthlyFee,
          cubicPrice: r.cubicPrice,
          contractNumber: r.contractNumber,
          contractStartMonth: r.contractStartMonth,
          lat: r.lat,
          lon: r.lon,
        }

        const existing = r.stir ? a.existingStirs.get(r.stir) : undefined
        if (existing) {
          if (onDuplicate === 'skip') { skipped++; continue }
          await (prisma as any).ekoHisobLegalEntity.update({ where: { id: existing.id }, data })
          updated++
        } else {
          await (prisma as any).ekoHisobLegalEntity.create({
            data: { ...data, orgId, createdBy: userId || null, importBatchId: batch.id },
          })
          created++
        }
      } catch (rowErr: any) {
        failures.push({ rowNumber: r.rowNumber, message: rowErr?.message ?? 'Saqlashda xato' })
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
        created, updated, skipped,
        failed: a.errors.length + failures.length,
        createdDistricts, createdMahallas, onDuplicate,
      },
    })

    res.json({
      success: true,
      data: {
        batch: finalBatch,
        created, updated, skipped,
        createdDistricts, createdMahallas,
        failed: a.errors.length + failures.length,
        failures: [...a.errors, ...failures].slice(0, 200),
      },
    })
  } catch (err: any) {
    if (err?.status === 400) { res.status(400).json({ success: false, error: err.message }); return }
    next(err)
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
      ['Tuman', 'MAJBURIY. Bazada bo\'lmasa avtomatik yaratiladi. Imlo bir xil bo\'lishiga e\'tibor bering.'],
      ['Mahalla', 'Ixtiyoriy. Bazada bo\'lmasa avtomatik yaratiladi.'],
      ['Rejim', '"Belgilangan oylik" | "O\'zgaruvchan" | "Talon". Bo\'sh qoldirilsa — O\'zgaruvchan.'],
      ['Oylik', '"Belgilangan oylik" rejimida MAJBURIY. Masalan: 450000 yoki 450 000.'],
      ['Kub narxi', '"Talon" rejimida MAJBURIY — bir kub chiqindi narxi.'],
      ['Telefon', 'Ixtiyoriy. 901234567, +998 90 123-45-67 — hammasi qabul qilinadi. SMS eslatma shu raqamga boradi.'],
      ['Shartnoma sanasi', 'Ixtiyoriy. 2026-03 yoki 01.03.2026. Hisoblar shu oydan boshlab yoziladi.'],
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
 * POST /entities/import/batches/:id/undo — importni bekor qiladi.
 *
 * FAQAT "toza" tashkilotlar o'chiriladi: to'lovi, taloni yoki hisobi yo'q.
 * Pul aylanmasi boshlangan tashkilot O'CHIRILMAYDI — javobda ular sanab beriladi.
 * Bu ataylab: import xatosini tuzatish uchun undo kerak, lekin u ma'lumot
 * yo'qotish quroliga aylanmasligi shart.
 */
export async function undoImportBatch(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const { id } = req.params

    const batch = await (prisma as any).ekoHisobImportBatch.findUnique({ where: { id } })
    if (!batch || batch.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Import partiyasi topilmadi' })
      return
    }
    if (batch.undoneAt) {
      res.status(400).json({ success: false, error: 'Bu import allaqachon bekor qilingan' })
      return
    }

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { importBatchId: id, orgId },
      select: {
        id: true, name: true,
        _count: { select: { payments: true, talons: true, charges: true } },
      },
    })

    const clean = entities.filter((e: any) =>
      e._count.payments === 0 && e._count.talons === 0 && e._count.charges === 0)
    const kept = entities.filter((e: any) =>
      e._count.payments > 0 || e._count.talons > 0 || e._count.charges > 0)

    let deleted = 0
    if (clean.length > 0) {
      const result = await (prisma as any).ekoHisobLegalEntity.deleteMany({
        where: { id: { in: clean.map((e: any) => e.id) } },
      })
      deleted = result.count ?? 0
    }

    await (prisma as any).ekoHisobImportBatch.update({
      where: { id },
      data: { undoneAt: new Date(), undoneBy: userId || null },
    })

    await logEkoAudit(req.ekoUser, {
      action: 'entity.import_undo',
      targetType: 'entity',
      targetId: id,
      targetName: batch.fileName,
      details: {
        deleted,
        kept: kept.length,
        keptNames: kept.slice(0, 50).map((e: any) => e.name),
      },
    })

    res.json({
      success: true,
      data: {
        deleted,
        kept: kept.length,
        keptEntities: kept.slice(0, 50).map((e: any) => ({ id: e.id, name: e.name })),
      },
      message: kept.length > 0
        ? `${deleted} ta tashkilot o'chirildi. ${kept.length} tasida to'lov/talon bor — ular saqlanib qoldi.`
        : `${deleted} ta tashkilot o'chirildi`,
    })
  } catch (err) { next(err) }
}
