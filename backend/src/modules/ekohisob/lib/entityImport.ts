// EkoHisob — tashkilotlarni Excel'dan import qilish mantiqi (DB'siz, testlanadi).
//
// Nega: yangi shahar/tuman ulash mingta tashkilotni qo'lda kiritishni talab qilardi —
// bu mijoz ulash tezligidagi asosiy to'siq. Bu yerda faqat SOF qism: ustunlarni
// tanish, qatorni tekshirish/normallashtirish, takrorlarni topish. DB bilan ishlash
// controllers/entityImport.ts da.

import { cyrToLatin } from './translit'
import { MAX_FEE } from './ekoValidate'

export type BillingMode = 'monthly_fixed' | 'variable' | 'talon'

/** Maydon uzunligi chegaralari (xato qatorga aylanadi, bazani to'ldirmaydi). */
export const FIELD_LIMITS = {
  name: 200, address: 300, contactName: 120, code: 50, contractNumber: 60, place: 100,
} as const

/** Import ustunlarining ichki kalitlari */
export type ColumnKey =
  | 'name' | 'stir' | 'code' | 'address' | 'phone' | 'contactName'
  | 'district' | 'mahalla' | 'billingMode' | 'monthlyFee' | 'cubicPrice'
  | 'contractNumber' | 'contractStartMonth' | 'lat' | 'lon'

/**
 * Sarlavha sinonimlari — o'zbek (lotin/kirill), rus va qisqartmalar.
 * Mijozlar fayllari har xil kelgani uchun keng ro'yxat.
 */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  name: ['nomi', 'nom', 'tashkilot', 'tashkilot nomi', 'korxona', 'korxona nomi',
    'muassasa', 'номи', 'ном', 'ташкилот', 'наименование', 'название', 'организация'],
  stir: ['stir', 'inn', 'иин', 'инн', 'stir raqami', 'стир', 'солик раками'],
  code: ['kod', 'kodi', 'code', 'shartnoma kodi', 'код'],
  address: ['manzil', 'manzili', 'address', 'адрес', 'манзил', 'joylashuv'],
  phone: ['telefon', 'tel', 'telefon raqami', 'phone', 'телефон', 'тел', 'raqam'],
  contactName: ['masul', "mas'ul", 'masul shaxs', 'rahbar', 'direktor', 'aloqa',
    'контакт', 'руководитель', 'директор', 'масъул'],
  district: ['tuman', 'tumani', 'district', 'туман', 'район'],
  mahalla: ['mahalla', 'mahallasi', 'mfy', 'махалла', 'махалля', 'мфй'],
  billingMode: ['rejim', "to'lov rejimi", 'tolov rejimi', 'turi', 'tur', 'режим', 'тип'],
  monthlyFee: ['oylik', "oylik to'lov", 'oylik tolov', 'summa', 'oylik summa',
    'ойлик', 'сумма', 'ежемесячно'],
  cubicPrice: ['kub narxi', 'kub', 'bir kub narxi', 'kub metr narxi',
    'куб', 'куб нархи', 'цена за куб'],
  contractNumber: ['shartnoma', 'shartnoma raqami', 'shartnoma №', 'договор', 'шартнома'],
  contractStartMonth: ['shartnoma sanasi', 'boshlangan oy', 'shartnoma oyi',
    'boshlanish', 'дата договора', 'шартнома санаси'],
  lat: ['lat', 'latitude', 'kenglik', 'широта'],
  lon: ['lon', 'lng', 'longitude', 'uzunlik', 'долгота'],
}

