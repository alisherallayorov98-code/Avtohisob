// Qidiruv so'rovini tasniflash (pure): nom / STIR / kod / telefon.

export interface SearchQuery {
  kind: 'invalid' | 'name' | 'digits' | 'mixed'
  /** nom bo'yicha (kamida 2 belgi) */
  name: string | null
  /** faqat raqamlar (STIR/telefon uchun), kamida 4 */
  digits: string | null
  /** telefon uchun: oxirgi 4..9 raqam */
  phoneTail: string | null
  /** kod uchun xom matn (probelsiz, kamida 3 belgi) */
  code: string | null
}

export function classifyQuery(raw: string): SearchQuery {
  const text = (raw ?? '').trim().slice(0, 80)
  const digits = text.replace(/\D/g, '')
  const letters = /[\p{L}]/u.test(text)
  const bad: SearchQuery = { kind: 'invalid', name: null, digits: null, phoneTail: null, code: null }
  if (text.length < 2) return bad
  const phoneLike = /^[+\d\s()-]+$/.test(text)
  if (phoneLike) {
    if (digits.length < 4) return bad
    return { kind: 'digits', name: null, digits, phoneTail: digits.slice(-9), code: digits.length >= 3 ? digits : null }
  }
  const code = !/\s/.test(text) && text.length >= 3 && /\d/.test(text) ? text : null
  return {
    kind: letters && digits.length >= 4 ? 'mixed' : 'name',
    name: text,
    digits: digits.length >= 4 ? digits : null,
    phoneTail: null,
    code,
  }
}
