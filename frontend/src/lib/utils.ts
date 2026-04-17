import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'UZS') {
  return new Intl.NumberFormat('uz-UZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date))
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat('uz-UZ').format(n)
}

export const FUEL_TYPES: Record<string, string> = { petrol: 'Benzin', diesel: 'Dizel', gas: 'Gaz', electric: 'Elektr', hybrid: 'Gibrid' }
export const VEHICLE_STATUS: Record<string, string> = { active: 'Faol', maintenance: 'Ta\'mirda', inactive: 'Nofaol' }
export const USER_ROLES: Record<string, string> = { admin: 'Admin', manager: 'Menejer', branch_manager: 'Filial boshqaruvchisi', operator: 'Operator' }
export const TRANSFER_STATUS: Record<string, string> = { pending: 'Kutilmoqda', approved: 'Tasdiqlangan', shipped: 'Jo\'natilgan', received: 'Qabul qilindi' }
export const PART_CATEGORIES = ['engine', 'brake', 'suspension', 'electrical', 'body', 'other']
export const CATEGORY_LABELS: Record<string, string> = { engine: 'Dvigatel', brake: 'Tormoz', suspension: 'Suspenziya', electrical: 'Elektr', body: 'Korpus', other: 'Boshqa' }