/** Sarlavhani solishtirish uchun soddalashtiradi: kichik harf, ortiqcha belgilarsiz. */
function normalizeHeader(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ʻʼ'`’]/g, '')          // o'zbek apostroflari
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // tinish belgilari
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Nom bo'yicha moslashtirish uchun kalit (tuman/mahalla). Imlo farqlarini yutadi:
 * "Chilonzor tumani", "chilonzor", "CHILONZOR  TUMANI" → "chilonzor".
 * Bu tufayli import bir xil tumanni ikki marta yaratib qo'ymaydi.
 */
export function normalizePlaceName(s: string): string {
  // Kirill → lotin birinchi: "Чилонзор тумани" va "Chilonzor tumani" bir xil kalit beradi.
  // x/h tenglashtiriladi ("махалла" → "maxalla" ~ "mahalla").
  return normalizeHeader(cyrToLatin(String(s ?? '')))
    .replace(/x/g, 'h')
    .replace(/\b(tumani|tuman|rayoni|rayon|shahri|shahar|shaharchasi)\b/g, '')
    .replace(/\b(mahallasi|mahalla|mfy|mahalla fuqarolar yigini)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Sarlavha qatoridan ustun → indeks moslashuvini aniqlaydi.
 * Aniq moslik topilmasa, sarlavha ichida sinonim bor-yo'qligiga qaraydi
 * ("Tashkilot nomi (to'liq)" → name).
 */
export function detectColumns(headerRow: unknown[]): Partial<Record<ColumnKey, number>> {
  const headers = headerRow.map(h => normalizeHeader(String(h ?? '')))
  const map: Partial<Record<ColumnKey, number>> = {}

  // 1-bosqich: aniq moslik (ustunlik shunda — "kub narxi" "narx"dan ustun turadi)
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, string[]][]) {
    const idx = headers.findIndex(h => h.length > 0 && aliases.includes(h))
    if (idx >= 0) map[key] = idx
  }
  // 2-bosqich: qisman moslik (band bo'lmagan ustunlar orasidan)
  const used = new Set(Object.values(map))
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, string[]][]) {
    if (map[key] !== undefined) continue
    const idx = headers.findIndex((h, i) =>
      !used.has(i) && h.length > 2 && aliases.some(a => a.length > 2 && h.includes(a)))
    if (idx >= 0) { map[key] = idx; used.add(idx) }
  }
  return map
}

/**
 * "1 200 000", "1,200,000", "1.200.000", "1200000.00", "1.200,50" → butun so'm.
 * Ming ajratgich: bir necha marta uchrasa yoki aniq 3 raqam bilan tugasa ("1.200" → 1200).
 * Tanib bo'lmasa null.
 */
