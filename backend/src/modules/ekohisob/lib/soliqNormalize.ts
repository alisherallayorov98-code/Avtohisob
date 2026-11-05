// Soliq API (remote-access-api/company/info) javobini EkoHisob tashkilotiga moslash — pure.
//
// Javob shakli (type=full): { company, director, accountant, companyBillingAddress }.
// Faqat EkoHisobga kerak maydonlar olinadi: JShShIR, hisobchi, ustav kapitali kabi
// shaxsiy/ortiqcha ma'lumotlar ATAYLAB olinmaydi va bazaga yozilmaydi.

export const STIR_RE = /^\d{9}$/

/** Faqat raqamlar. */
export function cleanStir(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

export function isValidStir(v: unknown): boolean {
  return STIR_RE.test(cleanStir(v))
}

/**
 * URL shablonidan so'rov manzilini quradi. `.env` da `%s` ham, URL-kodlangan `%25s` ham,
 * `{stir}` ham uchraydi; hech biri bo'lmasa STIR oxiriga qo'shiladi.
 * Faqat 9 xonali raqam qo'yiladi (boshqa belgi URLga kira olmaydi).
 */
export function buildSoliqUrl(template: string, stir: string): string {
  const s = cleanStir(stir)
  if (!STIR_RE.test(s)) throw new Error('INVALID_STIR')
  const t = template.trim()
  let url: string
  if (/%25s|%s|\{stir\}/i.test(t)) url = t.replace(/%25s|%s|\{stir\}/i, s)
  else url = t.replace(/\/+$/, '') + '/' + s
  return url + (url.includes('?') ? '&' : '?') + 'type=full'
}

const str = (v: unknown): string => (v != null && v !== '' ? String(v).trim() : '')

export type SoliqStatus = 'active' | 'inactive' | 'unknown' | ''

export interface SoliqCompany {
  stir: string
  /** Qisqa nom (tizimda ko'rsatiladi) */
  name: string
  /** To'liq rasmiy nom */
  fullName: string
  address: string
  phone: string
  /** Rahbar F.I.Sh. (mas'ul shaxs uchun) */
  directorName: string
  status: SoliqStatus
  statusText: string
}

/** Xom javobdan kerakli maydonlar. Kutilmagan shakl — bo'sh maydonlar (xato tashlamaydi). */
export function normalizeSoliqCompany(raw: unknown): SoliqCompany {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const co = (r.company ?? {}) as Record<string, any>
  const dir = (r.director ?? {}) as Record<string, any>
  const addr = (r.companyBillingAddress ?? {}) as Record<string, any>

  const region = addr.region as Record<string, any> | null | undefined
  const district = addr.district as Record<string, any> | null | undefined
  const address = [
    str(region?.name_uz_latn || region?.name),
    str(district?.name_uz_latn || district?.name),
    str(addr.streetName || co.streetName),
  ].filter(Boolean).join(', ')

  const sd = co.statusDetail as Record<string, any> | null | undefined
  const group = str(sd?.group).toUpperCase()
  const status: SoliqStatus =
    group === 'ACTIVE' ? 'active'
    : group === 'INACTIVE' || group === 'LIQUIDATED' ? 'inactive'
    : group ? 'unknown' : ''

  return {
    stir: cleanStir(co.tin),
    name: str(co.shortName) || str(co.name),
    fullName: str(co.name),
    address,
    phone: str(co.phone),
    directorName: [str(dir.lastName), str(dir.firstName), str(dir.middleName)].filter(Boolean).join(' '),
    status,
    statusText: str(sd?.name_uz_latn) || str(sd?.name_ru),
  }
}

/** Javobda korxona haqiqatan bormi (bo'sh obyekt = topilmadi). */
export function hasCompany(c: SoliqCompany): boolean {
  return Boolean(c.stir || c.name || c.fullName)
}
