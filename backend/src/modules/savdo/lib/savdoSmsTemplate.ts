// Savdo — qarzdorlarga SMS eslatma shabloni. SOF mantiq (DB'siz, testlanadi).
//
// Nega alohida fayl: SMS matni va uzunlik/narx hisobi hech qanday bazaga
// bog'liq emas, shuning uchun testlanadigan yadro qilib ajratilgan. Yuborish
// mantiqi services/savdoSms.ts da.
//
// MUHIM: Eskiz.uz real rejimida faqat OLDINDAN TASDIQLANGAN matn yuboriladi.
// Shablon o'zgartirilsa Eskiz'da qayta tasdiqlatish kerak.

export interface SmsPlaceholder {
  key: string
  label: string
}

/** UI'da ko'rsatiladigan o'rin egalari ro'yxati */
export const SMS_PLACEHOLDERS: SmsPlaceholder[] = [
  { key: 'mijoz', label: 'Mijoz nomi' },
  { key: 'qarz', label: 'Qarz summasi (so\'m)' },
  { key: 'korxona', label: 'Korxona nomi' },
  { key: 'telefon', label: 'Aloqa telefoni' },
  { key: 'sana', label: 'Bugungi sana' },
]

export const DEFAULT_SMS_TEMPLATE =
  'Hurmatli {mijoz}! {korxona} oldidagi qarzingiz {qarz} som. Iltimos, tolovni amalga oshiring. Tel: {telefon}'

export interface SmsVars {
  mijoz: string
  qarz: number
  korxona?: string | null
  telefon?: string | null
  sana?: Date
}

/** 1250000 → "1 250 000" (ru-RU ajratuvchisi oddiy probelga keltiriladi) */
function formatAmount(n: number): string {
  return Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ')
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

/**
 * Shablondagi {o'rin egasi}larni to'ldiradi.
 * Noma'lum o'rin egasi o'z holicha qoladi (matnni buzmaslik uchun),
 * bo'sh qiymat esa bo'sh satr bilan almashadi.
 */
export function renderSmsTemplate(template: string | null | undefined, vars: SmsVars): string {
  const tpl = (template && template.trim()) || DEFAULT_SMS_TEMPLATE
  const map: Record<string, string> = {
    mijoz: vars.mijoz ?? '',
    qarz: formatAmount(Number(vars.qarz) || 0),
    korxona: vars.korxona ?? '',
    telefon: vars.telefon ?? '',
    sana: formatDate(vars.sana ?? new Date()),
  }
  const out = tpl.replace(/\{(\w+)\}/g, (full, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : full)
  // Bo'sh qiymatdan qolgan ikki-uch probelni tozalash
  return out.replace(/ {2,}/g, ' ').trim()
}

/** GSM-7 alifbosi — bunga kirmagan belgi bo'lsa SMS UCS-2 (70 belgi) bo'ladi */
const GSM7 = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
   "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
   "^{}\\[~]|€").split(''),
)

/**
 * Matn nechta SMS segmentiga bo'linishini hisoblaydi — narx shunga bog'liq.
 * GSM-7: 160 (bitta) / 153 (bo'lingan). Unicode (kirill, ʻ, emoji): 70 / 67.
 */
export function smsSegments(text: string): number {
  const chars = [...text]
  if (chars.length === 0) return 0
  const unicode = chars.some(c => !GSM7.has(c))
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  return chars.length <= single ? 1 : Math.ceil(chars.length / multi)
}

/** Matn unicode (UCS-2) rejimida ketadimi — UI'da ogohlantirish uchun */
export function isUnicodeSms(text: string): boolean {
  return [...text].some(c => !GSM7.has(c))
}

/** Taxminiy narx (so'm): segment × qabul qiluvchi × segment narxi */
export function estimateSmsCost(text: string, recipients: number, pricePerSegment = 55): number {
  const r = Math.max(0, Math.floor(recipients))
  return smsSegments(text) * r * pricePerSegment
}

/**
 * Telefonni 998XXXXXXXXX ko'rinishiga keltiradi.
 * 9 xonali → oldiga 998 qo'shiladi; 12 xonali va 998 bilan boshlansa — o'zi;
 * boshqa holatda null (yuborilmaydi).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 9) return `998${digits}`
  if (digits.length === 12 && digits.startsWith('998')) return digits
  return null
}