export function parseAmount(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  let t = String(v).replace(/[\s\u00a0\u202f'\u02bc\u2019]/g, '').replace(/[^\d.,-]/g, '')
  if (!t || t === '-' || !/\d/.test(t)) return null
  const neg = t.startsWith('-')
  t = t.replace(/-/g, '')
  const dots = (t.match(/\./g) ?? []).length
  const commas = (t.match(/,/g) ?? []).length
  if (dots && commas) {
    // oxirgi uchragani — o'nlik ajratgich, boshqasi — ming
    const decSep = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ','
    const thouSep = decSep === '.' ? ',' : '.'
    t = t.split(thouSep).join('').replace(decSep, '.')
  } else if (dots > 1 || commas > 1) {
    t = t.replace(/[.,]/g, '')                       // 1.200.000 / 1,200,000
  } else if (dots === 1 || commas === 1) {
    const sep = dots ? '.' : ','
    const [intPart, frac] = t.split(sep)
    if (frac.length === 3 && intPart.length >= 1 && intPart.length <= 3 && intPart !== '0') t = intPart + frac // 1.200 → 1200
    else t = intPart + '.' + frac
  }
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return Math.round(neg ? -n : n)
}

/**
 * Telefon → 998XXXXXXXXX. Turli ko'rinishlarni qabul qiladi:
 * "+998 90 123-45-67", "90 1234567", "901234567".
 * Tanib bo'lmasa null (telefon majburiy emas — SMS yuborilmaydi, xolos).
 */
export function parsePhone(v: unknown): string | null {
  if (v == null || v === '') return null
  const digits = String(v).replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('998')) return digits
  if (digits.length === 9) return '998' + digits
  // 0 bilan boshlanuvchi ichki format: 0901234567
  if (digits.length === 10 && digits.startsWith('0')) return '998' + digits.slice(1)
  return null
}

/** "talon"/"kub" → talon; "oylik"/"belgilangan" → monthly_fixed; qolgani → variable */
export function parseBillingMode(v: unknown): BillingMode {
  const s = normalizeHeader(String(v ?? ''))
  if (!s) return 'variable'
  if (/talon|kub|куб|талон|hajm/.test(s)) return 'talon'
  if (/oylik|belgilangan|fixed|ойлик|фикс|abonent/.test(s)) return 'monthly_fixed'
  return 'variable'
}

/**
 * Shartnoma boshlangan oy → "YYYY-MM".
 * Excel sanasi (Date), "2026-03", "03.2026", "01.03.2026" ko'rinishlarini qabul qiladi.
 */
export function parseContractMonth(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/)              // 2026-03
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/)                  // 03.2026
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)    // 01.03.2026
  if (m) return `${m[3]}-${String(Number(m[2])).padStart(2, '0')}`
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)    // 2026-03-01
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`
  return null
}

/** Bitta import qatorining tozalangan ko'rinishi */
export interface ParsedEntityRow {
  rowNumber: number
  name: string
  stir: string | null
  code: string | null
  address: string | null
  phone: string | null
  contactName: string | null
  districtName: string | null
  mahallaName: string | null
  billingMode: BillingMode
  /** "Rejim" katagi to'ldirilganmi (bo'sh bo'lsa 'update' rejimida mavjud rejim saqlanadi) */
  billingModeGiven: boolean
  monthlyFee: number
  cubicPrice: number
  contractNumber: string | null
  contractStartMonth: string | null
  lat: number | null
  lon: number | null
}

export interface RowError {
  rowNumber: number
  /** foydalanuvchiga ko'rsatiladigan sabab (o'zbekcha) */
  message: string
  /** qaysi ustun sabab bo'ldi (UI'da ajratib ko'rsatish uchun) */
  column?: ColumnKey
}

export interface ParseRowResult {
  ok: boolean
  row?: ParsedEntityRow
  errors: RowError[]
  /** Qator saqlanadi, lekin foydalanuvchi bilishi kerak (masalan telefon noto'g'ri → saqlanmaydi) */
  warnings: RowError[]
}

const str = (v: unknown): string => String(v ?? '').trim()

/**
 * Bitta qatorni tekshiradi va normallashtiradi.
 * `defaultDistrict` — foydalanuvchi butun fayl uchun tuman tanlagan bo'lsa
 * (faylda ustun bo'lmasligi mumkin).
 */
export function parseImportRow(
  cells: unknown[],
  cols: Partial<Record<ColumnKey, number>>,
  rowNumber: number,
  opts: { defaultDistrictName?: string | null } = {},
): ParseRowResult {
  const at = (key: ColumnKey): unknown => {
    const i = cols[key]
    return i === undefined ? undefined : cells[i]
  }
  const errors: RowError[] = []
  const warnings: RowError[] = []
  const tooLong = (key: ColumnKey, value: string, max: number, label: string) => {
    if (value.length > max) errors.push({ rowNumber, message: `${label} ${max} belgidan oshmasligi kerak`, column: key })
  }

  const name = str(at('name'))
  if (!name) {
    // Nomsiz qator — odatda bo'sh qator yoki jami satri
    errors.push({ rowNumber, message: 'Tashkilot nomi bo\'sh', column: 'name' })
  }
  tooLong('name', name, FIELD_LIMITS.name, 'Nom')

  const districtName = str(at('district')) || str(opts.defaultDistrictName ?? '')
  if (!districtName) {
    errors.push({ rowNumber, message: 'Tuman ko\'rsatilmagan', column: 'district' })
  }
  tooLong('district', districtName, FIELD_LIMITS.place, 'Tuman nomi')
  const mahallaName = str(at('mahalla'))
  tooLong('mahalla', mahallaName, FIELD_LIMITS.place, 'Mahalla nomi')

  const rawBilling = at('billingMode')
  const billingModeGiven = str(rawBilling) !== ''
  const billingMode = parseBillingMode(rawBilling)

  // Summa: katak to'ldirilgan bo'lsa-yu raqamga aylanmasa — jimgina 0 emas, xato
  const readMoney = (key: 'monthlyFee' | 'cubicPrice', label: string): number => {
    const raw = at(key)
    if (raw == null || str(raw) === '') return 0
    const n = parseAmount(raw)
    if (n === null) {
      errors.push({ rowNumber, message: `${label} raqam emas: "${str(raw).slice(0, 30)}"`, column: key })
      return 0
    }
    if (n > MAX_FEE) {
      errors.push({ rowNumber, message: `${label} juda katta (maksimum ${MAX_FEE})`, column: key })
      return 0
    }
    return n
  }
  const monthlyFee = readMoney('monthlyFee', 'Oylik summa')
  const cubicPrice = readMoney('cubicPrice', 'Kub narxi')

  if (billingMode === 'monthly_fixed' && monthlyFee <= 0) {
    errors.push({
      rowNumber,
      message: 'Belgilangan oylik rejimi uchun oylik summa kiritilishi shart',
      column: 'monthlyFee',
    })
  }
  if (billingMode === 'talon' && cubicPrice <= 0) {
    errors.push({
      rowNumber,
      message: 'Talon rejimi uchun bir kub narxi kiritilishi shart',
      column: 'cubicPrice',
    })
  }
  if (monthlyFee < 0 || cubicPrice < 0) {
    errors.push({ rowNumber, message: 'Summa manfiy bo\'lishi mumkin emas', column: 'monthlyFee' })
  }

  const rawStir = str(at('stir')).replace(/\D/g, '')
  if (rawStir && rawStir.length !== 9) {
    errors.push({ rowNumber, message: `STIR 9 xonali bo'lishi kerak (kiritilgan: ${rawStir.length} xona)`, column: 'stir' })
  }

  const rawContractMonth = at('contractStartMonth')
  const contractStartMonth = parseContractMonth(rawContractMonth)
  if (rawContractMonth != null && str(rawContractMonth) !== '' && !contractStartMonth) {
    errors.push({ rowNumber, message: 'Shartnoma sanasini o\'qib bo\'lmadi (masalan: 2026-03)', column: 'contractStartMonth' })
  }

  const address = str(at('address'))
  const contactName = str(at('contactName'))
  const code = str(at('code'))
  const contractNumber = str(at('contractNumber'))
  tooLong('address', address, FIELD_LIMITS.address, 'Manzil')
  tooLong('contactName', contactName, FIELD_LIMITS.contactName, "Mas'ul shaxs")
  tooLong('code', code, FIELD_LIMITS.code, 'Kod')
  tooLong('contractNumber', contractNumber, FIELD_LIMITS.contractNumber, 'Shartnoma raqami')

  const rawLat = str(at('lat')), rawLon = str(at('lon'))
  const latNum = parseFloat(rawLat.replace(',', '.'))
  const lonNum = parseFloat(rawLon.replace(',', '.'))
  let lat = Number.isFinite(latNum) && latNum >= -90 && latNum <= 90 ? latNum : null
  let lon = Number.isFinite(lonNum) && lonNum >= -180 && lonNum <= 180 ? lonNum : null
  // Koordinata faqat juftlikda yoki (0,0) emas
  if ((lat === null) !== (lon === null) || (lat === 0 && lon === 0)) { lat = null; lon = null }
  if ((rawLat || rawLon) && (lat === null || lon === null)) {
    warnings.push({ rowNumber, message: "Koordinatalar noto'g'ri yoki to'liq emas — joylashuv saqlanmaydi", column: 'lat' })
  }

  const rawPhone = at('phone')
  const phone = parsePhone(rawPhone)
  if (str(rawPhone) !== '' && !phone) {
    warnings.push({ rowNumber, message: `Telefon raqami noto'g'ri ("${str(rawPhone).slice(0, 25)}") — saqlanmaydi, SMS yuborilmaydi`, column: 'phone' })
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  return {
    ok: true,
    errors: [],
    warnings,
    row: {
      rowNumber,
      name,
      stir: rawStir || null,
      code: code || null,
      address: address || null,
      phone,
      contactName: contactName || null,
      districtName,
      mahallaName: mahallaName || null,
      billingMode,
      billingModeGiven,
      monthlyFee: billingMode === 'talon' ? 0 : monthlyFee,
      cubicPrice: billingMode === 'talon' ? cubicPrice : 0,
      contractNumber: contractNumber || null,
      contractStartMonth,
      lat, lon,
    },
  }
}

