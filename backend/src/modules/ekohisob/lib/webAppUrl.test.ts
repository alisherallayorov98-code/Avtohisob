import { ekoWebAppUrl, webAppTabUrl } from './webAppUrl'

describe('ekoWebAppUrl', () => {
  it('EKO_WEBAPP_URL ustun', () => {
    expect(ekoWebAppUrl({ EKO_WEBAPP_URL: 'https://a.uz/tg/eko', FRONTEND_URL: 'https://b.uz' } as any)).toBe('https://a.uz/tg/eko')
  })
  it('yo\'q bo\'lsa FRONTEND_URL + /tg/ekomap', () => {
    expect(ekoWebAppUrl({ FRONTEND_URL: 'https://b.uz' } as any)).toBe('https://b.uz/tg/ekomap')
  })
  it('FRONTEND_URL oxiridagi / olib tashlanadi', () => {
    expect(ekoWebAppUrl({ FRONTEND_URL: 'https://b.uz//' } as any)).toBe('https://b.uz/tg/ekomap')
  })
  it('http:// qabul qilinmaydi (Telegram rad etadi)', () => {
    expect(ekoWebAppUrl({ FRONTEND_URL: 'http://b.uz' } as any)).toBeNull()
    expect(ekoWebAppUrl({ EKO_WEBAPP_URL: 'http://a.uz' } as any)).toBeNull()
  })
  it('hech narsa yo\'q → null', () => {
    expect(ekoWebAppUrl({} as any)).toBeNull()
  })
})

describe('webAppTabUrl', () => {
  it('?tab= qo\'shadi', () => {
    expect(webAppTabUrl('https://b.uz/tg/ekomap', 'debtors')).toBe('https://b.uz/tg/ekomap?tab=debtors')
  })
  it('mavjud query saqlanadi, tab almashtiriladi', () => {
    expect(webAppTabUrl('https://b.uz/tg/ekomap?x=1&tab=map', 'debtors')).toBe('https://b.uz/tg/ekomap?x=1&tab=debtors')
  })
})
