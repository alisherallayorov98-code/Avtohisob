// Soliq API mijozi (faqat server tomonida; kalit brauzerga chiqmaydi).
//
// Tashqariga faqat STIR ketadi (ochiq korxona identifikatori) — shaxsiy ma'lumot emas.
// Himoya: kesh (bir STIR qayta-qayta so'ralmasin), ketma-ket xatodan keyin qisqa tanaffus
// (Soliq tushib qolsa har so'rov 8 soniya kutib turmasin).

import { buildSoliqUrl, normalizeSoliqCompany, hasCompany, isInsecureSoliqUrl, SoliqCompany } from '../lib/soliqNormalize'

export type SoliqResult =
  | { ok: true; company: SoliqCompany }
  | { ok: false; code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'AUTH' | 'UNAVAILABLE' | 'TIMEOUT'; message: string }

const CACHE_TTL_MS = 10 * 60 * 1000
const FAIL_THRESHOLD = 3
const COOLDOWN_MS = 2 * 60 * 1000

const MAX_RESPONSE_BYTES = 256 * 1024 // Soliq javobi bundan katta bo'lsa — rad (xotirani to'ldirish hujumi)

const cache = new Map<string, { at: number; company: SoliqCompany }>()
let failures = 0
let cooldownUntil = 0

export function isSoliqConfigured(): boolean {
  return Boolean(process.env.SOLIQ_API_URL && process.env.SOLIQ_API_KEY)
}

/** Kesh'dagi (10 daqiqagacha) natija. Tashqi so'rov YO'Q — "soliqSynced" ni serverda tasdiqlash uchun. */
export function peekSoliqCache(stir: string): SoliqCompany | null {
  const hit = cache.get(stir)
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.company : null
}

if (isInsecureSoliqUrl(process.env.SOLIQ_API_URL, process.env.NODE_ENV)) {
  console.error("[Soliq] OGOHLANTIRISH: production'da SOLIQ_API_URL http:// — API kaliti ochiq yuboriladi. https ga o'zgartiring; hozircha so'rovlar RAD etiladi.")
}

/** Javob tanasini chegara bilan o'qiydi (Content-Length va haqiqiy oqim bo'yicha). */
async function readJsonLimited(res: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error('RESPONSE_TOO_LARGE')
  const reader = (res.body as any)?.getReader?.()
  if (!reader) return res.json().catch(() => null)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { try { await reader.cancel() } catch { /* ignore */ } throw new Error('RESPONSE_TOO_LARGE') }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}

export async function lookupStir(stir: string): Promise<SoliqResult> {
  if (!isSoliqConfigured()) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Soliq xizmati sozlanmagan' }
  }

  if (isInsecureSoliqUrl(process.env.SOLIQ_API_URL, process.env.NODE_ENV)) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Soliq xizmati xavfsiz sozlanmagan (https kerak)' }
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
      redirect: 'error', // yo'naltirishga ergashilmaydi (API kaliti boshqa manzilga ketib qolmasin)
    })

    if (res.status === 404) { failures = 0; return { ok: false, code: 'NOT_FOUND', message: 'Soliqda topilmadi' } }
    if (res.status === 401 || res.status === 403) {
      // Kalit xato — bu "xizmat tushdi" emas, tanaffus kerak emas; administrator tuzatadi
      console.error(`[Soliq] auth xatosi (${res.status}) — SOLIQ_API_KEY ni tekshiring`)
      return { ok: false, code: 'AUTH', message: 'Soliq xizmatiga kirish rad etildi (kalit)' }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const company = normalizeSoliqCompany(await readJsonLimited(res, MAX_RESPONSE_BYTES))
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
