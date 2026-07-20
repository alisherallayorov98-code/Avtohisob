// Vedomost import'ning pure (DB'siz) mantiqi — controller'dan ajratilgan,
// chunki bu pul harakati bilan bog'liq eng kritik hisoblar va ular DB'siz
// unit-test qilinishi kerak. Xatti-harakat controller'dagi asl nusxa bilan AYNAN bir xil.

/** "DD.MM.YYYY", "DD.MM.YY", "DD.MM" (yil/oy kontekstidan), ISO — hammasini Date'ga */
export function normalizeDate(raw: string | undefined | null, year?: number, month?: number): Date | null {
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

/** Davlat raqamini solishtirish uchun kanonik ko'rinish: probel/nuqtasiz, katta harf */
export function normalizePlate(raw: string | undefined | null): string {
  if (!raw) return ''
  // Remove spaces, dots, keep alphanumeric
  return raw.replace(/[\s.]/g, '').toUpperCase()
}

/**
 * Kirim qilishda qator narxi: vedomostda summa bo'lsa — o'sha; bo'lmasa
 * miqdor × tarixiy narx (yaxlitlangan); tarixiy narx ham bo'lmasa — 0 qoladi.
 * confirmImport'dagi formula bilan aynan bir xil.
 */
export function computeRowCost(totalAmount: number, quantity: number, histPrice: number | null | undefined): number {
  return totalAmount > 0
    ? totalAmount
    : (histPrice ? Math.round(quantity * histPrice) : totalAmount)
}
