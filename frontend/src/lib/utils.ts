import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'UZS') {
  return new Intl.NumberFormat('uz-UZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

// Sana formati: kun.oy.yil (10.11.2026) — Intl ishlatilmaydi, brauzerga bog'liq emas.
// Kun chegarasi UTC+5 (O'zbekiston). Date-only ISO ("2026-11-10") kalendar sanasi sifatida olinadi (siljimaydi).
const UZ_OFFSET_MS = 5 * 3600 * 1000
const pad2 = (n: number) => String(n).padStart(2, '0')

function uzParts(date: string | Date | number | null | undefined) {
  if (date == null || date === '') return null
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
    if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0 }
  }
  const t = new Date(date).getTime()
  if (isNaN(t)) return null
  const u = new Date(t + UZ_OFFSET_MS)
  return { y: u.getUTCFullYear(), mo: u.getUTCMonth() + 1, d: u.getUTCDate(), h: u.getUTCHours(), mi: u.getUTCMinutes() }
}

export function formatDate(date: string | Date | number | null | undefined) {
  const p = uzParts(date)
  return p ? `${pad2(p.d)}.${pad2(p.mo)}.${p.y}` : '—'
}

export function formatTime(date: string | Date | number | null | undefined) {
  const p = uzParts(date)
  return p ? `${pad2(p.h)}:${pad2(p.mi)}` : '—'
}

export function formatDateTime(date: string | Date | number | null | undefined) {
  const p = uzParts(date)
  return p ? `${pad2(p.d)}.${pad2(p.mo)}.${p.y} ${pad2(p.h)}:${pad2(p.mi)}` : '—'
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat('uz-UZ').format(n)
}

// O'zbek tilida raqamni so'z bilan yozish (rasmiy hujjatlar uchun)
// Misol: 1167398 → "Bir million bir yuz oltmish yetti ming uch yuz to'qson sakkiz"
const UZ_ONES = ['', 'bir', 'ikki', 'uch', 'tort', 'besh', 'olti', 'yetti', 'sakkiz', 'toqqiz']
const UZ_TENS = ['', 'on', 'yigirma', 'ottiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'toqson']
const UZ_HUNDREDS = ['', 'bir yuz', 'ikki yuz', 'uch yuz', 'tort yuz', 'besh yuz', 'olti yuz', 'yetti yuz', 'sakkiz yuz', 'toqqiz yuz']

function uzWords1to999(n: number): string {
  if (n === 0) return ''
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10
  return [UZ_HUNDREDS[h], UZ_TENS[t], UZ_ONES[o]].filter(Boolean).join(' ')
}

export function uzNumberToWords(n: number): string {
  if (n === 0) return 'nol'
  if (n < 0) return 'minus ' + uzNumberToWords(-n)
  n = Math.floor(n)

  const billion = Math.floor(n / 1_000_000_000)
  const million = Math.floor((n % 1_000_000_000) / 1_000_000)
  const thousand = Math.floor((n % 1_000_000) / 1_000)
  const rest = n % 1_000

  const parts: string[] = []
  if (billion > 0) parts.push(uzWords1to999(billion) + ' milliard')
  if (million > 0) parts.push(uzWords1to999(million) + ' million')
  if (thousand > 0) parts.push(uzWords1to999(thousand) + ' ming')
  if (rest > 0) parts.push(uzWords1to999(rest))

  const str = parts.join(' ')
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// Rasmiy uzun sana formati: "29-aprel 2026-yil"
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
export function formatDateLong(date: string | Date) {
  const d = new Date(date)
  return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}-yil`
}

export const FUEL_TYPES: Record<string, string> = { petrol: 'Benzin', diesel: 'Dizel', gas: 'Metan gaz', electric: 'Elektr', hybrid: 'Gibrid' }
export const fuelUnit = (type?: string | null): string => type === 'gas' ? 'm³' : type === 'electric' ? 'kWh' : 'L'
export const VEHICLE_STATUS: Record<string, string> = { active: 'Faol', maintenance: 'Ta\'mirda', inactive: 'Nofaol' }
export const USER_ROLES: Record<string, string> = { admin: 'Admin', manager: 'Menejer', branch_manager: 'Filial boshqaruvchisi', operator: 'Operator', ekohisob_user: 'EkoHisob foydalanuvchisi' }
export const TRANSFER_STATUS: Record<string, string> = { pending: 'Kutilmoqda', approved: 'Tasdiqlangan', shipped: 'Jo\'natilgan', received: 'Qabul qilindi' }
export const PART_CATEGORIES = ['engine', 'brake', 'suspension', 'electrical', 'body', 'other']
export const CATEGORY_LABELS: Record<string, string> = { engine: 'Dvigatel', brake: 'Tormoz', suspension: 'Suspenziya', electrical: 'Elektr', body: 'Korpus', other: 'Boshqa' }
