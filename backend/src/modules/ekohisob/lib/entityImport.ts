// EkoHisob — tashkilotlarni Excel'dan import qilish mantiqi (DB'siz, testlanadi).
//
// Nega: yangi shahar/tuman ulash mingta tashkilotni qo'lda kiritishni talab qilardi —
// bu mijoz ulash tezligidagi asosiy to'siq. Bu yerda faqat SOF qism: ustunlarni
// tanish, qatorni tekshirish/normallashtirish, takrorlarni topish. DB bilan ishlash
// controllers/entityImport.ts da.

export type BillingMode = 'monthly_fixed' | 'variable' | 'talon'

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
  return normalizeHeader(s)
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

/** "1 200 000", "1,200,000", "1200000.00" → 1200000 */
export function parseAmount(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? Math.round(n) : null
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

  const name = str(at('name'))
  if (!name) {
    // Nomsiz qator — odatda bo'sh qator yoki jami satri
    errors.push({ rowNumber, message: 'Tashkilot nomi bo\'sh', column: 'name' })
  }

  const districtName = str(at('district')) || str(opts.defaultDistrictName ?? '')
  if (!districtName) {
    errors.push({ rowNumber, message: 'Tuman ko\'rsatilmagan', column: 'district' })
  }

  const billingMode = parseBillingMode(at('billingMode'))
  const monthlyFee = parseAmount(at('monthlyFee')) ?? 0
  const cubicPrice = parseAmount(at('cubicPrice')) ?? 0

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

  const latNum = parseFloat(str(at('lat')))
  const lonNum = parseFloat(str(at('lon')))
  const lat = Number.isFinite(latNum) && latNum >= -90 && latNum <= 90 ? latNum : null
  const lon = Number.isFinite(lonNum) && lonNum >= -180 && lonNum <= 180 ? lonNum : null

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    errors: [],
    row: {
      rowNumber,
      name,
      stir: rawStir || null,
      code: str(at('code')) || null,
      address: str(at('address')) || null,
      phone: parsePhone(at('phone')),
      contactName: str(at('contactName')) || null,
      districtName,
      mahallaName: str(at('mahalla')) || null,
      billingMode,
      monthlyFee: billingMode === 'talon' ? 0 : monthlyFee,
      cubicPrice: billingMode === 'talon' ? cubicPrice : 0,
      contractNumber: str(at('contractNumber')) || null,
      contractStartMonth,
      lat, lon,
    },
  }
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
