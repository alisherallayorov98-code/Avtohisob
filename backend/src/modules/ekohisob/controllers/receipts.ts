import { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { uzDate, uzMonth, uzNum } from '../lib/dateFormat'
import { canAccessEntity } from '../lib/ekoScope'
import { getEntityBalance } from '../lib/debtMath'
import { loadEntityDebts } from '../services/entityDebtLoader'
import { nextReceiptNumberTx } from '../lib/receiptNumber'

// Atomik ketma-ket raqam: orgId bo'yicha, yil O'zbekiston vaqti bo'yicha sifirlanadi.
// ESLATMA: to'lov yozish yadrosi raqamni o'z tranzaksiyasi ichida oladi (nextReceiptNumberTx) —
// bu funksiya tranzaksiyadan tashqarida kerak bo'lgan qolgan joylar uchun.
export async function nextReceiptNum(orgId: string): Promise<string> {
  return nextReceiptNumberTx(prisma, orgId)
}

export async function getReceipt(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params
    const receipt = await (prisma as any).ekoHisobReceipt.findUnique({
      where: { id },
      include: {
        entity: { select: { name: true, address: true, stir: true, orgId: true, districtId: true } },
        issuer: { select: { fullName: true } },
      },
    })
    if (!receipt || receipt.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Kvitansiya topilmadi' })
      return
    }
    // Tuman nazorati: inspektor boshqa tuman tashkiloti kvitansiyasini ko'ra olmaydi
    if (!canAccessEntity(user, receipt.entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }
    res.json({ success: true, data: receipt })
  } catch (err) { next(err) }
}

export async function downloadInvoice(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { id } = req.params

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id },
      include: {
        district: { select: { name: true } },
        mahalla: { select: { name: true } },
        charges: { orderBy: { month: 'asc' } },
        payments: { orderBy: { month: 'asc' }, take: 36 },
        talons: { select: { date: true, amount: true, paid: true, paidAmount: true } },
      },
    })
    if (!entity || entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
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
      ...(entity.monthlyFee > 0 ? [['Oylik to\'lov', `${uzNum(entity.monthlyFee)} so'm`] as [string, any]] : []),
      ['Yaratildi', uzDate(new Date())],
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

    // JAMI qarz — kanonik SQL manba (kartochka/hisobot bilan aynan bir xil)
    const canon = (await loadEntityDebts([entity], user.orgId)).get(entity.id)!

    if (entity.billingMode === 'talon') {
      // Talon rejimi: oyma-oy talonlar summasi, to'langani va QARZI (kanonik balans)
      const bal = getEntityBalance({ billingMode: 'talon', talons: entity.talons })
      for (const m of bal.months) {
        const status = m.debt <= 0 ? 'paid' : m.paid > 0 ? 'partial' : 'open'
        totExp += m.expected
        totPaid += m.paid
        const row = ws.addRow([uzMonth(m.month), m.expected, m.paid, m.debt, statusMap[status]])
        row.getCell(5).font = { color: { argb: status === 'paid' ? 'FF006600' : status === 'partial' ? 'FFCC6600' : 'FFCC0000' } }
        row.eachCell(c => { c.alignment = { vertical: 'middle' } })
      }
    } else if (entity.charges.length > 0) {
      // Har oy qarzi — avans (ortiqcha to'lov) eng eski oylarni qoplagandan KEYIN (kanonik FIFO)
      const balDebt = new Map<string, number>(
        getEntityBalance({ billingMode: 'monthly_fixed', charges: entity.charges }).months.map(m => [m.month, m.debt]),
      )
      for (const ch of entity.charges) {
        const debt = balDebt.get(ch.month) ?? 0
        totExp += ch.expectedAmount
        totPaid += ch.paidAmount
        const row = ws.addRow([uzMonth(ch.month), ch.expectedAmount, ch.paidAmount, debt, statusMap[ch.status] || ch.status])
        if (ch.status === 'open') row.getCell(5).font = { color: { argb: 'FFCC0000' } }
        if (ch.status === 'paid') row.getCell(5).font = { color: { argb: 'FF006600' } }
        if (ch.status === 'partial') row.getCell(5).font = { color: { argb: 'FFCC6600' } }
        row.eachCell(c => { c.alignment = { vertical: 'middle' } })
      }
    } else {
      for (const p of entity.payments) {
        totPaid += p.amount
        const row = ws.addRow([uzMonth(p.month), '—', p.amount, 0, "To'langan"])
        row.getCell(5).font = { color: { argb: 'FF006600' } }
        row.eachCell(c => { c.alignment = { vertical: 'middle' } })
      }
    }

    totDebt = canon.totalDebt
    ws.addRow([])
    const tot = ws.addRow(['JAMI', totExp || '—', totPaid, totDebt, ''])
    tot.font = { bold: true }
    tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: totDebt > 0 ? 'FFFCE4EC' : 'FFE8F5E9' } }

    // Summa ustunlari: ming ajratgichi (#,##0)
    for (const col of ['B', 'C', 'D']) {
      ws.getColumn(col).numFmt = '#,##0'
      ws.getColumn(col).alignment = { horizontal: 'right' }
    }

    const safeName = entity.name.replace(/[^\p{L}0-9\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''faktura_${encodeURIComponent(safeName)}.xlsx`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
