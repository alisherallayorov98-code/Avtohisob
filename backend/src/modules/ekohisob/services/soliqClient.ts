// Soliq API mijozi (faqat server tomonida; kalit brauzerga chiqmaydi).
//
// Tashqariga faqat STIR ketadi (ochiq korxona identifikatori) — shaxsiy ma'lumot emas.
// Himoya: kesh (bir STIR qayta-qayta so'ralmasin), ketma-ket xatodan keyin qisqa tanaffus
// (Soliq tushib qolsa har so'rov 8 soniya kutib turmasin).

import { buildSoliqUrl, normalizeSoliqCompany, hasCompany, SoliqCompany } from '../lib/soliqNormalize'

export type SoliqResult =
  | { ok: true; company: SoliqCompany }
  | { ok: false; code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'AUTH' | 'UNAVAILABLE' | 'TIMEOUT'; message: string }

const CACHE_TTL_MS = 10 * 60 * 1000
const FAIL_THRESHOLD = 3
const COOLDOWN_MS = 2 * 60 * 1000

const cache = new Map<string, { at: number; company: SoliqCompany }>()
let failures = 0
let cooldownUntil = 0

export function isSoliqConfigured(): boolean {
  return Boolean(process.env.SOLIQ_API_URL && process.env.SOLIQ_API_KEY)
}

export async function lookupStir(stir: string): Promise<SoliqResult> {
  if (!isSoliqConfigured()) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Soliq xizmati sozlanmagan' }
  }

  const hit = cache.get(stir)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, company: hit.company }

  if (Date.now() < cooldownUntil) {
    return { ok: false, code: 'UNAVAILABLE', message: 'Soliq xizmati vaqtincha mavjud emas — keyinroq urining' }
  }

  const timeout = Math.max(1000, Number(process.env.SOLIQ_API_TIMEOUT_MS) || 8000)
  try {
    const res = await fetch(buildSoliqUrl(process.env.SOLIQ_API_URL!, stir), {
      headers: { 'X-API-KEY': process.env.SOLIQ_API_KEY!, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
    })

    if (res.status === 404) { failures = 0; return { ok: false, code: 'NOT_FOUND', message: 'Soliqda topilmadi' } }
    if (res.status === 401 || res.status === 403) {
      // Kalit xato — bu "xizmat tushdi" emas, tanaffus kerak emas; administrator tuzatadi
      console.error(`[Soliq] auth xatosi (${res.status}) — SOLIQ_API_KEY ni tekshiring`)
      return { ok: false, code: 'AUTH', message: 'Soliq xizmatiga kirish rad etildi (kalit)' }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const company = normalizeSoliqCompany(await res.json().catch(() => null))
    failures = 0
    if (!hasCompany(company)) return { ok: false, code: 'NOT_FOUND', message: 'Soliqda topilmadi' }

    cache.set(stir, { at: Date.now(), company })
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string)
    return { ok: true, company }
  } catch (e: any) {
    failures++
    if (failures >= FAIL_THRESHOLD) cooldownUntil = Date.now() + COOLDOWN_MS
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    console.error(`[Soliq] so'rov xatosi (${failures}/${FAIL_THRESHOLD}):`, e?.message ?? e)
    return timedOut
      ? { ok: false, code: 'TIMEOUT', message: 'Soliq xizmati javob bermadi' }
      : { ok: false, code: 'UNAVAILABLE', message: 'Soliq xizmatiga ulanib bo\'lmadi' }
  }
}
