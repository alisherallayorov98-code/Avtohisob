/**
 * Uzbek Latin ↔ Cyrillic transliteration for search queries.
 *
 * When a user types in Cyrillic but data is stored in Latin (or vice-versa),
 * search returns nothing. This utility generates both script variants so
 * Prisma OR conditions can match either form in the database.
 *
 * Usage:
 *   const variants = getSearchVariants(search)
 *   where.OR = variants.flatMap(v => [
 *     { name: { contains: v, mode: 'insensitive' } },
 *     { code: { contains: v, mode: 'insensitive' } },
 *   ])
 */

// ── Cyrillic → Latin ──────────────────────────────────────────────────────────
// Multi-char sequences MUST come before their constituent single chars.
const CYR_TO_LAT: [string, string][] = [
  // Multi-char (order matters)
  ['нг', 'ng'], ['Нг', 'Ng'], ['НГ', 'NG'],
  ['ш',  'sh'], ['Ш',  'Sh'],
  ['ч',  'ch'], ['Ч',  'Ch'],
  ['ю',  'yu'], ['Ю',  'Yu'],
  ['я',  'ya'], ['Я',  'Ya'],
  ['ё',  'yo'], ['Ё',  'Yo'],
  ['е',  'e'],  ['Е',  'E'],
  ['э',  'e'],  ['Э',  'E'],
  ['ц',  'ts'], ['Ц',  'Ts'],
  ['щ',  'sh'], ['Щ',  'Sh'],
  ['ъ',  "'"],  ['Ъ',  "'"],
  ['ь',  ''],   ['Ь',  ''],
  // Uzbek-specific letters
  ['ў',  "o'"], ['Ў',  "O'"],
  ['ғ',  "g'"], ['Ғ',  "G'"],
  ['қ',  'q'],  ['Қ',  'Q'],
  ['ҳ',  'h'],  ['Ҳ',  'H'],
  // Standard single chars
  ['а', 'a'], ['А', 'A'],
  ['б', 'b'], ['Б', 'B'],
  ['в', 'v'], ['В', 'V'],
  ['г', 'g'], ['Г', 'G'],
  ['д', 'd'], ['Д', 'D'],
  ['ж', 'j'], ['Ж', 'J'],
  ['з', 'z'], ['З', 'Z'],
  ['и', 'i'], ['И', 'I'],
  ['й', 'y'], ['Й', 'Y'],
  ['к', 'k'], ['К', 'K'],
  ['л', 'l'], ['Л', 'L'],
  ['м', 'm'], ['М', 'M'],
  ['н', 'n'], ['Н', 'N'],
  ['о', 'o'], ['О', 'O'],
  ['п', 'p'], ['П', 'P'],
  ['р', 'r'], ['Р', 'R'],
  ['с', 's'], ['С', 'S'],
  ['т', 't'], ['Т', 'T'],
  ['у', 'u'], ['У', 'U'],
  ['ф', 'f'], ['Ф', 'F'],
  ['х', 'x'], ['Х', 'X'],
]

// ── Latin → Cyrillic ──────────────────────────────────────────────────────────
// Apostrophe variants: standard ' and curly ' (U+2019)
const LAT_TO_CYR: [string, string][] = [
  // Uzbek special combos (apostrophe variants)
  ["o\u2019", 'ў'], ["O\u2019", 'Ў'],
  ["o'",      'ў'], ["O'",      'Ў'],
  ["g\u2019", 'ғ'], ["G\u2019", 'Ғ'],
  ["g'",      'ғ'], ["G'",      'Ғ'],
  // Multi-char (order matters)
  ['ng', 'нг'], ['Ng', 'Нг'], ['NG', 'НГ'],
  ['sh', 'ш'],  ['Sh', 'Ш'],  ['SH', 'Ш'],
  ['ch', 'ч'],  ['Ch', 'Ч'],  ['CH', 'Ч'],
  ['ts', 'ц'],  ['Ts', 'Ц'],  ['TS', 'Ц'],
  ['yu', 'ю'],  ['Yu', 'Ю'],  ['YU', 'Ю'],
  ['ya', 'я'],  ['Ya', 'Я'],  ['YA', 'Я'],
  ['yo', 'ё'],  ['Yo', 'Ё'],  ['YO', 'Ё'],
  ['ye', 'е'],  ['Ye', 'Е'],  ['YE', 'Е'],
  // Single chars
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

function applyMap(str: string, map: [string, string][]): string {
  let result = str
  for (const [from, to] of map) {
    // split/join is equivalent to replaceAll but works on all Node versions
    result = result.split(from).join(to)
  }
  return result
}

export function cyrillicToLatin(str: string): string {
  return applyMap(str, CYR_TO_LAT)
}

export function latinToCyrillic(str: string): string {
  return applyMap(str, LAT_TO_CYR)
}

const RE_CYRILLIC = /[а-яёА-ЯЁўғқҳҲҒҚЎ]/u

export function getSearchVariants(query: string): string[] {
  if (!query || query.trim().length === 0) return [query]

  const hasCyrillic = RE_CYRILLIC.test(query)

  if (hasCyrillic) {
    // Query is in Cyrillic — also search for the Latin equivalent
    const latin = cyrillicToLatin(query)
    if (latin !== query) return [query, latin]
  } else {
    // Query is in Latin — also search for the Cyrillic equivalent
    const cyrillic = latinToCyrillic(query)
    if (cyrillic !== query) return [query, cyrillic]
  }

  return [query]
}
