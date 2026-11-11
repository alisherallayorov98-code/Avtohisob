// EkoHisob JWT — imzolash/tekshirish YAGONA joyda.
//
// - Algoritm qat'iy HS256 (alg=none / boshqa algoritmga almashtirish hujumlaridan himoya).
// - Alohida sir: EKO_JWT_SECRET. O'rnatilmagan bo'lsa JWT_SECRET ga qaytadi (orqaga moslik).
//   EKO_JWT_SECRET ni birinchi marta o'rnatganda eski eko-tokenlar yaroqsiz bo'ladi (qayta kirish kerak).

import jwt from 'jsonwebtoken'

export const EKO_TOKEN_TTL = '8h'

export function ekoSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.EKO_JWT_SECRET || env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET sozlanmagan')
  return s
}

export interface EkoTokenClaims {
  id: string
  email: string
  role: string
  orgId: string
  districtIds: string[]
  /** tokenVersion — parol reset / deaktivatsiya / rol / tuman / bot uzishda oshadi */
  tv: number
  /** 'tg' — Telegram Mini App orqali (parol bilan kirmagan; mustChangePassword unga qo'llanmaydi) */
  src?: 'tg'
}

export function signEkoJwt(claims: EkoTokenClaims): string {
  return jwt.sign({ ...claims, eko: true }, ekoSecret(), { expiresIn: EKO_TOKEN_TTL, algorithm: 'HS256' })
}

/** Eko-token (eko: true). Yaroqsiz bo'lsa null. */
export function verifyEkoJwt(token: string): any | null {
  try {
    const d = jwt.verify(token, ekoSecret(), { algorithms: ['HS256'] }) as any
    return d && d.eko === true ? d : null
  } catch {
    return null
  }
}

/** Asosiy AutoHisob tokeni (eko emas). */
export function verifyMainJwt(token: string): any | null {
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any
    return d && d.eko !== true ? d : null
  } catch {
    return null
  }
}

/** Token tokenVersion bilan mos kelishi. Eski tokenlarda `tv` yo'q → 0 deb olinadi (DB standarti ham 0). */
export function tokenVersionMatches(claimTv: unknown, dbTv: number): boolean {
  const tv = typeof claimTv === 'number' && Number.isInteger(claimTv) ? claimTv : 0
  return tv === dbTv
}
