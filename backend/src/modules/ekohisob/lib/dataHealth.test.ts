import {
  classifyEntity, summarizeHealth, hasUsablePhone, sortIssueCodes, ISSUE_META,
} from './dataHealth'

const OK = {
  status: 'active', phone: '901234567', lat: 41.3, lon: 69.2,
  billingMode: 'monthly_fixed', monthlyFee: 450000, cubicPrice: 0,
  mahallId: 'm1', stir: '123456789',
}

describe('hasUsablePhone', () => {
  it('9 va 12 xonali O\'zbekiston raqamlari yaroqli', () => {
    expect(hasUsablePhone('901234567')).toBe(true)
    expect(hasUsablePhone('998901234567')).toBe(true)
    expect(hasUsablePhone('+998 90 123 45 67')).toBe(true)
  })
  it('bo\'sh yoki noto\'g\'ri raqam yaroqsiz', () => {
    expect(hasUsablePhone(null)).toBe(false)
    expect(hasUsablePhone('')).toBe(false)
    expect(hasUsablePhone('123')).toBe(false)
  })
})

describe('classifyEntity', () => {
  it('to\'liq ma\'lumotli tashkilotda muammo yo\'q', () => {
    expect(classifyEntity(OK)).toEqual([])
  })

  it('belgilangan oylik, lekin summa 0 → hisob yozilmaydi', () => {
    expect(classifyEntity({ ...OK, monthlyFee: 0 })).toContain('fixed_no_fee')
  })

  it('talon rejimi, lekin kub narxi 0 → talon qo\'shib bo\'lmaydi', () => {
    const r = classifyEntity({ ...OK, billingMode: 'talon', monthlyFee: 0, cubicPrice: 0 })
    expect(r).toContain('talon_no_price')
    // Talon rejimida monthlyFee 0 bo'lishi NORMAL — bu muammo emas
    expect(r).not.toContain('fixed_no_fee')
  })

  it('telefon va koordinata yo\'qligi aniqlanadi', () => {
    const r = classifyEntity({ ...OK, phone: null, lat: null, lon: null })
    expect(r).toEqual(expect.arrayContaining(['no_phone', 'no_coords']))
  })

  it('mahalla va STIR yo\'qligi past darajali muammo', () => {
    const r = classifyEntity({ ...OK, mahallId: null, stir: '  ' })
    expect(r).toEqual(expect.arrayContaining(['no_mahalla', 'no_stir']))
  })

  it('chala (draft) holati alohida belgilanadi', () => {
    expect(classifyEntity({ ...OK, status: 'draft' })).toContain('draft')
  })

  it('nofaol va qora ro\'yxatdagilar TEKSHIRILMAYDI (shovqin bo\'lmasin)', () => {
    expect(classifyEntity({ ...OK, status: 'inactive', phone: null })).toEqual([])
    expect(classifyEntity({ ...OK, status: 'blacklisted', phone: null })).toEqual([])
  })

  it('natija jiddiylik bo\'yicha tartiblangan', () => {
    const r = classifyEntity({ ...OK, monthlyFee: 0, phone: null, stir: null, mahallId: null })
    // high (fixed_no_fee, no_phone) → low (no_mahalla, no_stir)
    expect(ISSUE_META[r[0]].severity).toBe('high')
    expect(ISSUE_META[r[r.length - 1]].severity).toBe('low')
  })
})

describe('sortIssueCodes', () => {
  it('avval eng jiddiysi', () => {
    expect(sortIssueCodes(['no_stir', 'no_phone', 'no_coords'])[0]).toBe('no_phone')
  })
})

describe('summarizeHealth', () => {
  it('guruhlar bo\'yicha soni va toza tashkilotlar', () => {
    const r = summarizeHealth([
      OK,
      { ...OK, phone: null },
      { ...OK, phone: null, monthlyFee: 0 },
      { ...OK, status: 'inactive', phone: null },   // tekshirilmaydi
    ])
    expect(r.checked).toBe(3)
    expect(r.clean).toBe(1)
    const byCode = Object.fromEntries(r.groups.map(g => [g.code, g.count]))
    expect(byCode.no_phone).toBe(2)
    expect(byCode.fixed_no_fee).toBe(1)
  })

  it('muammosiz ro\'yxatda guruhlar bo\'sh', () => {
    const r = summarizeHealth([OK, OK])
    expect(r).toMatchObject({ checked: 2, clean: 2 })
    expect(r.groups).toEqual([])
  })

  it('guruhlar jiddiylik bo\'yicha tartiblangan', () => {
    const r = summarizeHealth([{ ...OK, stir: null, phone: null }])
    expect(r.groups[0].severity).toBe('high')
  })
})
