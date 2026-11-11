// EkoHisob SMS shabloni — sof mantiq (DB'siz, testlanadi).
//
// Nega: SMS matni ilgari kodda qattiq yozilgan edi. Har korxonaning murojaat
// uslubi va aloqa raqami har xil, shuning uchun shablon korxona darajasida
// sozlanadi. Bu yerda faqat render va uzunlik hisobi — yuborish services/sms.ts da.
//
// MUHIM: Eskiz.uz real rejimida faqat OLDINDAN TASDIQLANGAN matn yuboriladi.
// Shablon o'zgartirilsa Eskiz'da qayta tasdiqlatish kerak — UI shu haqda ogohlantiradi.

export const SMS_PLACEHOLDERS = ['tashkilot', 'qarz', 'oy', 'aloqa'] as const
export type SmsPlaceholder = typeof SMS_PLACEHOLDERS[number]

export const DEFAULT_SMS_TEMPLATE =
  'Hurmatli {tashkilot}! Chiqindi xizmati uchun qarzingiz {qarz} som. Iltimos tolovni amalga oshiring. Aloqa: {aloqa}'

export interface SmsVars {
  tashkilot: string
  qarz: string
  oy?: string
  aloqa?: string
}

/** Summani SMS uchun o'qishli qiladi: 1200000 → "1 200 000" */
export function formatSmsAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

/**
 * Shablondagi {o'rin egallovchi}larni to'ldiradi.
 * Noma'lum o'rin egallovchi o'z holicha qoladi (matnni buzmaslik uchun),
 * bo'sh qiymatli {aloqa} esa atrofidagi ortiqcha bo'shliq bilan tozalanadi.
 */
export function renderSmsTemplate(template: string | null | undefined, vars: SmsVars): string {
  const tpl = (template && template.trim()) || DEFAULT_SMS_TEMPLATE
  const map: Record<string, string> = {
    tashkilot: vars.tashkilot ?? '',
    qarz: vars.qarz ?? '',
    oy: vars.oy ?? '',
    aloqa: vars.aloqa ?? '',
  }
  let out = tpl.replace(/\{(\w+)\}/g, (full, key: string) =>
    key in map ? map[key] : full)

  // Bo'sh qiymatdan qolgan "Aloqa: ." kabi osilgan bo'laklarni tozalash
  if (!map.aloqa) out = out.replace(/\s*Aloqa:\s*(?=[.!]|$)/gi, '')
  return out.replace(/\s{2,}/g, ' ').trim()
}

// ─── GSM-7 / UCS-2 va segment hisobi ─────────────────────────────────────────
//
// Operator haqi SEGMENT bo'yicha olinadi:
//  - GSM-7 (7-bit): 1 segment = 160 septet; uzun xabarda har segment 153 septet.
//    Asosiy jadvaldagi belgi 1 septet; kengaytma jadvalidagi (^ { } \ [ ~ ] | € va
//    sahifa o'tkazish) 2 septet (ESC + belgi) — segment chegarasida bo'linmaydi.
//  - UCS-2 (16-bit): GSM-7 da yo'q BITTA belgi bo'lsa ham BUTUN xabar UCS-2:
//    1 segment = 70 birlik; uzun xabarda har segment 67 birlik. Emoji (BMP'dan
//    tashqari) 2 birlik — surrogat juft segment chegarasida bo'linmaydi.
//
// UCS-2 ga o'tkazuvchi tipik belgilar (o'zbek matnida): kirill harflari (ў ғ қ ҳ ё...),
// oʻzbek lotin tutuq belgilari ʻ (U+02BB) va ʼ (U+02BC), tipografik ‘ ’ (U+2018/2019),
// ´ (U+00B4), backtick ` (GSM-7 da YO'Q!), “ ” « », uzun tire — –, ç, í, ó, ú, á, emoji.
// Oddiy ASCII apostrof ' (U+0027) esa GSM-7 da bor — arzon.

const GSM7_BASIC = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
   '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split(''),
)
const GSM7_EXTENSION = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€', '\f'])

export type SmsEncoding = 'gsm7' | 'ucs2'

export interface SmsSegmentInfo {
  encoding: SmsEncoding
  /** septet (GSM-7) yoki UTF-16 birlik (UCS-2) soni */
  units: number
  segments: number
}

export function smsEncoding(text: string): SmsEncoding {
  for (const c of text) {
    if (!GSM7_BASIC.has(c) && !GSM7_EXTENSION.has(c)) return 'ucs2'
  }
  return 'gsm7'
}

