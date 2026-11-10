// Hujjat raqami (TRF-2026-0001, REQ-2026-0001): butun bazada noyob va poyga holatiga chidamli.
// Avval raqam tashkilot ichida sanalardi, noyoblik esa butun bazada edi — ikkinchi tashkilotda urilib qolardi.

/** Oxirgi raqamdan keyingisini beradi. last = "TRF-2026-0271" → "TRF-2026-0272" */
export function nextDocNumber(prefix: string, last: string | null | undefined): string {
  const m = last ? /(\d+)$/.exec(last) : null
  const n = m ? parseInt(m[1], 10) + 1 : 1
  return `${prefix}-${String(n).padStart(4, '0')}`
}

const isUniqueViolation = (e: any) => e?.code === 'P2002'

/**
 * Raqam olib yaratadi; noyoblik buzilsa (boshqa so'rov tezroq oldi) yangi raqam bilan qayta urinadi.
 */
export async function withUniqueDocNumber<T>(
  prefix: string,
  getLast: () => Promise<string | null | undefined>,
  create: (documentNumber: string) => Promise<T>,
  tries = 6,
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    const num = nextDocNumber(prefix, await getLast())
    try {
      return await create(num)
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      lastErr = e
    }
  }
  throw lastErr
}
