// Yog'/moй kalit so'zlari — barcha tillar va yozuvlarda
const OIL_KEYWORDS = [
  // O'zbek lotin
  'yog', "yog'", 'motor yog', "motor yog'", 'dvigatel yog', "dvigatel yog'",
  'moy', 'motar yog', 'voselin', 'smazka', 'transmissiya yog',
  // O'zbek kirill
  'ёғ', 'мой', 'мотор ёғи', 'двигател ёғи', 'трансмиссия ёғи',
  // Rus
  'масло', 'моторное масло', 'масло двигателя', 'смазка', 'трансмиссионное масло',
  'моторн', 'автомасло', 'масл',
  // Ingliz
  'oil', 'engine oil', 'motor oil', 'lubricant', 'lube',
  // Qisqartmalar va imlolar
  'масло', 'msl', 'oil change', 'oil filter', 'yog filtr',
]

export function detectIsOil(text: string | null | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return OIL_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

// Bir nechta matn qatorlaridan tekshirish
export function detectIsOilFromFields(...fields: (string | null | undefined)[]): boolean {
  return fields.some(f => detectIsOil(f))
}
