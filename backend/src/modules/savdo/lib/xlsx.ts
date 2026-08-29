// Savdo — Excel eksport uchun umumiy yordamchi. exports.ts'dagi send()/styleWorksheet()
// pattern bilan bir xil (sarlavha stili, Content-Disposition sarlavhasi), lekin
// transliteratsiya (uz-cyrl) qismisiz — soddalashtirilgan, Savdo hali ko'p tilli emas.
// Aksent rang amber (savdo brendi bilan mos, exports.ts'dagi yashil o'rniga).

import ExcelJS from 'exceljs'
import { Response } from 'express'

export function styleWorksheet(ws: ExcelJS.Worksheet) {
  const headerRow = ws.getRow(1)
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF92400E' } },
      bottom: { style: 'thin', color: { argb: 'FF92400E' } },
      left: { style: 'thin', color: { argb: 'FF92400E' } },
      right: { style: 'thin', color: { argb: 'FF92400E' } },
    }
  })
  headerRow.height = 28

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFD6D3D1' } },
        bottom: { style: 'hair', color: { argb: 'FFD6D3D1' } },
        left: { style: 'hair', color: { argb: 'FFD6D3D1' } },
        right: { style: 'hair', color: { argb: 'FFD6D3D1' } },
      }
    })
    if (rowNum % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAF9' } }
      })
    }
  })
}

export function sendWorkbook(wb: ExcelJS.Workbook, filename: string, res: Response) {
  const encoded = encodeURIComponent(filename)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`)
  return wb.xlsx.write(res).then(() => res.end())
}

export function newWorkbook(sheetName: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AvtoHisob Savdo'
  const ws = wb.addWorksheet(sheetName)
  return { wb, ws }
}
