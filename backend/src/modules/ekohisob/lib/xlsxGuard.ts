// Yuklangan .xlsx faylni ExcelJS ochishdan OLDIN tekshirish — PURE (Buffer bilan ishlaydi).
//
// ExcelJS butun faylni xotiraga yuklaydi: "zip bomba" (kichik fayl, ulkan ochilgan hajm) yoki
// millionlab qatorli varaq serverni o'ldirishi mumkin. Shuning uchun ZIP markaziy katalogini
// o'zimiz o'qib, ochilgan hajm / yozuvlar soni / varaq o'lchamini (<dimension ref>) tekshiramiz.

import zlib from 'zlib'

export interface XlsxLimits {
  maxEntries: number
  maxTotalUncompressed: number
  maxSheetUncompressed: number
  maxRows: number
  maxCols: number
  maxRatio: number
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = {
  maxEntries: 200,
  maxTotalUncompressed: 25 * 1024 * 1024,
  maxSheetUncompressed: 20 * 1024 * 1024,
  maxRows: 50_000,
  maxCols: 100,
  maxRatio: 200,
}

export type XlsxCheck =
  | { ok: true; info: { entries: number; totalUncompressed: number; dimensionRows: number | null; dimensionCols: number | null } }
  | { ok: false; error: string }

/** ZIP (xlsx) sehrli baytlari: PK\x03\x04 */
export function hasZipMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

export function colToNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

const BAD = (error: string): XlsxCheck => ({ ok: false, error })

export function checkXlsxUpload(
  file: { originalname?: string; buffer?: Buffer },
  limits: XlsxLimits = DEFAULT_XLSX_LIMITS,
): XlsxCheck {
  const name = String(file.originalname ?? '')
  if (!/\.xlsx$/i.test(name)) return BAD("Faqat .xlsx formatidagi Excel fayl qabul qilinadi (eski .xls emas)")
  const buf = file.buffer
  if (!buf || buf.length === 0) return BAD("Fayl bo'sh")
  if (!hasZipMagic(buf)) return BAD("Fayl haqiqiy .xlsx emas (ichki tuzilma noto'g'ri)")

  try {
    // End Of Central Directory yozuvini oxiridan qidiramiz
    const minPos = Math.max(0, buf.length - 65557)
    let eocd = -1
    for (let i = buf.length - 22; i >= minPos; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) return BAD("Fayl buzilgan (ZIP katalogi topilmadi)")

    const entries = buf.readUInt16LE(eocd + 10)
    const cdSize = buf.readUInt32LE(eocd + 12)
    const cdOffset = buf.readUInt32LE(eocd + 16)
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      return BAD("Juda katta ZIP (Zip64) qabul qilinmaydi")
    }
    if (entries > limits.maxEntries) return BAD("Faylda ichki yozuvlar juda ko'p")
    if (cdOffset + cdSize > buf.length) return BAD("Fayl buzilgan (katalog chegarasi)")

    let p = cdOffset
    let total = 0
    const names: string[] = []
    let firstSheet: { name: string; method: number; comp: number; localOff: number } | null = null
    for (let i = 0; i < entries; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return BAD("Fayl buzilgan (katalog yozuvi)")
      const method = buf.readUInt16LE(p + 10)
      const comp = buf.readUInt32LE(p + 20)
      const uncomp = buf.readUInt32LE(p + 24)
      const nameLen = buf.readUInt16LE(p + 28)
      const extraLen = buf.readUInt16LE(p + 30)
      const commentLen = buf.readUInt16LE(p + 32)
      const localOff = buf.readUInt32LE(p + 42)
      const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen)
      names.push(entryName)

      total += uncomp
      if (total > limits.maxTotalUncompressed) return BAD("Fayl ochilganda juda katta bo'lib ketadi — kichikroq fayl yuklang")
      const isSheet = /^xl\/worksheets\/sheet\d+\.xml$/.test(entryName)
      if (isSheet && uncomp > limits.maxSheetUncompressed) return BAD("Varaq juda katta — faylni bo'lib yuklang")
      if (uncomp > 1024 * 1024 && comp > 0 && uncomp / comp > limits.maxRatio) {
        return BAD("Fayl shubhali siqilgan (zip bomba) — qabul qilinmaydi")
      }
      if (isSheet && (!firstSheet || entryName < firstSheet.name)) firstSheet = { name: entryName, method, comp, localOff }
      p += 46 + nameLen + extraLen + commentLen
    }

    if (!names.includes('[Content_Types].xml') || !names.includes('xl/workbook.xml')) {
      return BAD("Fayl Excel (.xlsx) hujjati emas")
    }

    // Birinchi varaqning <dimension ref="A1:Z99999"> si — boshidagi bir necha KB dan o'qiladi
    let rows: number | null = null
    let cols: number | null = null
    if (firstSheet) {
      const head = peekEntry(buf, firstSheet)
      const m = head && /<dimension\s+ref="([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?"/.exec(head)
      if (m) {
        const endCol = m[3] ?? m[1]
        const endRow = m[4] ?? m[2]
        rows = Number(endRow)
        cols = colToNumber(endCol)
        if (rows > limits.maxRows) return BAD(`Varaqda ${rows} qator bor — maksimal ${limits.maxRows}. Faylni bo'lib yuklang`)
        if (cols > limits.maxCols) return BAD(`Varaqda ${cols} ustun bor — maksimal ${limits.maxCols}`)
      }
    }

    return { ok: true, info: { entries, totalUncompressed: total, dimensionRows: rows, dimensionCols: cols } }
  } catch {
    return BAD("Fayl buzilgan yoki o'qib bo'lmadi")
  }
}

/** Yozuvning boshidagi ~4 KB ni ochadi (to'liq ochmasdan). */
function peekEntry(buf: Buffer, e: { method: number; comp: number; localOff: number }): string | null {
  try {
    if (buf.readUInt32LE(e.localOff) !== 0x04034b50) return null
    const n = buf.readUInt16LE(e.localOff + 26)
    const x = buf.readUInt16LE(e.localOff + 28)
    const start = e.localOff + 30 + n + x
    if (e.method === 0) return buf.toString('utf8', start, Math.min(start + 4096, buf.length))
    if (e.method === 8) {
      const slice = buf.subarray(start, Math.min(start + (e.comp || 4096), start + 4096, buf.length))
      const out = zlib.inflateRawSync(slice, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
      return out.toString('utf8')
    }
    return null
  } catch {
    return null
  }
}
