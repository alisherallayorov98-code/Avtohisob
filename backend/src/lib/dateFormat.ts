// Foydalanuvchiga ko'rinadigan sana formati — yagona manba (UTC+5, Toshkent).
// kun.oy.yil (10.11.2026), vaqt bilan 10.11.2026 14:30. Server TZ yoki ICU'ga
// bog'liq emas: UTC+5 qo'lda qo'shiladi. Faqat matn/hujjat uchun; API maydonlari ISO qoladi.

const UZ_OFFSET_MS = 5 * 3600 * 1000
const p2 = (n: number) => String(n).padStart(2, '0')

function parts(d: Date | string | number | null | undefined) {
  if (d === null || d === undefined || d === '') return null
  const v = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(v.getTime())) return null
  const u = new Date(v.getTime() + UZ_OFFSET_MS)
  return {
    dd: p2(u.getUTCDate()), mm: p2(u.getUTCMonth() + 1), yyyy: String(u.getUTCFullYear()),
    hh: p2(u.getUTCHours()), mi: p2(u.getUTCMinutes()),
  }
}

/** "10.11.2026" (UTC+5) */
export function formatUzDate(d: Date | string | number | null | undefined): string {
  const p = parts(d)
  return p ? `${p.dd}.${p.mm}.${p.yyyy}` : '—'
}

/** "10.11.2026 14:30" (UTC+5) */
export function formatUzDateTime(d: Date | string | number | null | undefined): string {
  const p = parts(d)
  return p ? `${p.dd}.${p.mm}.${p.yyyy} ${p.hh}:${p.mi}` : '—'
}
