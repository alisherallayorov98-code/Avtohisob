import { Request, Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import multer from 'multer'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

export async function downloadTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('MFYlar')
    ws.columns = [{ header: 'MFY nomi', key: 'name', width: 40 }]
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    // Namuna qatorlar
    ;['Bog\'bon MFY', 'Navro\'z MFY', 'Mustaqillik MFY'].forEach(name => ws.addRow({ name }))

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="mfy-shablon.xlsx"')
    await wb.xlsx.write(res)
  } catch (err) { next(err) }
}

export async function importMfys(req: Request, res: Response, next: NextFunction) {
  try {
    const { districtId } = req.body
    if (!districtId) throw new AppError('Tuman tanlanishi shart', 400)
    if (!req.file) throw new AppError('Excel fayl yuklanmadi', 400)

    const district = await (prisma as any).thDistrict.findUnique({ where: { id: districtId }, select: { id: true } })
    if (!district) throw new AppError('Tuman topilmadi', 404)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(req.file.buffer as any)
    const ws = wb.worksheets[0]

    const names: string[] = []
    ws.eachRow((row, idx) => {
      if (idx === 1) return // header
      const val = row.getCell(1).value
      const name = typeof val === 'string' ? val.trim() : String(val ?? '').trim()
      if (name) names.push(name)
    })

    if (names.length === 0) throw new AppError('Faylda hech qanday ma\'lumot topilmadi', 400)
    if (names.length > 500) throw new AppError('Bir marta maksimum 500 ta MFY import qilish mumkin', 400)

    // Mavjudlarini tekshirib, yangilarini qo'shamiz
    const existing = await (prisma as any).thMfy.findMany({
      where: { districtId, name: { in: names } },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((m: any) => m.name))
    const newNames = names.filter(n => !existingNames.has(n))

    if (newNames.length > 0) {
      await (prisma as any).thMfy.createMany({
        data: newNames.map(name => ({ name, districtId })),
      })
    }

    res.json({
      success: true,
      data: { imported: newNames.length, skipped: existingNames.size, total: names.length },
      message: `${newNames.length} ta MFY qo'shildi${existingNames.size > 0 ? `, ${existingNames.size} ta allaqachon mavjud edi` : ''}`,
    })
  } catch (err) { next(err) }
}
