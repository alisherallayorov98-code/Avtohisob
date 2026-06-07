// O'zbek lotin -> kirill transliteratsiyasi (EkoHisob dala-bot uchun).
// Emoji, raqam, lotin bo'lmagan belgilar o'zgarmaydi. HTML teglari (<b>...</b>) saqlanadi.

const MULTI: [RegExp, string][] = [
  [/O['’`]/g, 'Ў'], [/o['’`]/g, 'ў'],
  [/G['’`]/g, 'Ғ'], [/g['’`]/g, 'ғ'],
  [/Sh/g, 'Ш'], [/SH/g, 'Ш'], [/sh/g, 'ш'],
  [/Ch/g, 'Ч'], [/CH/g, 'Ч'], [/ch/g, 'ч'],
  [/Yo/g, 'Ё'], [/YO/g, 'Ё'], [/yo/g, 'ё'],
  [/Yu/g, 'Ю'], [/YU/g, 'Ю'], [/yu/g, 'ю'],
  [/Ya/g, 'Я'], [/YA/g, 'Я'], [/ya/g, 'я'],
  [/Ye/g, 'Е'], [/YE/g, 'Е'], [/ye/g, 'е'],
  [/Ts/g, 'Ц'], [/ts/g, 'ц'],
]

const SINGLE: Record<string, string> = {
  A: 'А', a: 'а', B: 'Б', b: 'б', D: 'Д', d: 'д',
  E: 'Э', e: 'э', F: 'Ф', f: 'ф', G: 'Г', g: 'г',
  H: 'Ҳ', h: 'ҳ', I: 'И', i: 'и', J: 'Ж', j: 'ж',
  K: 'К', k: 'к', L: 'Л', l: 'л', M: 'М', m: 'м',
  N: 'Н', n: 'н', O: 'О', o: 'о', P: 'П', p: 'п',
  Q: 'Қ', q: 'қ', R: 'Р', r: 'р', S: 'С', s: 'с',
  T: 'Т', t: 'т', U: 'У', u: 'у', V: 'В', v: 'в',
  W: 'В', w: 'в', X: 'Х', x: 'х', Y: 'Й', y: 'й',
  Z: 'З', z: 'з', C: 'К', c: 'к',
}

function convertChunk(part: string): string {
  let t = part
  for (const [re, rep] of MULTI) t = t.replace(re, rep)
  t = t.replace(/[A-Za-z]/g, (ch) => SINGLE[ch] ?? ch)
  t = t.replace(/['’`](?=\s|$|[.,!?])/g, '')
  return t
}

/**
 * Lotin matnni kirillga o'giradi. HTML teglar (<b>, <i>, <code>, <a href=...>)
 * o'girilmaydi — matn teglar bo'yicha bo'linib, faqat ko'rinadigan qism o'giriladi.
 */
export function toCyrillic(input: string): string {
  if (!input) return input
  return input
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') && part.endsWith('>') ? part : convertChunk(part)))
    .join('')
}
