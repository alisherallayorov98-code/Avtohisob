import {
  renderSmsTemplate, formatSmsAmount, smsLength, validateSmsTemplate,
  DEFAULT_SMS_TEMPLATE,
} from './smsTemplate'

describe('formatSmsAmount', () => {
  it('bo\'shliq bilan ajratadi (vergul emas — SMS\'da chalkashmasin)', () => {
    expect(formatSmsAmount(1200000)).toBe('1 200 000')
    expect(formatSmsAmount(450000)).toBe('450 000')
    expect(formatSmsAmount(0)).toBe('0')
  })
})

describe('renderSmsTemplate', () => {
  const vars = { tashkilot: '"Oq Yol" MChJ', qarz: '1 200 000', oy: '2026-07', aloqa: '901234567' }

  it('barcha o\'rin egallovchilarni to\'ldiradi', () => {
    const out = renderSmsTemplate('{tashkilot}: {qarz} som, {oy}. Tel {aloqa}', vars)
    expect(out).toBe('"Oq Yol" MChJ: 1 200 000 som, 2026-07. Tel 901234567')
  })

  it('shablon bo\'sh/null bo\'lsa standart shablon ishlatiladi', () => {
    expect(renderSmsTemplate(null, vars)).toContain('Oq Yol')
    expect(renderSmsTemplate('   ', vars)).toContain('1 200 000')
    expect(renderSmsTemplate(DEFAULT_SMS_TEMPLATE, vars)).toContain('901234567')
  })

  it('noma\'lum o\'rin egallovchi o\'z holicha qoladi (matn buzilmaydi)', () => {
    expect(renderSmsTemplate('{tashkilot} {nomalum}', vars)).toBe('"Oq Yol" MChJ {nomalum}')
  })

  it('aloqa raqami yo\'q bo\'lsa osilgan "Aloqa:" tozalanadi', () => {
    const out = renderSmsTemplate('Qarz {qarz} som. Aloqa: {aloqa}', { ...vars, aloqa: '' })
    expect(out).toBe('Qarz 1 200 000 som.')
  })

  it('ortiqcha bo\'shliqlar yig\'ishtiriladi', () => {
    expect(renderSmsTemplate('{tashkilot}   {qarz}', vars)).toBe('"Oq Yol" MChJ 1 200 000')
  })
})

describe('smsLength — narx hisobi', () => {
  it('lotin matn: 160 belgigacha 1 ta SMS', () => {
    expect(smsLength('A'.repeat(160))).toMatchObject({ unicode: false, segments: 1 })
    expect(smsLength('A'.repeat(161))).toMatchObject({ unicode: false, segments: 2 })
  })

  it('kirill matn: UCS-2, 70 belgigacha 1 ta SMS', () => {
    expect(smsLength('А'.repeat(70))).toMatchObject({ unicode: true, segments: 1 })
    expect(smsLength('А'.repeat(71))).toMatchObject({ unicode: true, segments: 2 })
  })

  it("o'zbek apostrofi (ʻ) matnni UCS-2 ga o'tkazadi", () => {
    expect(smsLength("Hurmatli mijoz, soʻm").unicode).toBe(true)
    // Oddiy apostrof esa GSM-7 da bor — arzonroq
    expect(smsLength("Hurmatli mijoz, so'm").unicode).toBe(false)
  })

  it('bo\'sh matn → 0 segment', () => {
    expect(smsLength('')).toMatchObject({ chars: 0, segments: 0 })
  })
})

describe('validateSmsTemplate', () => {
  it('to\'g\'ri shablon — xato yo\'q', () => {
    const issues = validateSmsTemplate('Hurmatli {tashkilot}! Qarz: {qarz} som.')
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0)
  })

  it('bo\'sh shablon — xato', () => {
    expect(validateSmsTemplate('  ')[0]).toMatchObject({ level: 'error' })
  })

  it('noma\'lum o\'rin egallovchi — xato', () => {
    const issues = validateSmsTemplate('{tashkilot} {summa}')
    expect(issues.some(i => i.level === 'error' && i.message.includes('{summa}'))).toBe(true)
  })

  it('{qarz} yo\'q — ogohlantirish (xato emas)', () => {
    const issues = validateSmsTemplate('Hurmatli {tashkilot}, tolovni amalga oshiring.')
    expect(issues.some(i => i.level === 'warning' && i.message.includes('{qarz}'))).toBe(true)
    expect(issues.some(i => i.level === 'error')).toBe(false)
  })

  it('juda uzun matn — necha SMS ketishi haqida ogohlantirish', () => {
    const issues = validateSmsTemplate('{qarz} ' + 'A'.repeat(400))
    expect(issues.some(i => i.level === 'warning' && i.message.includes('SMS'))).toBe(true)
  })

  it('500 belgidan uzun — xato', () => {
    expect(validateSmsTemplate('{qarz} ' + 'A'.repeat(600)).some(i => i.level === 'error')).toBe(true)
  })

  it('kirill matn — narx ogohlantirishi', () => {
    const issues = validateSmsTemplate('Хурматли {tashkilot}, қарз {qarz}')
    expect(issues.some(i => i.message.includes('kirill'))).toBe(true)
  })
})
