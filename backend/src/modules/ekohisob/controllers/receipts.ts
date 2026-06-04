import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

// Atomik ketma-ket raqam: orgId bo'yicha yil sifirlanadi
export async function nextReceiptNum(orgId: string): Promise<string> {
  const year = new Date().getFullYear()
  const rows: any[] = await prisma.$queryRawUnsafe(`
    INSERT INTO ekohisob_receipt_seq ("orgId", year, "lastNum")
    VALUES ($1, $2, 1)
    ON CONFLICT ("orgId") DO UPDATE
    SET "lastNum" = CASE
      WHEN ekohisob_receipt_seq.year = $2 THEN ekohisob_receipt_seq."lastNum" + 1
      ELSE 1
    END,
    year = $2
    RETURNING "lastNum"
  `, orgId, year)
  const num = Number(rows[0]?.lastNum ?? rows[0]?.lastnum ?? 1)
  return `EKO-${year}-${String(num).padStart(5, '0')}`
}

export async function getReceipt(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const receipt = await (prisma as any).ekoHisobReceipt.findUnique({
      where: { id },
      include: {
        entity: { select: { name: true, address: true, stir: true } },
        issuer: { select: { fullName: true } },
      },
    })
    if (!receipt || receipt.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Kvitansiya topilmadi' })
      return
    }
    res.json({ success: true, data: receipt })
  } catch (err) { next(err) }
}

const UZ_MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr']
function fmtMonth(m: string) {
  const [y, mo] = m.split('-')
  return `${UZ_MONTHS[parseInt(mo) - 1] || mo} ${y}`
}

export async function downloadInvoice(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { id } = req.params

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      include: {
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
        charges: { orderBy: { month: 'asc' } },
        payments: { orderBy: { month: 'asc' }, take: 36 },
      },
    })
    if (!entity || entity.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
      res.status(403).json({ success: false, error: 'Ruxsat yo\'q' })
      return
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'EkoHisob'
    wb.created = new Date()
    const ws = wb.addWorksheet('Faktura')
    ws.columns = [
      { key: 'a', width: 16 }, { key: 'b', width: 22 },
      { key: 'c', width: 22 }, { key: 'd', width: 18 }, { key: 'e', width: 16 },
    ]

    // Sarlavha
    const titleRow = ws.addRow(['YURIDIK TASHKILOT FAKTURASI'])
    titleRow.font = { bold: true, size: 13 }
    titleRow.alignment = { horizontal: 'center' }
    ws.mergeCells(`A${titleRow.number}:E${titleRow.number}`)
    ws.addRow([])

    // Tashkilot ma'lumotlari
    const infoItems: [string, any][] = [
      ['Tashkilot', entity.name],
      ...(entity.stir ? [['STIR', entity.stir] as [string, any]] : []),
      ...(entity.address ? [['Manzil', entity.address] as [string, any]] : []),
      ...(entity.contractNumber ? [['Shartnoma', entity.contractNumber] as [string, any]] : []),
      ['Tuman', entity.district.name + (entity.mahalla ? ` / ${entity.mahalla.name}` : '')],
      ['To\'lov rejimi', entity.billingMode === 'monthly_fixed' ? 'Belgilangan oylik' : 'O\'zgaruvchan'],
      ...(entity.monthlyFee > 0 ? [['Oylik to\'lov', `${entity.monthlyFee.toLocaleString('uz-UZ')} so'm`] as [string, any]] : []),
      ['Yaratildi', new Date().toLocaleDateString('uz-UZ')],
    ]
    for (const [label, value] of infoItems) {
      const row = ws.addRow([label + ':', value])
      row.getCell(1).font = { color: { argb: 'FF777777' } }
      row.getCell(2).font = { bold: true }
    }
    ws.addRow([])

    // Jadval sarlavhasi
    const statusMap: Record<string, string> = { paid: 'To\'langan', partial: 'Qisman', open: 'To\'lanmagan' }
    const hdr = ws.addRow(['Oy', 'Kutilgan (so\'m)', 'To\'langan (so\'m)', 'Qarz (so\'m)', 'Holat'])
    hdr.font = { bold: true }
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
    hdr.eachCell(c => { c.border = { bottom: { style: 'thin' } }; c.alignment = { horizontal: 'center' } })

    let totExp = 0, totPaid = 0, totDebt = 0

    if (entity.charges.length > 0) {
      for (const ch of entity.charges) {
        const debt = Math.max(0, ch.expectedAmount - ch.paidAmount)
        totExp += ch.expectedAmount
        totPaid += ch.paidAmount
        totDebt += debt
        const row = ws.addRow([fmtMonth(ch.month), ch.expectedAmount, ch.paidAmount, debt, statusMap[ch.status] || ch.status])
        if (ch.status === 'open') row.getCell(5).font = { color: { argb: 'FFCC0000' } }
        if (ch.status === 'paid') row.getCell(5).font = { color: { argb: 'FF006600' } }
        if (ch.status === 'partial') row.getCell(5).font = { color: { argb: 'FFCC6600' } }
        row.eachCell(c => { c.alignment = { vertical: 'middle' } })
      }
    } else {
      for (const p of entity.payments) {
        totPaid += p.amount
        const row = ws.addRow([fmtMonth(p.month), '—', p.amount, 0, 'To\'langan'])
        row.getCell(5).font = { color: { argb: 'FF006600' } }
        row.eachCell(c => { c.alignment = { vertical: 'middle' } })
      }
    }

    ws.addRow([])
    const tot = ws.addRow(['JAMI', totExp || '—', totPaid, totDebt, ''])
    tot.font = { bold: true }
    tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: totDebt > 0 ? 'FFFCE4EC' : 'FFE8F5E9' } }

    const safeName = entity.name.replace(/[^\p{L}0-9\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''faktura_${encodeURIComponent(safeName)}.xlsx`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
