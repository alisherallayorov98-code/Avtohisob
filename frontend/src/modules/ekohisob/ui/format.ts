/**
 * EkoHisob formatlash yordamchilari.
 *
 * Nega bitta joyda: summa ilgari har sahifada turlicha formatlanardi
 * (`toLocaleString('uz-UZ')`, bo'shliqli, vergulli) va "so'm" so'zi ba'zan
 * qo'shilib, ba'zan qo'shilmasdi.
 */

const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]

/** 1200000 → "1 200 000" */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Math.round(Number(n)).toLocaleString('en-US').replace(/,/g, ' ')
}

/** 1200000 → "1 200 000 so'm" */
export function money(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${num(n)} so'm`
}

/**
 * Katta summani qisqartiradi: 8 400 000 → "8.4 mln".
 * KPI plitkalarida ishlatiladi — u yerda aniqlikdan ko'ra bir qarashda
 * tushunish muhimroq. Jadval va kvitansiyada HECH QACHON ishlatilmasin.
 */
export function moneyShort(n: number | null | undefined): string {
  if (n == null) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1_000_000_000) return `${(Number(n) / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} mlrd`
  if (v >= 1_000_000) return `${(Number(n) / 1_000_000).toFixed(1).replace(/\.0$/, '')} mln`
  if (v >= 100_000) return `${Math.round(Number(n) / 1000)} ming`
  return num(n)
}

/** "2026-07" → "Iyul 2026" */
export function monthLabel(m: string | null | undefined): string {
  if (!m) return '—'
  const [y, mo] = String(m).split('-')
  return `${UZ_MONTHS[parseInt(mo, 10) - 1] ?? mo} ${y}`
}

/** "2026-07" → "Iyul" (qisqa — joy tor bo'lganda) */
export function monthShort(m: string | null | undefined): string {
  if (!m) return '—'
  const mo = parseInt(String(m).split('-')[1], 10)
  return (UZ_MONTHS[mo - 1] ?? String(m)).slice(0, 3)
}

const p2 = (n: number) => String(n).padStart(2, '0')

/**
 * Sana — "27.07.2026" (kun.oy.yil).
 *
 * `toLocaleDateString('uz-UZ')` ATAYLAB ishlatilmaydi: u brauzer ICU
 * versiyasiga qarab "27/07/2026" (qiya chiziq) beradi, ba'zi muhitlarda esa
 * umuman boshqa tartib. O'zbekistonda rasmiy yozuv — nuqta bilan kun.oy.yil,
 * shuning uchun format qo'lda quriladi va hamma joyda bir xil bo'ladi.
 */
export function date(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const v = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(v.getTime())) return '—'
  return `${p2(v.getDate())}.${p2(v.getMonth() + 1)}.${v.getFullYear()}`
}

/** Sana + vaqt — "27.07.2026 14:30" */
export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const v = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(v.getTime())) return '—'
  return `${date(v)} ${p2(v.getHours())}:${p2(v.getMinutes())}`
}

/** Faqat vaqt — "14:30" */
export function time(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const v = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(v.getTime())) return '—'
  return `${p2(v.getHours())}:${p2(v.getMinutes())}`
}

/**
 * "3 kun oldin" ko'rinishi — audit jurnali va oxirgi to'lov uchun.
 * Bir haftadan uzoq bo'lsa aniq sanaga o'tadi (noaniqlik foydasiz bo'ladi).
 */
export function relative(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const v = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(v.getTime())) return '—'
  const diffMs = Date.now() - v.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'hozir'
  if (mins < 60) return `${mins} daqiqa oldin`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} soat oldin`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'kecha'
  if (days < 7) return `${days} kun oldin`
  return date(v)
}

/** Telefon — "+998 90 123 45 67" */
export function phone(p: string | null | undefined): string {
  if (!p) return '—'
  const d = String(p).replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('998')) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`
  }
  return p
}