/**
 * Sarlavha qatorini birinchi `maxScan` qator ichidan topadi: "Nomi" ustuni tanilgan va
 * eng ko'p ustun mos kelgan qator. Sarlavhadan oldin sarlavha-logo/sana qatorlari bo'lishi mumkin.
 * Topilmasa -1.
 */
export function findHeaderRowIndex(rowsCells: unknown[][], maxScan = 10): number {
  let best = -1
  let bestScore = 0
  const n = Math.min(maxScan, rowsCells.length)
  for (let i = 0; i < n; i++) {
    const cols = detectColumns(rowsCells[i] ?? [])
    if (cols.name === undefined) continue
    const score = Object.keys(cols).length
    if (score > bestScore) { best = i; bestScore = score }
  }
  return best
}

// ── Mavjud tashkilotni YANGILASH qoidasi ("update" rejimi) ────────────────────

/** Bazadagi tashkilotning import bilan solishtiriladigan maydonlari */
export interface ExistingForMerge {
  name: string
  code: string | null
  address: string | null
  phone: string | null
  contactName: string | null
  billingMode: string
  monthlyFee: number
  cubicPrice: number
  contractNumber: string | null
  contractStartMonth: string | null
  lat: number | null
  lon: number | null
  districtName: string | null
  mahallaName: string | null
}