/** Aniq segment hisobi (xarajat/limit shu son bo'yicha yuritiladi). Bo'sh matn → 0. */
export function smsSegments(text: string): SmsSegmentInfo {
  const encoding = smsEncoding(text)
  const costs: number[] = []
  for (const c of text) {
    if (encoding === 'gsm7') costs.push(GSM7_EXTENSION.has(c) ? 2 : 1)
    else costs.push((c.codePointAt(0) ?? 0) > 0xffff ? 2 : 1)
  }
  const units = costs.reduce((s, x) => s + x, 0)
  if (units === 0) return { encoding, units: 0, segments: 0 }
  const single = encoding === 'gsm7' ? 160 : 70
  const multi = encoding === 'gsm7' ? 153 : 67
  if (units <= single) return { encoding, units, segments: 1 }
  let segments = 1
  let used = 0
  for (const cost of costs) {
    if (used + cost > multi) { segments++; used = 0 }
    used += cost
  }
  return { encoding, units, segments }
}

/**
 * Xavfsiz almashtirishlar: ma'nosi o'zgarmaydigan tipografik belgilarni ASCII ga
 * keltiradi, shunda matn UCS-2 ga (3x qimmat, 70 belgi) o'tib ketmaydi.
 * Kirill harflariga TEGILMAYDI (ma'no o'zgaradi).
 */
export function toGsmSafe(text: string): string {
  return text
    .replace(/[ʻʼ‘’´`′]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
}

export interface SmsLength {
  chars: number
  /** UCS-2 (kirill/maxsus belgi) bo'lsa true — bitta SMS 70 belgi */
  unicode: boolean
  /** nechta SMS ketadi (narx shunga bog'liq) */
  segments: number
  encoding?: SmsEncoding
  units?: number
}

/**
 * SMS uzunligini hisoblaydi. Korxona shablon yozayotganda "bu 3 ta SMS ketadi"
 * deb ko'rsatish uchun — narx uch barobar oshishi kutilmagan bo'lmasin.
 */
export function smsLength(text: string): SmsLength {
  const info = smsSegments(text)
  return {
    chars: [...text].length,
    unicode: info.encoding === 'ucs2',
    segments: info.segments,
    encoding: info.encoding,
    units: info.units,
  }
}

export interface TemplateIssue {
  level: 'error' | 'warning'
  message: string
}

/**
 * Shablonni tekshiradi. Xato bo'lsa saqlashga ruxsat berilmaydi,
 * ogohlantirish bo'lsa faqat ko'rsatiladi.
 */
export function validateSmsTemplate(template: string): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  const trimmed = template.trim()

  if (!trimmed) {
    issues.push({ level: 'error', message: 'Shablon bo\'sh bo\'lishi mumkin emas' })
    return issues
  }
  if (trimmed.length > 500) {
    issues.push({ level: 'error', message: 'Shablon 500 belgidan uzun bo\'lmasligi kerak' })
  }

  const used = new Set<string>()
  for (const m of trimmed.matchAll(/\{(\w+)\}/g)) {
    used.add(m[1])
    if (!SMS_PLACEHOLDERS.includes(m[1] as SmsPlaceholder)) {
      issues.push({
        level: 'error',
        message: `Noma'lum o'rin egallovchi: {${m[1]}}. Ruxsat etilgan: ${SMS_PLACEHOLDERS.map(p => `{${p}}`).join(', ')}`,
      })
    }
  }
  if (!used.has('qarz')) {
    issues.push({ level: 'warning', message: 'Matnda {qarz} yo\'q — qarzdor summani bilmaydi' })
  }

  // Namunaviy qiymatlar bilan uzunlikni baholaymiz
  const sample = renderSmsTemplate(trimmed, {
    tashkilot: '"Namuna" MChJ', qarz: '1 200 000', oy: '2026-07', aloqa: '901234567',
  })
  const len = smsLength(sample)
  if (len.segments > 2) {
    issues.push({
      level: 'warning',
      message: `Matn ${len.segments} ta SMS ga bo'linadi (${len.chars} belgi) — narx shuncha barobar oshadi`,
    })
  }
  if (len.unicode) {
    issues.push({
      level: 'warning',
      message: 'Matnda kirill yoki maxsus belgi bor — bitta SMS 70 belgi (lotinda 160). Lotin harflari arzonroq.',
    })
  }
  return issues
}
