// Ma'lumot to'liqligi nazorati — sof mantiq (DB'siz, testlanadi).
//
// Nega kerak: tizimda avtomatlashtirish bor (avto-SMS, oylik hisob yaratish,
// xarita, talon), lekin ular JIMGINA ishlamay qolishi mumkin:
//  - telefoni yo'q tashkilotga SMS hech qachon bormaydi;
//  - koordinatasi yo'q tashkilot xaritada ko'rinmaydi;
//  - monthly_fixed bo'lib oylik summasi 0 bo'lsa unga hech qachon hisob yozilmaydi;
//  - talon bo'lib kub narxi 0 bo'lsa talon qo'shib bo'lmaydi.
// Hech qanday xato chiqmaydi — shunchaki ish bajarilmaydi. Bu tekshiruv shuni
// ko'rsatadi: "avtomatlashtirish nima uchun ishlamayapti".

export type IssueCode =
  | 'no_phone'
  | 'no_coords'
  | 'fixed_no_fee'
  | 'talon_no_price'
  | 'no_mahalla'
  | 'draft'
  | 'no_stir'

export type Severity = 'high' | 'medium' | 'low'

export interface IssueMeta {
  code: IssueCode
  label: string
  /** Nima uchun muhim — foydalanuvchi oqibatini bilishi kerak */
  why: string
  severity: Severity
}

/**
 * `high`  — mavjud avtomatlashtirishni buzadi (pul yoki xabar yo'qoladi).
 * `medium` — ish jarayonini qiyinlashtiradi.
 * `low`   — hujjat to'liqligi uchun.
 */
export const ISSUE_META: Record<IssueCode, IssueMeta> = {
  fixed_no_fee: {
    code: 'fixed_no_fee',
    label: 'Oylik summasi belgilanmagan',
    why: "Belgilangan oylik rejimida, lekin summa 0 — bu tashkilotga hech qachon hisob yozilmaydi va u qarzdorlar ro'yxatiga tushmaydi.",
    severity: 'high',
  },
  talon_no_price: {
    code: 'talon_no_price',
    label: 'Kub narxi belgilanmagan',
    why: 'Talon rejimida, lekin bir kub narxi 0 — bu tashkilotga talon qo\'shib bo\'lmaydi.',
    severity: 'high',
  },
  no_phone: {
    code: 'no_phone',
    label: 'Telefon raqami yo\'q',
    why: 'Avtomatik va qo\'lda SMS eslatma bu tashkilotga hech qachon bormaydi.',
    severity: 'high',
  },
  no_coords: {
    code: 'no_coords',
    label: 'Xaritada joylashuvi yo\'q',
    why: 'Xaritada ko\'rinmaydi — inspektor marshrut tuzganda hisobga olinmaydi.',
    severity: 'medium',
  },
  draft: {
    code: 'draft',
    label: 'Chala kiritilgan',
    why: 'Holati "chala" — ma\'lumotlari to\'ldirilmagan, hisob-kitobga to\'liq qo\'shilmaydi.',
    severity: 'medium',
  },
  no_mahalla: {
    code: 'no_mahalla',
    label: 'Mahalla ko\'rsatilmagan',
    why: 'Kunlik ro\'yxatda "Mahallasiz" guruhiga tushadi — inspektor marshrut bo\'yicha ishlashi qiyinlashadi.',
    severity: 'low',
  },
  no_stir: {
    code: 'no_stir',
    label: 'STIR yo\'q',
    why: 'Akt sverka va fakturada STIR bo\'sh chiqadi; takroriy import bu tashkilotni tanimaydi.',
    severity: 'low',
  },
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** Muammolarni jiddiyligi bo'yicha tartiblaydi (avval eng jiddiysi). */
export function sortIssueCodes(codes: IssueCode[]): IssueCode[] {
  return [...codes].sort((a, b) =>
    SEVERITY_ORDER[ISSUE_META[a].severity] - SEVERITY_ORDER[ISSUE_META[b].severity])
}

export interface EntityForHealth {
  status?: string | null
  phone?: string | null
  lat?: number | null
  lon?: number | null
  billingMode?: string | null
  monthlyFee?: number | null
  cubicPrice?: number | null
  mahallId?: string | null
  stir?: string | null
}

/** Telefon O'zbekiston formatiga to'g'ri keladimi (SMS yuborish uchun yaroqlimi). */
export function hasUsablePhone(phone: string | null | undefined): boolean {
  if (!phone) return false
  const d = String(phone).replace(/\D/g, '')
  return d.length === 9 || (d.length === 12 && d.startsWith('998'))
}

/**
 * Bitta tashkilotning muammolarini aniqlaydi.
 * Nofaol va qora ro'yxatdagi tashkilotlar tekshirilmaydi — ular bilan
 * ishlanmaydi, ularni "tuzatish" ro'yxatiga qo'shish shovqin bo'lardi.
 */
export function classifyEntity(e: EntityForHealth): IssueCode[] {
  if (e.status === 'inactive' || e.status === 'blacklisted') return []

  const issues: IssueCode[] = []

  if (e.billingMode === 'monthly_fixed' && (Number(e.monthlyFee) || 0) <= 0) {
    issues.push('fixed_no_fee')
  }
  if (e.billingMode === 'talon' && (Number(e.cubicPrice) || 0) <= 0) {
    issues.push('talon_no_price')
  }
  if (!hasUsablePhone(e.phone)) issues.push('no_phone')
  if (e.lat == null || e.lon == null) issues.push('no_coords')
  if (e.status === 'draft') issues.push('draft')
  if (!e.mahallId) issues.push('no_mahalla')
  if (!e.stir || !String(e.stir).trim()) issues.push('no_stir')

  return sortIssueCodes(issues)
}

export interface HealthGroup {
  code: IssueCode
  label: string
  why: string
  severity: Severity
  count: number
}

/**
 * Tashkilotlar ro'yxatidan muammolar bo'yicha yig'ma statistika.
 * Har tashkilot bir necha guruhga tushishi mumkin.
 */
export function summarizeHealth(entities: EntityForHealth[]): {
  checked: number
  clean: number
  groups: HealthGroup[]
} {
  const counts: Partial<Record<IssueCode, number>> = {}
  let checked = 0
  let clean = 0

  for (const e of entities) {
    if (e.status === 'inactive' || e.status === 'blacklisted') continue
    checked++
    const issues = classifyEntity(e)
    if (issues.length === 0) { clean++; continue }
    for (const c of issues) counts[c] = (counts[c] ?? 0) + 1
  }

  const groups = (Object.keys(ISSUE_META) as IssueCode[])
    .map(code => ({ ...ISSUE_META[code], count: counts[code] ?? 0 }))
    .filter(g => g.count > 0)
    .sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count)

  return { checked, clean, groups }
}
