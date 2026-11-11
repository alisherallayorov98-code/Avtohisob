import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import {
  isLocked, lockMinutesLeft, onLoginFailure, onLoginSuccess, MAX_FAILED_LOGINS, LOCK_MS,
} from './loginLock'
import {
  generateLinkTokenValue, LINK_TOKEN_ALPHABET, LINK_TOKEN_LENGTH, LINK_TOKEN_TTL_MS, computeLinkExpiry,
  checkLinkTokenRow, maskLinkToken, isWellFormedLinkToken,
} from './linkToken'
import { ekoSecret, signEkoJwt, verifyEkoJwt, tokenVersionMatches } from './ekoJwt'
import { validatePassword } from './passwordPolicy'
import { MemCounter } from './memLimiter'
import { verifyTelegramWebApp, TG_AUTH_MAX_AGE_SEC } from './tgInitData'
import { isInsecureSoliqUrl } from './soliqNormalize'

describe('loginLock — 5 xato → 15 daqiqa qulf', () => {
  const t0 = new Date('2026-11-10T10:00:00Z')

  it('4 ta xato qulflamaydi, 5-chisi qulflaydi va hisoblagichni nolga tushiradi', () => {
    let st = { failedLogins: 0, lockedUntil: null as Date | null }
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      const n = onLoginFailure(st, t0)
      expect(n.justLocked).toBe(false)
      expect(n.failedLogins).toBe(i)
      st = { failedLogins: n.failedLogins, lockedUntil: n.lockedUntil }
    }
    const last = onLoginFailure(st, t0)
    expect(last.justLocked).toBe(true)
    expect(last.failedLogins).toBe(0)
    expect(last.lockedUntil!.getTime()).toBe(t0.getTime() + LOCK_MS)
  })

  it('qulf muddati davomida isLocked, keyin yo\'q', () => {
    const until = new Date(t0.getTime() + LOCK_MS)
    expect(isLocked(until, t0)).toBe(true)
    expect(isLocked(until, new Date(t0.getTime() + LOCK_MS - 1))).toBe(true)
    expect(isLocked(until, new Date(t0.getTime() + LOCK_MS))).toBe(false)
    expect(isLocked(null, t0)).toBe(false)
  })

  it('lockMinutesLeft yuqoriga yaxlitlanadi', () => {
    const until = new Date(t0.getTime() + 61_000)
    expect(lockMinutesLeft(until, t0)).toBe(2)
    expect(lockMinutesLeft(null, t0)).toBe(0)
  })

  it('muddati o\'tgan qulfdan keyingi xato yangi sikl boshlaydi (1 dan)', () => {
    const expired = new Date(t0.getTime() - 1000)
    const n = onLoginFailure({ failedLogins: 4, lockedUntil: expired }, t0)
    expect(n.failedLogins).toBe(1)
    expect(n.justLocked).toBe(false)
  })

  it('muvaffaqiyatda nolga tushadi', () => {
    expect(onLoginSuccess()).toEqual({ failedLogins: 0, lockedUntil: null })
  })
})