export interface ImportChange { field: string; from: unknown; to: unknown }

/** Faylda ko'rsatilgan maydonning joriy yozuvdan farqi. */
export interface MergeResult {
  /** Prisma `data` ga qo'shiladigan oddiy maydonlar (tuman/mahalla alohida — `districtChanged`/`mahallaChanged`) */
  patch: Record<string, unknown>
  changes: ImportChange[]
  districtChanged: boolean
  mahallaChanged: boolean
}

/**
 * QOIDA: fayldagi BO'SH katak bazadagi qiymatni O'CHIRMAYDI. Faqat to'ldirilgan maydonlar
 * yangilanadi. Rejim — faqat "Rejim" katagi to'ldirilgan bo'lsa; summa — faqat > 0 bo'lsa.
 * Bu funksiya pure: bazaga yozmaydi, preview ham, confirm ham shuni ishlatadi.
 */
export function mergeImportRow(existing: ExistingForMerge, row: ParsedEntityRow): MergeResult {
  const patch: Record<string, unknown> = {}
  const changes: ImportChange[] = []
  const set = (field: string, from: unknown, to: unknown) => {
    if (from === to) return
    patch[field] = to
    changes.push({ field, from: from ?? null, to })
  }

  if (row.name && row.name !== existing.name) set('name', existing.name, row.name)
  if (row.code) set('code', existing.code, row.code)
  if (row.address) set('address', existing.address, row.address)
  if (row.phone) set('phone', existing.phone, row.phone)
  if (row.contactName) set('contactName', existing.contactName, row.contactName)
  if (row.contractNumber) set('contractNumber', existing.contractNumber, row.contractNumber)
  if (row.contractStartMonth) set('contractStartMonth', existing.contractStartMonth, row.contractStartMonth)

  const mode = row.billingModeGiven ? row.billingMode : existing.billingMode
  if (row.billingModeGiven) set('billingMode', existing.billingMode, row.billingMode)
  if (mode !== 'talon' && row.monthlyFee > 0) set('monthlyFee', existing.monthlyFee, row.monthlyFee)
  if (mode === 'talon' && row.cubicPrice > 0) set('cubicPrice', existing.cubicPrice, row.cubicPrice)

  if (row.lat !== null && row.lon !== null && (existing.lat !== row.lat || existing.lon !== row.lon)) {
    patch.lat = row.lat; patch.lon = row.lon
    changes.push({ field: 'location', from: existing.lat != null ? `${existing.lat}, ${existing.lon}` : null, to: `${row.lat}, ${row.lon}` })
  }

  let districtChanged = false
  if (row.districtName && normalizePlaceName(row.districtName) !== normalizePlaceName(existing.districtName ?? '')) {
    districtChanged = true
    changes.push({ field: 'district', from: existing.districtName, to: row.districtName })
  }
  // Mahalla: faylda ko'rsatilsa va farq qilsa yoki tuman o'zgarsa (eski tumanning mahallasi qolib ketmasin)
  let mahallaChanged = false
  if (row.mahallaName && normalizePlaceName(row.mahallaName) !== normalizePlaceName(existing.mahallaName ?? '')) {
    mahallaChanged = true
    changes.push({ field: 'mahalla', from: existing.mahallaName, to: row.mahallaName })
  } else if (districtChanged && existing.mahallaName) {
    mahallaChanged = true
    changes.push({ field: 'mahalla', from: existing.mahallaName, to: null })
  }

  return { patch, changes, districtChanged, mahallaChanged }
}

