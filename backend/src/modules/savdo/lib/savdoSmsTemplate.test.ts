import {
  DEFAULT_SMS_TEMPLATE,
  SMS_PLACEHOLDERS,
  renderSmsTemplate,
  smsSegments,
  isUnicodeSms,
  estimateSmsCost,
  normalizePhone,
} from './savdoSmsTemplate'

describe('renderSmsTemplate', () => {
  it('barcha o\'rin egalarini almashtiradi', () => {
    const text = renderSmsTemplate('{mijoz} / {korxona} / {telefon} / {qarz}', {
      mijoz: 'Alisher', qarz: 5000, korxona: 'Namuna MChJ', telefon: '901234567',
    })
    expect(text).toBe('Alisher / Namuna MChJ / 901234567 / 5 000')
  })

  it('qarzni "1 250 000" ko\'rinishida formatlaydi', () => {
    const text = renderSmsTemplate('{qarz}', { mijoz: 'X', qarz: 1250000 })
    expect(text).toBe('1 250 000')
  })

  it('kasr qarzni butunlaydi', () => {
    const text = renderSmsTemplate('{qarz}', { mijoz: 'X', qarz: 12345.67 })
    expect(text).toBe('12 346')
  })

  it('noma\'lum o\'rin egasi o\'z holicha qoladi', () => {
    const text = renderSmsTemplate('{mijoz} {nomalum}', { mijoz: 'Alisher', qarz: 0 })
    expect(text).toBe('Alisher {nomalum}')
  })

  it('korxona bo\'sh bo\'lsa bo\'sh satr qo\'yiladi va ortiqcha probel qolmaydi', () => {
    const text = renderSmsTemplate('Hurmatli {mijoz}! {korxona} qarzingiz bor', {
      mijoz: 'Alisher', qarz: 0, korxona: null,
    })
    expect(text).toBe('Hurmatli Alisher! qarzingiz bor')
  })

  it('sana berilsa dd.mm.yyyy ko\'rinishida chiqadi', () => {
    const text = renderSmsTemplate('{sana}', {
      mijoz: 'X', qarz: 0, sana: new Date(2026, 7, 5),
    })
    expect(text).toBe('05.08.2026')
  })

  it('shablon bo\'sh bo\'lsa standart shablon ishlatiladi', () => {
    const text = renderSmsTemplate('   ', { mijoz: 'Alisher', qarz: 1000, korxona: 'A', telefon: '99' })
    expect(text).toContain('Alisher')
    expect(text).toContain('1 000')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{qarz}')
  })

  it('o\'rin egalari ro\'yxatida barcha kalitlar bor', () => {
    expect(SMS_PLACEHOLDERS.map(p => p.key).sort())
      .toEqual(['korxona', 'mijoz', 'qarz', 'sana', 'telefon'])
  })
})

describe('smsSegments', () => {
  it('bo\'sh matn 0 segment', () => {
    expect(smsSegments('')).toBe(0)
  })

  it('GSM-7 160 belgi — 1 segment', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1)
  })

  it('GSM-7 161 belgi — 2 segment (153 bo\'yicha bo\'linadi)', () => {
    expect(smsSegments('a'.repeat(161))).toBe(2)
  })

  it('GSM-7 306 belgi — 2, 307 belgi — 3 segment', () => {
    expect(smsSegments('a'.repeat(306))).toBe(2)
    expect(smsSegments('a'.repeat(307))).toBe(3)
  })

  it('kirill matn unicode — 70 belgi 1, 71 belgi 2 segment', () => {
    expect(isUnicodeSms('Привет')).toBe(true)
    expect(smsSegments('п'.repeat(70))).toBe(1)
    expect(smsSegments('п'.repeat(71))).toBe(2)
  })

  it('lotin matn unicode emas', () => {
    expect(isUnicodeSms('Hurmatli mijoz! Qarzingiz 1 000 som.')).toBe(false)
  })
})

describe('estimateSmsCost', () => {
  it('segment × qabul qiluvchi × narx', () => {
    expect(estimateSmsCost('a'.repeat(100), 10)).toBe(1 * 10 * 55)
    expect(estimateSmsCost('a'.repeat(200), 10)).toBe(2 * 10 * 55)
  })

  it('segment narxini o\'zgartirsa bo\'ladi, qabul qiluvchi 0 bo\'lsa 0', () => {
    expect(estimateSmsCost('a'.repeat(100), 4, 100)).toBe(400)
    expect(estimateSmsCost('a'.repeat(100), 0)).toBe(0)
  })
})

describe('normalizePhone', () => {
  it('9 xonali raqamga 998 qo\'shiladi', () => {
    expect(normalizePhone('901234567')).toBe('998901234567')
  })

  it('formatlangan +998 (90) 123-45-67 tozalanadi', () => {
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('998901234567')
  })

  it('allaqachon 998901234567 bo\'lsa o\'zi qaytadi', () => {
    expect(normalizePhone('998901234567')).toBe('998901234567')
  })

  it('noto\'g\'ri/bo\'sh raqam null', () => {
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('991234567890')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})