describe('linkToken — bot ulash tokeni', () => {
  it('alifbo aniq 32 belgi, uzunlik 12, faqat alifbodan', () => {
    expect(LINK_TOKEN_ALPHABET.length).toBe(32)
    expect(new Set(LINK_TOKEN_ALPHABET).size).toBe(32)
    const t = generateLinkTokenValue()
    expect(t).toHaveLength(LINK_TOKEN_LENGTH)
    expect(LINK_TOKEN_LENGTH).toBeGreaterThanOrEqual(10)
    for (const ch of t) expect(LINK_TOKEN_ALPHABET).toContain(ch)
  })

  it('har safar boshqa (kollizya yo\'q) va katta harf (bot toUpperCase qiladi)', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateLinkTokenValue()))
    expect(set.size).toBe(500)
    for (const t of set) expect(t).toBe(t.toUpperCase())
  })

  it('ikkilik tarqalish: tasodifiy baytlar manbasi almashtirilganda ham to\'g\'ri (bias bo\'lmaydi)', () => {
    // 255 (>= limit emas, 256%32==0) ham qabul qilinadi
    const t = generateLinkTokenValue(n => Buffer.alloc(n, 255))
    expect(t).toBe(LINK_TOKEN_ALPHABET[255 % 32].repeat(LINK_TOKEN_LENGTH))
  })

  it('muddat 48 soat (eski 30 kun emas)', () => {
    const now = new Date('2026-11-10T00:00:00Z')
    expect(computeLinkExpiry(now).getTime() - now.getTime()).toBe(LINK_TOKEN_TTL_MS)
    expect(LINK_TOKEN_TTL_MS).toBe(48 * 3600 * 1000)
  })

  it('checkLinkTokenRow: ok / expired / used', () => {
    const now = new Date('2026-11-10T00:00:00Z')
    const future = new Date(now.getTime() + 1000)
    const past = new Date(now.getTime() - 1000)
    expect(checkLinkTokenRow({ expiresAt: future, used: false }, now)).toBe('ok')
    expect(checkLinkTokenRow({ expiresAt: past, used: false }, now)).toBe('expired')
    expect(checkLinkTokenRow({ expiresAt: future, used: true }, now)).toBe('used')
    expect(checkLinkTokenRow({ expiresAt: past, used: true }, now)).toBe('expired')
  })

  it('maskLinkToken ochiq matnni yashiradi', () => {
    const m = maskLinkToken('ABCDEFGH2345')!
    expect(m.startsWith('AB')).toBe(true)
    expect(m.endsWith('45')).toBe(true)
    expect(m).not.toContain('CDEFGH23')
    expect(maskLinkToken(null)).toBeNull()
  })

  it('isWellFormedLinkToken: eski 6 belgili va yangi; begona belgilar rad', () => {
    expect(isWellFormedLinkToken('a1b2c3')).toBe(true)
    expect(isWellFormedLinkToken('ABCDEFGH2345')).toBe(true)
    expect(isWellFormedLinkToken('AB CD')).toBe(false)
    expect(isWellFormedLinkToken("A'; DROP")).toBe(false)
    expect(isWellFormedLinkToken(123 as any)).toBe(false)
  })
})

