/**
 * O'zbek lotin → kirill avtomatik transliteratsiyasi.
 *
 * Maqsad: bitta tarjima manbasi (uz lotin) va dinamik ravishda kirill
 * versiyasini ham generate qilish — ikki marta yozishga hojat yo'q.
 *
 * Mantiq: i18n.ts da uz lotin resource lar uz-cyrl resource ga
 * deepLatToCyrl() bilan o'tkaziladi → tilni almashtirgan foydalanuvchi
 * darhol kirillda ko'radi.
 *
 * Override list: brendlar va texnik atamalar (Excel, PDF, AvtoHisob, va h.k.)
 * lotinda qoladi — ularni transliteratsiya qilish chalkashlik chiqarardi.
 */

// Brand'lar va texnik atamalar — transliteratsiya qilinmaydi
const KEEP_LATIN = [
  // Software / tech
  'Excel', 'PDF', 'CSV', 'JSON', 'XML', 'XLSX',
  'Email', 'E-mail',
  'Telegram', 'WhatsApp', 'Instagram', 'Facebook',
  'API', 'OCR', 'AI', 'GPS', 'SaaS',
  'HTTP', 'HTTPS', 'URL', 'IP',
  'SMS', 'PWA', 'QR',
  'ID', 'IDs', 'UUID',
  'KM', 'L', 'kg',
  // Brendlar
  'AvtoHisob', 'AutoHisob', 'Avtohisob',
  'SmartGPS', 'Wialon',
  // Yuridik atamalar
  'STIR', 'INN', 'MFO', 'IFUT', 'MCHJ', 'YATT', 'NDS', 'JK',
  // Klaviatura
  'Ctrl', 'Shift', 'Alt', 'Tab', 'Enter', 'Esc',
]

// ── Lotin → Kirill mapping ────────────────────────────────────────────────────
// Multi-char ketma-ketliklar oldin (tartib muhim)
// Apostrof variantlari: oddiy ' va curly ' (U+2019)
const LAT_TO_CYR: [string, string][] = [
  // Maxsus o'zbek tovushlari (apostrof bilan)
  ['o’', 'ў'], ['O’', 'Ў'],
  ["o'",      'ў'], ["O'",      'Ў'],
  ['g’', 'ғ'], ['G’', 'Ғ'],
  ["g'",      'ғ'], ["G'",      'Ғ'],
  // Multi-char (tartib muhim — eng uzunidan boshlab)
  ['ng', 'нг'], ['Ng', 'Нг'], ['NG', 'НГ'],
  ['sh', 'ш'],  ['Sh', 'Ш'],  ['SH', 'Ш'],
  ['ch', 'ч'],  ['Ch', 'Ч'],  ['CH', 'Ч'],
  ['ts', 'ц'],  ['Ts', 'Ц'],  ['TS', 'Ц'],
  ['yu', 'ю'],  ['Yu', 'Ю'],  ['YU', 'Ю'],
  ['ya', 'я'],  ['Ya', 'Я'],  ['YA', 'Я'],
  ['yo', 'ё'],  ['Yo', 'Ё'],  ['YO', 'Ё'],
  ['ye', 'е'],  ['Ye', 'Е'],  ['YE', 'Е'],
  // Bir harfli
  ['a', 'а'], ['A', 'А'],
  ['b', 'б'], ['B', 'Б'],
  ['d', 'д'], ['D', 'Д'],
  ['e', 'е'], ['E', 'Е'],
  ['f', 'ф'], ['F', 'Ф'],
  ['g', 'г'], ['G', 'Г'],
  ['h', 'ҳ'], ['H', 'Ҳ'],
  ['i', 'и'], ['I', 'И'],
  ['j', 'ж'], ['J', 'Ж'],
  ['k', 'к'], ['K', 'К'],
  ['l', 'л'], ['L', 'Л'],
  ['m', 'м'], ['M', 'М'],
  ['n', 'н'], ['N', 'Н'],
  ['o', 'о'], ['O', 'О'],
  ['p', 'п'], ['P', 'П'],
  ['q', 'қ'], ['Q', 'Қ'],
  ['r', 'р'], ['R', 'Р'],
  ['s', 'с'], ['S', 'С'],
  ['t', 'т'], ['T', 'Т'],
  ['u', 'у'], ['U', 'У'],
  ['v', 'в'], ['V', 'В'],
  ['x', 'х'], ['X', 'Х'],
  ['y', 'й'], ['Y', 'Й'],
  ['z', 'з'], ['Z', 'З'],
]

const PLACEHOLDER = ''

function applyMap(str: string): string {
  let result = str
  for (const [from, to] of LAT_TO_CYR) {
    // split/join replaceAll bilan ekvivalent (eski Node versiyalarda ham ishlaydi)
    result = result.split(from).join(to)
  }
  return result
}

/**
 * Bitta matnni lotin→kirill o'tkazadi. Override ro'yxatdagi atamalar
 * (Excel, AvtoHisob va h.k.) lotinda qoladi.
 */
export function latToCyrl(text: string): string {
  if (!text || typeof text !== 'string') return text
  const saved: string[] = []
  let work = text

  // 1. Override so'zlarni placeholder bilan almashtiramiz (transliteratsiya qilmaymiz)
  for (const word of KEEP_LATIN) {
    // \b — word boundary, atom shaklida emas (boshqa so'z ichida bo'lmasin)
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    work = work.replace(re, (m) => {
      saved.push(m)
      return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`
    })
  }

  // 2. Transliteratsiya
  work = applyMap(work)

  // 3. Override so'zlarni qaytarib joylashtiramiz
  work = work.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_, idx) => saved[Number(idx)]
  )

  return work
}

/**
 * Obyekt yoki massiv ichidagi BARCHA string qiymatlarni rekursiv transliterate qiladi.
 * i18n resource bundle (translation: { nav: {...}, common: {...} }) uchun ideal.
 */
export function deepLatToCyrl<T>(obj: T): T {
  if (typeof obj === 'string') return latToCyrl(obj) as unknown as T
  if (Array.isArray(obj)) return obj.map(deepLatToCyrl) as unknown as T
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const key in obj as Record<string, unknown>) {
      result[key] = deepLatToCyrl((obj as Record<string, unknown>)[key])
    }
    return result as unknown as T
  }
  return obj
}
