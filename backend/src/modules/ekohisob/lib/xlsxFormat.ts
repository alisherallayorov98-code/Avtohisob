// EkoHisob — Excel eksport yordamchilari (sof, testlanadi).

/** Son formati: ming ajratgich vergul (`# ##0` Excel'da noto'g'ri ishlardi). */
export const NUM_FMT = '#,##0'
export const PCT_FMT = '0%'

/** 1 → A, 26 → Z, 27 → AA */
export function colLetter(n: number): string {
  let s = ''
  let x = Math.floor(n)
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

/** `SUM(B3:B8)` — ustun (1-asosli) va qator oralig'i (ikkalasi ham kiritilgan). */
export function sumFormula(col: number, fromRow: number, toRow: number): string {
  const c = colLetter(col)
  return `SUM(${c}${fromRow}:${c}${toRow})`
}

/** Jami qator uchun formulali katak: ma'lumot yo'q bo'lsa formula emas, oddiy 0. */
export function totalCell(
  col: number, fromRow: number, toRow: number, result: number,
): { formula: string; result: number } | number {
  if (toRow < fromRow) return 0
  return { formula: sumFormula(col, fromRow, toRow), result }
}

/** Foiz formulasi: `IF(den>0, num/den, "—")` — nolga bo'lish himoyasi bilan. */
export function ratioFormula(numCell: string, denCell: string): string {
  return `IF(${denCell}>0,${numCell}/${denCell},"—")`
}