describe('ekoJwt', () => {
  const prev = { e: process.env.EKO_JWT_SECRET, j: process.env.JWT_SECRET }
  beforeEach(() => { delete process.env.EKO_JWT_SECRET; process.env.JWT_SECRET = 'main-secret-for-tests' })
  afterAll(() => {
    if (prev.e === undefined) delete process.env.EKO_JWT_SECRET; else process.env.EKO_JWT_SECRET = prev.e
    if (prev.j === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prev.j
  })

  const claims = { id: 'u1', email: 'a@b.c', role: 'admin', orgId: 'o1', districtIds: ['d1'], tv: 3 }

  it('EKO_JWT_SECRET bo\'lmasa JWT_SECRET ga qaytadi, bo\'lsa o\'shani ishlatadi', () => {
    expect(ekoSecret()).toBe('main-secret-for-tests')
    process.env.EKO_JWT_SECRET = 'eko-only'
    expect(ekoSecret()).toBe('eko-only')
  })

  it('imzolangan token tekshiriladi va tv saqlanadi', () => {
    const d = verifyEkoJwt(signEkoJwt(claims))
    expect(d).toMatchObject({ id: 'u1', tv: 3, eko: true })
  })

  it('alohida sir o\'rnatilsa, asosiy sir bilan imzolangan eko-token rad etiladi', () => {
    const old = jwt.sign({ ...claims, eko: true }, 'main-secret-for-tests', { algorithm: 'HS256' })
    process.env.EKO_JWT_SECRET = 'eko-only'
    expect(verifyEkoJwt(old)).toBeNull()
  })

  it('alg=none va HS512 tokenlar rad etiladi', () => {
    const none = jwt.sign({ ...claims, eko: true }, '', { algorithm: 'none' } as any)
    expect(verifyEkoJwt(none)).toBeNull()
    const hs512 = jwt.sign({ ...claims, eko: true }, 'main-secret-for-tests', { algorithm: 'HS512' })
    expect(verifyEkoJwt(hs512)).toBeNull()
  })

  it('eko: true bo\'lmagan token eko sifatida qabul qilinmaydi', () => {
    const t = jwt.sign({ id: 'x', role: 'admin' }, 'main-secret-for-tests', { algorithm: 'HS256' })
    expect(verifyEkoJwt(t)).toBeNull()
  })

  it('tokenVersionMatches: eski tokenda tv yo\'q → 0', () => {
    expect(tokenVersionMatches(undefined, 0)).toBe(true)
    expect(tokenVersionMatches(undefined, 1)).toBe(false)
    expect(tokenVersionMatches(2, 2)).toBe(true)
    expect(tokenVersionMatches(2, 3)).toBe(false)
    expect(tokenVersionMatches('2', 2)).toBe(false)
  })
})

describe('passwordPolicy', () => {
  it('kamida 8 belgi', () => {
    expect(validatePassword('1234567')).not.toBeNull()
    expect(validatePassword('12345678')).toBeNull()
  })
  it('matn bo\'lmasa / faqat bo\'sh joy / juda uzun rad', () => {
    expect(validatePassword(undefined)).not.toBeNull()
    expect(validatePassword({} as any)).not.toBeNull()
    expect(validatePassword('        ')).not.toBeNull()
    expect(validatePassword('a'.repeat(129))).not.toBeNull()
  })
})

describe('MemCounter', () => {
  it('oyna ichida max dan keyin bloklaydi, oyna tugagach tiklanadi', () => {
    const c = new MemCounter({ windowMs: 1000, max: 3 })
    expect(c.hit('k', 0)).toBe(true)
    expect(c.hit('k', 1)).toBe(true)
    expect(c.hit('k', 2)).toBe(true)
    expect(c.hit('k', 3)).toBe(false)
    expect(c.isBlocked('k', 3)).toBe(true)
    expect(c.hit('other', 3)).toBe(true)
    expect(c.hit('k', 1001)).toBe(true)
    c.reset('k')
    expect(c.isBlocked('k', 1002)).toBe(false)
  })
})

describe('verifyTelegramWebApp', () => {
  const botToken = '123456:TEST-TOKEN'
  const now = 1_800_000_000
  function build(params: Record<string, string>, token = botToken): string {
    const p = new URLSearchParams(params)
    const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n')
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
    p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'))
    return p.toString()
  }
  const user = JSON.stringify({ id: 42, first_name: 'T' })

  it('to\'g\'ri imzo va yangi auth_date qabul qilinadi', () => {
    const r = verifyTelegramWebApp(build({ auth_date: String(now - 60), user }), botToken, now)
    expect(r).toMatchObject({ id: 42 })
  })
  it('noto\'g\'ri imzo rad', () => {
    expect(verifyTelegramWebApp(build({ auth_date: String(now), user }, 'other:token'), botToken, now)).toBeNull()
    expect(verifyTelegramWebApp('hash=zzzz&auth_date=1', botToken, now)).toBeNull()
  })
  it('2 soatdan eski auth_date rad, 2 soat ichida qabul (oyna 24 soatdan qisqartirilgan)', () => {
    expect(TG_AUTH_MAX_AGE_SEC).toBeLessThanOrEqual(2 * 3600)
    expect(verifyTelegramWebApp(build({ auth_date: String(now - TG_AUTH_MAX_AGE_SEC - 5), user }), botToken, now)).toBeNull()
    expect(verifyTelegramWebApp(build({ auth_date: String(now - TG_AUTH_MAX_AGE_SEC + 5), user }), botToken, now)).not.toBeNull()
  })
  it('kelajakdagi auth_date rad', () => {
    expect(verifyTelegramWebApp(build({ auth_date: String(now + 3600), user }), botToken, now)).toBeNull()
  })
})

describe('isInsecureSoliqUrl', () => {
  it('faqat production + http:// da xavfsiz emas', () => {
    expect(isInsecureSoliqUrl('http://api.soliq.uz/x', 'production')).toBe(true)
    expect(isInsecureSoliqUrl('https://api.soliq.uz/x', 'production')).toBe(false)
    expect(isInsecureSoliqUrl('http://localhost:9000', 'development')).toBe(false)
    expect(isInsecureSoliqUrl(undefined, 'production')).toBe(false)
  })
})
