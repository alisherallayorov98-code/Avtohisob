// Savdo — sana oralig'i filtri (O'zbekiston vaqti, UTC+5).
// Umumiy buildDateRangeFilter('2026-11-12') sanani UTC yarim tuniga qo'yadi va `lte`
// o'sha kunning o'zini tushirib qoldiradi (hisobotlarda oxirgi kun yo'qolardi).
// Bu yerda faqat-sana ('YYYY-MM-DD') berilsa: from — kun boshi, to — kun OXIRI (UTC+5).
// Vaqt bilan berilgan qiymat (ISO) o'zgarishsiz o'qiladi.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function parse(v: string | undefined, endOfDay: boolean): Date | undefined {
  if (!v) return undefined
  const d = DATE_ONLY.test(v)
    ? new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:00`)
    : new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

export function savdoDateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const gte = parse(from, false)
  const lte = parse(to, true)
  if (!gte && !lte) return undefined
  return { ...(gte && { gte }), ...(lte && { lte }) }
}
