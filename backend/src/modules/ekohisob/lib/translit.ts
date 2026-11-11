// Kirill → lotin (taqqoslash uchun) — yagona manba.
// duplicateDetect.nameKey, similarEntities.nameKey va entityImport.normalizePlaceName shu yerdan oladi,
// shuning uchun "Чилонзор" va "Chilonzor" hamma joyda bir xil kalitga tushadi.

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'x',
}

/** Kirillni lotinga o'giradi (taqqoslash uchun — chiroyli o'girish shart emas). */
export function cyrToLatin(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[Ѐ-ӿ]/g, ch => CYR[ch] ?? ch)
}
