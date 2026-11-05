import { buildSoliqUrl, cleanStir, isValidStir, normalizeSoliqCompany, hasCompany } from './soliqNormalize'

describe('STIR tekshiruvi', () => {
  it('bo\'shliq va chiziqchalarni olib tashlaydi', () => {
    expect(cleanStir(' 201 234-567 ')).toBe('201234567')
  })
  it('faqat 9 xonali raqam to\'g\'ri', () => {
    expect(isValidStir('201234567')).toBe(true)
    expect(isValidStir('20123456')).toBe(false)
    expect(isValidStir('2012345678')).toBe(false)
    expect(isValidStir('')).toBe(false)
    expect(isValidStir(null)).toBe(false)
  })
})

describe('buildSoliqUrl', () => {
  it('%s o\'rniga STIR qo\'yadi va type=full qo\'shadi', () => {
    expect(buildSoliqUrl('https://x.uz/info/%s', '201234567')).toBe('https://x.uz/info/201234567?type=full')
  })
  it('URL-kodlangan %25s ham ishlaydi (.env da shunday yozilgan)', () => {
    expect(buildSoliqUrl('http://h/remote-access-api/company/info/%25s', '201234567'))
      .toBe('http://h/remote-access-api/company/info/201234567?type=full')
  })
  it('{stir} ham ishlaydi', () => {
    expect(buildSoliqUrl('https://x.uz/{stir}/info', '201234567')).toBe('https://x.uz/201234567/info?type=full')
  })
  it('belgi yo\'q bo\'lsa oxiriga qo\'shadi', () => {
    expect(buildSoliqUrl('https://x.uz/info/', '201234567')).toBe('https://x.uz/info/201234567?type=full')
  })
  it('mavjud query bo\'lsa & bilan davom etadi', () => {
    expect(buildSoliqUrl('https://x.uz/info/%s?lang=uz', '201234567')).toBe('https://x.uz/info/201234567?lang=uz&type=full')
  })
  it('noto\'g\'ri STIR URLga o\'tkazilmaydi (injection yo\'q)', () => {
    expect(() => buildSoliqUrl('https://x.uz/%s', '../../etc')).toThrow('INVALID_STIR')
    expect(() => buildSoliqUrl('https://x.uz/%s', '123')).toThrow('INVALID_STIR')
  })
})

describe('normalizeSoliqCompany', () => {
  const raw = {
    company: {
      tin: 201234567, name: 'OQ YO\'L SAVDO MAS\'ULIYATI CHEKLANGAN JAMIYATI', shortName: '"OQ YO\'L" MChJ',
      phone: '998901234567', statusDetail: { group: 'ACTIVE', name_uz_latn: 'Faol' },
      businessFund: 1000000, vatNumber: '123',
    },
    director: { lastName: 'Karimov', firstName: 'Aziz', middleName: 'Bahodir o\'g\'li', tin: '12345678901234' },
    accountant: { lastName: 'X' },
    companyBillingAddress: {
      region: { name_uz_latn: 'Toshkent shahri' }, district: { name: 'Chilonzor' }, streetName: 'Bunyodkor 5',
    },
  }

  it('kerakli maydonlarni oladi', () => {
    const c = normalizeSoliqCompany(raw)
    expect(c.stir).toBe('201234567')
    expect(c.name).toBe('"OQ YO\'L" MChJ')
    expect(c.fullName).toContain('CHEKLANGAN')
    expect(c.address).toBe('Toshkent shahri, Chilonzor, Bunyodkor 5')
    expect(c.directorName).toBe('Karimov Aziz Bahodir o\'g\'li')
    expect(c.phone).toBe('998901234567')
    expect(c.status).toBe('active')
  })

  it('shaxsiy/ortiqcha maydonlar (JShShIR, kapital, QQS) natijaga kirmaydi', () => {
    const json = JSON.stringify(normalizeSoliqCompany(raw))
    expect(json).not.toContain('12345678901234')
    expect(json).not.toContain('1000000')
    expect(json).not.toContain('vat')
  })

  it('tugatilgan korxona inactive', () => {
    const c = normalizeSoliqCompany({ company: { tin: '1', statusDetail: { group: 'LIQUIDATED' } } })
    expect(c.status).toBe('inactive')
  })

  it('shortName yo\'q bo\'lsa to\'liq nomdan foydalanadi', () => {
    expect(normalizeSoliqCompany({ company: { name: 'Falon MChJ' } }).name).toBe('Falon MChJ')
  })

  it('kutilmagan shakl xato bermaydi va "topilmadi" deb tan olinadi', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { company: null }]) {
      const c = normalizeSoliqCompany(bad)
      expect(hasCompany(c)).toBe(false)
    }
  })
})
