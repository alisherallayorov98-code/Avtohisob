import { validateLatLon, parseMoneyInt, parsePageParams, cleanText, isEntityStatusFilter, safeCell, MAX_FEE } from './ekoValidate'
import { maskDuplicateForUser } from './dupMask'

describe('validateLatLon', () => {
  it('to\'g\'ri koordinata (raqam va matn)', () => {
    expect(validateLatLon(41.31, 69.24)).toEqual({ ok: true, value: { lat: 41.31, lon: 69.24 } })
    expect(validateLatLon('41,31', '69.24')).toEqual({ ok: true, value: { lat: 41.31, lon: 69.24 } })
  })
  it('NaN, bo\'sh, diapazondan tashqari, (0,0) rad', () => {
    expect(validateLatLon('abc', 1).ok).toBe(false)
    expect(validateLatLon('', '').ok).toBe(false)
    expect(validateLatLon(null, null).ok).toBe(false)
    expect(validateLatLon(91, 10).ok).toBe(false)
    expect(validateLatLon(10, 181).ok).toBe(false)
    expect(validateLatLon(0, 0).ok).toBe(false)
    expect(validateLatLon(Infinity, 1).ok).toBe(false)
  })
})

describe('parseMoneyInt', () => {
  it('butun, 0..1e9', () => {
    expect(parseMoneyInt(450000)).toEqual({ ok: true, value: 450000 })
    expect(parseMoneyInt('450000')).toEqual({ ok: true, value: 450000 })
    expect(parseMoneyInt(undefined)).toEqual({ ok: true, value: 0 })
    expect(parseMoneyInt('')).toEqual({ ok: true, value: 0 })
    expect(parseMoneyInt(MAX_FEE)).toEqual({ ok: true, value: MAX_FEE })
  })
  it('NaN, kasr, manfiy, juda katta rad', () => {
    expect(parseMoneyInt('abc').ok).toBe(false)
    expect(parseMoneyInt(NaN).ok).toBe(false)
    expect(parseMoneyInt(10.5).ok).toBe(false)
    expect(parseMoneyInt(-1).ok).toBe(false)
    expect(parseMoneyInt(MAX_FEE + 1).ok).toBe(false)
    expect(parseMoneyInt({}).ok).toBe(false)
  })
})

describe('parsePageParams', () => {
  it('NaN va manfiy himoya, limit chegarasi', () => {
    expect(parsePageParams('abc', 'xyz')).toEqual({ page: 1, limit: 50, skip: 0 })
    expect(parsePageParams('-5', '-1')).toEqual({ page: 1, limit: 50, skip: 0 })
    expect(parsePageParams('3', '1000')).toEqual({ page: 3, limit: 200, skip: 400 })
    expect(parsePageParams(undefined, undefined, { defaultLimit: 30, maxLimit: 100 })).toEqual({ page: 1, limit: 30, skip: 0 })
  })
})

describe('cleanText / status / safeCell', () => {
  it('cleanText uzunlik va trim', () => {
    expect(cleanText('  salom ', 10, 'X')).toEqual({ ok: true, value: 'salom' })
    expect(cleanText('   ', 10, 'X')).toEqual({ ok: true, value: null })
    expect(cleanText(undefined, 10, 'X')).toEqual({ ok: true, value: null })
    expect(cleanText('a'.repeat(11), 10, 'X').ok).toBe(false)
    expect(cleanText({}, 10, 'X').ok).toBe(false)
  })
  it('status filtri whitelist (deleted va ixtiyoriy matn rad)', () => {
    expect(isEntityStatusFilter('active')).toBe(true)
    expect(isEntityStatusFilter('deleted')).toBe(false)
    expect(isEntityStatusFilter('x')).toBe(false)
    expect(isEntityStatusFilter(['active'])).toBe(false)
  })
  it('safeCell formula in\'ektsiyasini zararsizlantiradi', () => {
    expect(safeCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(safeCell('+998')).toBe("'+998")
    expect(safeCell('@x')).toBe("'@x")
    expect(safeCell('Oq Yo\'l')).toBe('Oq Yo\'l')
    expect(safeCell(5)).toBe(5)
  })
})

describe('maskDuplicateForUser — tuman doirasi', () => {
  const admin = { role: 'admin', orgId: 'o1', districtIds: [] }
  const insp = { role: 'inspector', orgId: 'o1', districtIds: ['d1'] }
  it('admin va o\'z tumani — nom ko\'rinadi; boshqa tuman — yashiriladi', () => {
    const own = { id: 'e1', name: 'Oq Yo\'l', status: 'active', orgId: 'o1', districtId: 'd1' }
    const other = { id: 'e2', name: 'Maxfiy', status: 'active', orgId: 'o1', districtId: 'd2' }
    expect(maskDuplicateForUser(admin, other).name).toBe('Maxfiy')
    expect(maskDuplicateForUser(insp, own).name).toBe('Oq Yo\'l')
    const m = maskDuplicateForUser(insp, other)
    expect(m.name).not.toBe('Maxfiy')
    expect(m.restricted).toBe(true)
    expect(m.id).toBe('e2')
  })
})