/**
 * Fayl ICHIDAGI takror STIRlarni topadi (bazadagi takrorlar controllerda tekshiriladi).
 * Birinchi uchrash saqlanadi, keyingilari takror deb belgilanadi.
 */
export function findDuplicates(rows: ParsedEntityRow[]): {
  unique: ParsedEntityRow[]
  duplicates: { rowNumber: number; stir: string; firstRowNumber: number }[]
} {
  const seen = new Map<string, number>()
  const unique: ParsedEntityRow[] = []
  const duplicates: { rowNumber: number; stir: string; firstRowNumber: number }[] = []

  for (const r of rows) {
    if (!r.stir) { unique.push(r); continue }   // STIR yo'q — takror deb hisoblamaymiz
    const first = seen.get(r.stir)
    if (first !== undefined) {
      duplicates.push({ rowNumber: r.rowNumber, stir: r.stir, firstRowNumber: first })
      continue
    }
    seen.set(r.stir, r.rowNumber)
    unique.push(r)
  }
  return { unique, duplicates }
}

/**
 * Import qilinadigan qatorlardan yaratilishi kerak bo'lgan yangi tuman/mahalla
 * ro'yxatini yig'adi (mavjudlari bilan solishtirib). Oldindan ko'rish qadamida
 * foydalanuvchiga "3 ta yangi tuman yaratiladi" deb ko'rsatish uchun.
 */
export function collectNewPlaces(
  rows: ParsedEntityRow[],
  existingDistricts: { id: string; name: string }[],
  existingMahallas: { id: string; name: string; districtId: string }[],
): {
  newDistricts: string[]
  newMahallas: { district: string; mahalla: string }[]
} {
  const districtByKey = new Map(existingDistricts.map(d => [normalizePlaceName(d.name), d]))
  const mahallaKeys = new Set(
    existingMahallas.map(m => `${m.districtId}|${normalizePlaceName(m.name)}`),
  )

  const newDistricts = new Map<string, string>()      // kalit → asl nom
  const newMahallas = new Map<string, { district: string; mahalla: string }>()

  for (const r of rows) {
    if (!r.districtName) continue
    const dKey = normalizePlaceName(r.districtName)
    const existingDistrict = districtByKey.get(dKey)
    if (!existingDistrict && !newDistricts.has(dKey)) {
      newDistricts.set(dKey, r.districtName)
    }
    if (!r.mahallaName) continue
    const mKey = normalizePlaceName(r.mahallaName)
    // Tuman yangi bo'lsa — uning barcha mahallalari ham yangi
    const compositeKey = existingDistrict
      ? `${existingDistrict.id}|${mKey}`
      : `NEW:${dKey}|${mKey}`
    if (existingDistrict && mahallaKeys.has(compositeKey)) continue
    if (!newMahallas.has(compositeKey)) {
      newMahallas.set(compositeKey, { district: r.districtName, mahalla: r.mahallaName })
    }
  }

  return {
    newDistricts: Array.from(newDistricts.values()),
    newMahallas: Array.from(newMahallas.values()),
  }
}
