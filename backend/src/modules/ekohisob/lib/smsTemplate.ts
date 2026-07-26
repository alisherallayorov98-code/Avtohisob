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

/** GSM-7 alifbosiga kirmaydigan belgi bormi (kirill, ʻ, emoji → UCS-2) */
const GSM7 = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
   "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
   "^{}\\[~]|€").split(''),
)

export interface SmsLength {
  chars: number
  /** UCS-2 (kirill/maxsus belgi) bo'lsa true — bitta SMS 70 belgi */
  unicode: boolean
  /** nechta SMS ketadi (narx shunga bog'liq) */
  segments: number
}

/**
 * SMS uzunligini hisoblaydi. Korxona shablon yozayotganda "bu 3 ta SMS ketadi"
 * deb ko'rsatish uchun — narx uch barobar oshishi kutilmagan bo'lmasin.
 */
export function smsLength(text: string): SmsLength {
  const chars = [...text].length
  const unicode = [...text].some(c => !GSM7.has(c))
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  const segments = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi)
  return { chars, unicode, segments }
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
