// Ta'mir matnidan detal turini aniqlash — lotin/kirill/rus/ingliz yozuvlar.
// Ehtiyot: qisqa o'zaklar ("kolsa", "vklad") imlo xatolarini ham qamrab oladi.

const ENGINE_PARTS = [
  'porshen', 'поршен', 'piston',
  'kolsa', "kol'tso", 'koltso', 'кольц', 'piston ring',
  'vkladish', 'vkladsh', 'вкладыш', 'bearing shell',
  'gilza', 'гильз', 'cylinder liner',
  'kolenval', 'tirsakli val', 'коленвал', 'crankshaft',
  'raspredval', 'распредвал', 'camshaft',
  'gbts', 'гбц', 'golovka bloka', 'головка блока', 'cylinder head',
  'prokladka gbts', 'прокладка гбц', 'head gasket',
  // "klapan" ataylab yo'q — EGR/tormoz/kompressor klapanlari ham shunday ataladi (yolg'on signal)
  'shatun', 'шатун', 'connecting rod',
  'kapital', 'капитал', 'kapremont', 'капремонт', 'overhaul', 'motor remont', 'motorremont', 'dvigatel remont', 'ремонт двигател',
]

const FUEL_SYSTEM_PARTS = [
  'turbina', 'турбин', 'turbo',
  'forsunka', 'форсунк', 'injector',
  'tnvd', 'тнвд', 'yoqilg\'i nasosi yuqori', 'injection pump',
]

const GEARBOX = ['korobka', 'коробк', 'kpp', 'кпп', 'uzatmalar qutisi', 'gearbox']

const BRAKE_PADS = ['kolodka', 'колодк', 'brake pad', 'tormoz kolodka']
const BRAKE_ANY = [...BRAKE_PADS, 'tormoz', 'тормоз', 'brake', 'disk tormoz', 'baraban']

const TIMING_BELT = ['grm', 'грм', 'timing belt', 'timing', 'remen grm', 'ремень грм', 'zubchatiy', 'зубчат']

const BATTERY = ['akkumulyator', 'akkumlyator', 'аккумулятор', 'akb', 'акб', 'battery']

const CLUTCH = ['stseplenie', 'sceplenie', 'сцеплени', 'clutch', 'korzinka', 'корзин', 'vyzhimnoy', 'выжимн']

/** Takroriy almashtirish odatiy bo'lgan sarflanadigan materiallar — "takroriy ta'mir" qoidasidan chetlatiladi */
const CONSUMABLES = [
  'moy', 'yog', 'масл', 'oil', 'filtr', 'фильтр', 'filter', 'antifriz', 'tosol', 'тосол', 'antifreeze',
  'lampa', 'лампа', 'predoxranitel', 'предохранител', 'fuse', 'shayba', 'шайб', 'bolt', 'болт',
  'gayka', 'гайк', 'xomut', 'хомут', 'germetik', 'герметик', 'smazka', 'смазк', 'solidol', 'солидол',
  'suv', 'вода', 'omyvatel', 'омыват', 'distillyat', 'дистиллят', 'tormoz suyuq', 'тормозн жидк',
]

const SOLD_NOTES = ['sotil', 'sotib yuborildi', 'продан', 'списан', 'hisobdan chiq', 'hisobdan chiqar', 'utilizats', 'утилиз']

function has(text: string, kws: string[]): boolean {
  const t = text.toLowerCase()
  return kws.some(k => t.includes(k))
}

export const isEnginePart = (t: string) => has(t, ENGINE_PARTS)
export const isFuelSystemPart = (t: string) => has(t, FUEL_SYSTEM_PARTS)
export const isGearbox = (t: string) => has(t, GEARBOX)
export const isBrakePads = (t: string) => has(t, BRAKE_PADS)
export const isBrakeWork = (t: string) => has(t, BRAKE_ANY)
export const isTimingBelt = (t: string) => has(t, TIMING_BELT)
export const isBattery = (t: string) => has(t, BATTERY)
export const isClutch = (t: string) => has(t, CLUTCH)
export const isConsumable = (t: string) => has(t, CONSUMABLES)
export const isSoldNote = (t: string) => has(t, SOLD_NOTES)

/** Matndan topilgan birinchi mos so'zlarni qaytaradi (dalil sifatida ko'rsatish uchun) */
export function matchedEngineParts(names: string[]): string[] {
  return names.filter(n => isEnginePart(n)).slice(0, 3)
}

/** Davlat raqamini solishtirish uchun normallashtirish: bo'sh joy/defis yo'q, katta harf, kirill→lotin */
export function normalizePlate(p: string): string {
  // O'xshash harflar (ОВА → OBA) + kirill klaviaturada fonetik yozilganlar (ОБА → OBA)
  const map: Record<string, string> = {
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
    'Б': 'B', 'Д': 'D', 'Г': 'G', 'Л': 'L', 'П': 'P', 'Ф': 'F', 'Ж': 'J', 'И': 'I', 'З': 'Z',
  }
  return p.toUpperCase().replace(/[\s\-_.]/g, '').split('').map(ch => map[ch] || ch).join('')
}
