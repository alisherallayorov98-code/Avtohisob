import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import multer from 'multer'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'

export const scheduleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/i)) cb(null, true)
    else cb(new Error('Faqat Excel fayl qabul qilinadi'))
  },
})

const DAY_HEADERS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']

// Excel shabloni: foydalanuvchining mashinalari va MFYlari ro'yxati bilan
export async function downloadScheduleTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)

    const [vehicles, mfys] = await Promise.all([
      prisma.vehicle.findMany({
        where: {
          status: 'active',
          ...(branchFilter ? { branchId: branchFilter } : {}),
        },
        select: { registrationNumber: true, brand: true, model: true },
        orderBy: { registrationNumber: 'asc' },
      }),
      (prisma as any).thMfy.findMany({
        where: orgId ? { organizationId: orgId } : {},
        select: { name: true, district: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
    ])

    const wb = new ExcelJS.Workbook()

    // ─── Asosiy varaq: Grafik ─────────────────────────────────────────────
    const ws = wb.addWorksheet('Grafik')
    ws.columns = [
      { header: 'Mashina (registratsiya raqami)', key: 'reg', width: 28 },
      { header: 'MFY nomi', key: 'mfy', width: 36 },
      { header: 'Du', key: 'du', width: 5 },
      { header: 'Se', key: 'se', width: 5 },
      { header: 'Ch', key: 'ch', width: 5 },
      { header: 'Pa', key: 'pa', width: 5 },
      { header: 'Ju', key: 'ju', width: 5 },
      { header: 'Sh', key: 'sh', width: 5 },
      { header: 'Ya', key: 'ya', width: 5 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' }

    // Namuna: birinchi 3 ta mashina × birinchi 2 ta MFY
    const sample: Array<[string, string]> = []
    for (let i = 0; i < Math.min(3, vehicles.length); i++) {
      for (let j = 0; j < Math.min(2, mfys.length); j++) {
        sample.push([vehicles[i].registrationNumber, mfys[j].name])
      }
    }
    sample.forEach(([reg, mfy]) => {
      ws.addRow({ reg, mfy, du: 'x', se: '', ch: 'x', pa: '', ju: 'x', sh: '', ya: '' })
    })

    // Izoh
    const noteRow = ws.addRow([])
    ws.mergeCells(`A${noteRow.number}:I${noteRow.number}`)
    noteRow.getCell(1).value = "Izoh: Du-Ya ustunlariga 'x' qo'ying — mashina o'sha kunlari ushbu MFY ga boradi. Bo'sh qoldirsa — bormaydi."
    noteRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }

    // ─── Yordamchi varaq: Mashinalar ──────────────────────────────────────
    const wsV = wb.addWorksheet('Mashinalar')
    wsV.columns = [
      { header: 'Registratsiya raqami', key: 'reg', width: 28 },
      { header: 'Marka/Model', key: 'mm', width: 30 },
    ]
    wsV.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    wsV.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }
    vehicles.forEach(v => wsV.addRow({ reg: v.registrationNumber, mm: `${v.brand || ''} ${v.model || ''}`.trim() }))

    // ─── Yordamchi varaq: MFYlar ──────────────────────────────────────────
    const wsM = wb.addWorksheet('MFYlar')
    wsM.columns = [
      { header: 'MFY nomi', key: 'name', width: 36 },
      { header: 'Tuman', key: 'district', width: 24 },
    ]
    wsM.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    wsM.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }
    mfys.forEach((m: any) => wsM.addRow({ name: m.name, district: m.district?.name || '' }))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="grafik-shablon.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

interface ImportError {
  row: number
  reason: string
}

interface ImportResult {
  imported: number
  updated: number
  deleted: number
  errors: ImportError[]
  totalRows: number
}

function isDayMarked(value: any): boolean {
  if (value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'x' || s === '+' || s === 'ha' || s === '1' || s === 'yes' || s === 'true'
}

export async function importSchedules(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Excel fayl talab qilinadi', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    // Foydalanuvchi tashkilotidagi mashinalar va MFYlar lookup
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)

    const [vehicles, mfys] = await Promise.all([
      prisma.vehicle.findMany({
        where: branchFilter ? { branchId: branchFilter } : {},
        select: { id: true, registrationNumber: true },
      }),
      (prisma as any).thMfy.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
    ])

    const vehicleByReg = new Map<string, string>()
    for (const v of vehicles) vehicleByReg.set(v.registrationNumber.trim().toUpperCase(), v.id)

    const mfyByName = new Map<string, string>()
    for (const m of mfys) mfyByName.set(m.name.trim().toLowerCase(), m.id)

    // Excel parse
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(req.file.buffer as any)
    const ws = wb.getWorksheet('Grafik') || wb.worksheets[0]
    if (!ws) throw new AppError("'Grafik' varaqasi topilmadi", 400)

    const result: ImportResult = { imported: 0, updated: 0, deleted: 0, errors: [], totalRows: 0 }
    const upsertOps: Array<{ vehicleId: string; mfyId: string; days: number[] }> = []

    ws.eachRow((row, idx) => {
      if (idx === 1) return // header

      const regCell = row.getCell(1).value
      const mfyCell = row.getCell(2).value

      const regStr = (regCell == null ? '' : String(regCell)).trim().toUpperCase()
      const mfyStr = (mfyCell == null ? '' : String(mfyCell)).trim()
      if (!regStr && !mfyStr) return // bo'sh qator

      result.totalRows++

      if (!regStr || !mfyStr) {
        result.errors.push({ row: idx, reason: 'Mashina yoki MFY ustuni bo\'sh' })
        return
      }

      const vehicleId = vehicleByReg.get(regStr)
      if (!vehicleId) {
        result.errors.push({ row: idx, reason: `Mashina topilmadi: ${regStr}` })
        return
      }

      const mfyId = mfyByName.get(mfyStr.toLowerCase())
      if (!mfyId) {
        result.errors.push({ row: idx, reason: `MFY topilmadi: ${mfyStr}` })
        return
      }

      const days: number[] = []
      for (let i = 0; i < 7; i++) {
        if (isDayMarked(row.getCell(3 + i).value)) days.push(i)
      }

      upsertOps.push({ vehicleId, mfyId, days })
    })

    // DB ga yozish (sequential, kichik batchlar)
    for (const op of upsertOps) {
      if (op.days.length === 0) {
        const del = await (prisma as any).thSchedule.deleteMany({
          where: { vehicleId: op.vehicleId, mfyId: op.mfyId },
        })
        result.deleted += del.count
      } else {
        const before = await (prisma as any).thSchedule.findUnique({
          where: { vehicleId_mfyId: { vehicleId: op.vehicleId, mfyId: op.mfyId } },
          select: { id: true },
        })
        await (prisma as any).thSchedule.upsert({
          where: { vehicleId_mfyId: { vehicleId: op.vehicleId, mfyId: op.mfyId } },
          create: { vehicleId: op.vehicleId, mfyId: op.mfyId, dayOfWeek: op.days },
          update: { dayOfWeek: op.days },
        })
        if (before) result.updated++
        else result.imported++
      }
    }

    res.json({
      success: true,
      data: result,
      message: `${result.imported} qo'shildi, ${result.updated} yangilandi, ${result.deleted} o'chirildi${result.errors.length ? `, ${result.errors.length} xato` : ''}`,
    })
  } catch (err) { next(err) }
}
