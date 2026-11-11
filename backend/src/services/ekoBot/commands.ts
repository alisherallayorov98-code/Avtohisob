// Matn buyruqlari va pastki tugma yorliqlarini yagona ID ga keltirish (pure).
// Eski (emojili) yorliqlar ham taniladi — foydalanuvchi telefonida eski klaviatura qolgan bo'lishi mumkin.

export type CommandId = 'help' | 'lang' | 'today' | 'report' | 'district' | 'plan' | 'search' | 'cancel' | 'menu'

const TABLE: Record<string, CommandId> = {
  yordam: 'help', til: 'lang', 'til / тил': 'lang',
  bugun: 'today', 'bugungi royxat': 'today',
  hisobotim: 'report', 'mening hisobotim': 'report',
  tumanim: 'district', 'mening tumanim': 'district',
  plan: 'plan', 'plan berish': 'plan',
  qidirish: 'search', 'tashkilot qidirish': 'search',
  bekor: 'cancel', 'bekor qilish': 'cancel',
  menyu: 'menu',
}

export function normalizeLabel(text: string): string {
  return text
    .replace(/[’‘ʻʼ`´']/g, '')
    .replace(/^[^\p{L}\p{N}/]+/u, '')
    .replace(/@\w+$/, '')
    .replace(/^\//, '')
    .trim()
    .toLowerCase()
}

export function matchCommand(text: string | undefined | null): CommandId | null {
  if (!text) return null
  const t = text.trim()
  if (t.length > 40) return null
  return TABLE[normalizeLabel(t)] ?? null
}
