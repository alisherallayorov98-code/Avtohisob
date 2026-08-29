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

// Boshqa tizim moylari — motor (dvigatel) moyi EMAS. Bular ta'mirlashda kiritilganda
// "motor moyi almashdi" signal berib, oil_change intervalini noto'g'ri 0dan boshlab
// yubormasligi kerak (masalan: "delivka/raздатка/most yog'i" — dvigatel emas).
const NON_ENGINE_OIL_KEYWORDS = [
  'transmissiya', 'трансмисс', 'transmission',
  'gidravlika', 'gidravlik', 'гидравлик', 'hydraulic',
  'korobka', 'коробк', 'gearbox', 'gear oil',
  'most', 'мост', 'differensial', 'дифференциал', 'differential',
  'razdatka', 'раздатк', 'delivka', 'даливка', 'дэливка', 'transfer case',
  'smazka', 'смазка', 'grease', 'voselin', 'солидол', 'solidol',
  'tosol', 'тосол', 'antifriz', 'antifreeze', 'coolant', 'sovutish suyuqlik',
  'gidrousilitel', 'гидроусилител', 'rul yog', 'руль масло', 'power steering',
]

// Bu so'zlar bo'lsa — yuqoridagi chetlashtirish bekor qilinadi (haqiqatan ham motor moyi)
const ENGINE_QUALIFIER_KEYWORDS = [
  'motor', 'dvigatel', 'двигател', 'мотор', 'engine',
]

export function detectIsOil(text: string | null | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  const hasOilKeyword = OIL_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
  if (!hasOilKeyword) return false
  const isNonEngine = NON_ENGINE_OIL_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
  if (!isNonEngine) return true
  return ENGINE_QUALIFIER_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

// Bir nechta matn qatorlaridan tekshirish
export function detectIsOilFromFields(...fields: (string | null | undefined)[]): boolean {
  return fields.some(f => detectIsOil(f))
}
