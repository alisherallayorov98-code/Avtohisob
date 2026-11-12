// Hujjat raqamlash — EkoHisobReceiptSeq (nextReceiptNum) bilan bir xil
// atomik-increment patterni: COUNT(*)dan emas (poyga xavfi), UUID'dan emas
// (fakturada foydalanib bo'lmaydi).

import { prisma } from '../../../lib/prisma'

export async function nextSaleDocNum(orgId: string): Promise<string> {
  return nextSeq(orgId, 'S')
}

/** Spetsifikatsiya raqami: SP-YYYY-NNNNN (alohida hisoblagich, sotuv raqamiga ta'sir qilmaydi). */
export async function nextSpecDocNum(orgId: string): Promise<string> {
  return nextSeq(`${orgId}#SP`, 'SP')
}

/** Import kirim hujjati raqami: IK-YYYY-NNNNN. */
export async function nextImportDocNum(orgId: string): Promise<string> {
  return nextSeq(`${orgId}#IK`, 'IK')
}

async function nextSeq(key: string, prefix: string): Promise<string> {
  const orgId = key
  const year = new Date().getFullYear()
  const rows: any[] = await prisma.$queryRawUnsafe(`
    INSERT INTO savdo_doc_seq ("orgId", year, "lastNum")
    VALUES ($1, $2, 1)
    ON CONFLICT ("orgId") DO UPDATE
    SET "lastNum" = CASE
      WHEN savdo_doc_seq.year = $2 THEN savdo_doc_seq."lastNum" + 1
      ELSE 1
    END,
    year = $2
    RETURNING "lastNum"
  `, orgId, year)
  const num = Number(rows[0]?.lastNum ?? rows[0]?.lastnum ?? 1)
  return `${prefix}-${year}-${String(num).padStart(5, '0')}`
}
