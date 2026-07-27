// EkoHisob sana formati — hujjat va eksportlar uchun yagona manba.
//
// `toLocaleDateString('uz-UZ')` ATAYLAB ishlatilmaydi: Node ICU versiyasiga
// qarab u "27/07/2026" (qiya chiziq) beradi, serverda ICU cheklangan bo'lsa
// butunlay boshqa natija chiqishi mumkin. O'zbekistonda rasmiy yozuv —
// nuqta bilan kun.oy.yil. Kvitansiya, akt sverka va hisobotlarda sana bir xil
// ko'rinishi shart, shuning uchun format qo'lda quriladi.

const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]

const p2 = (n: number) => String(n).padStart(2, '0')

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null
  const v = d instanceof Date ? d : new Date(d)
  return Number.isNaN(v.getTime()) ? null : v
}

/** "27.07.2026" */
export function uzDate(d: Date | string | null | undefined, fallback = '—'): string {
  const v = toDate(d)
  if (!v) return fallback
  return `${p2(v.getDate())}.${p2(v.getMonth() + 1)}.${v.getFullYear()}`
}

/** "27.07.2026 14:30" */
export function uzDateTime(d: Date | string | null | undefined, fallback = '—'): string {
  const v = toDate(d)
  if (!v) return fallback
  return `${uzDate(v)} ${p2(v.getHours())}:${p2(v.getMinutes())}`
}

/** "YYYY-MM" → "Iyul 2026" */
export function uzMonth(m: string | null | undefined, fallback = '—'): string {
  if (!m) return fallback
  const [y, mo] = String(m).split('-')
  const idx = parseInt(mo, 10) - 1
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return String(m)
  return `${UZ_MONTHS[idx]} ${y}`
}

/** "YYYY-MM" → "Iyul 26" (grafik o'qlari uchun — joy tor) */
export function uzMonthShort(m: string | null | undefined): string {
  if (!m) return '—'
  const [y, mo] = String(m).split('-')
  const idx = parseInt(mo, 10) - 1
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return String(m)
  return `${UZ_MONTHS[idx].slice(0, 3)} ${y.slice(2)}`
}

/** Summa — "1 200 000" (bo'shliq bilan, vergul emas) */
export function uzNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '0'
  return Math.round(Number(n)).toLocaleString('en-US').replace(/,/g, ' ')
}
