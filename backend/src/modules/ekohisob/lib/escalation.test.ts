import {
  levelRank, isEscalation, isDeescalation, mergeRules, decideActions,
  meetsMinLevel, DEFAULT_ESCALATION_RULES,
} from './escalation'

describe('levelRank / isEscalation', () => {
  it('darajalar tartibi to\'g\'ri', () => {
    expect(levelRank('current')).toBeLessThan(levelRank('warning'))
    expect(levelRank('warning')).toBeLessThan(levelRank('overdue'))
    expect(levelRank('overdue')).toBeLessThan(levelRank('critical'))
    expect(levelRank('critical')).toBeLessThan(levelRank('blacklisted'))
  })

  it('noma\'lum daraja → 0 (himoya)', () => {
    expect(levelRank('nomalum')).toBe(0)
    expect(levelRank(null)).toBe(0)
  })

  it('daraja oshsa eskalatsiya', () => {
    expect(isEscalation('current', 'warning')).toBe(true)
    expect(isEscalation('warning', 'critical')).toBe(true)
  })

  it('daraja o\'zgarmasa yoki pasaysa eskalatsiya YO\'Q (takror xabar bo\'lmasin)', () => {
    expect(isEscalation('overdue', 'overdue')).toBe(false)
    expect(isEscalation('critical', 'warning')).toBe(false)
  })

  it('pasayish aniqlanadi (jurnal tozalanishi uchun)', () => {
    expect(isDeescalation('critical', 'current')).toBe(true)
    expect(isDeescalation('current', 'critical')).toBe(false)
  })
})

describe('mergeRules — korxona qoidalari standart ustiga', () => {
  it('bazada yozuv bo\'lmasa standart qoidalar', () => {
    const r = mergeRules([])
    expect(r.warning.smsEnabled).toBe(false)
    expect(r.overdue.notifyInspector).toBe(true)
    expect(r.critical.suggestBlacklist).toBe(true)
  })

  it('korxona qoidasi standartni bosib o\'tadi', () => {
    const r = mergeRules([{ level: 'warning', smsEnabled: true }])
    expect(r.warning.smsEnabled).toBe(true)
    // Qolgan maydonlar standartdan qoladi
    expect(r.warning.notifyInspector).toBe(false)
    // Boshqa darajalar tegilmaydi
    expect(r.critical.smsEnabled).toBe(true)
  })

  it('level\'siz yozuv e\'tiborsiz qoldiriladi', () => {
    const r = mergeRules([{ smsEnabled: true } as any])
    expect(r.warning.smsEnabled).toBe(false)
  })
})

describe('decideActions', () => {
  const rules = mergeRules([])

  it('standart: warning\'da hech narsa (bir oy kechikish odatiy)', () => {
    expect(decideActions('warning', rules)).toEqual([])
  })

  it('standart: overdue\'da faqat inspektor', () => {
    expect(decideActions('overdue', rules)).toEqual(['inspector'])
  })

  it('standart: critical\'da to\'liq to\'plam', () => {
    expect(decideActions('critical', rules)).toEqual(['sms', 'inspector', 'manager', 'blacklist_suggest'])
  })

  it('qoida o\'chirilgan bo\'lsa hech narsa', () => {
    const off = mergeRules([{ level: 'critical', isActive: false }])
    expect(decideActions('critical', off)).toEqual([])
  })

  it('noma\'lum daraja → bo\'sh', () => {
    expect(decideActions('current', rules)).toEqual([])
    expect(decideActions('blacklisted', rules)).toEqual([])
  })
})

describe('meetsMinLevel — avto-SMS qamrovi', () => {
  it('minLevel=overdue → overdue va critical qamrab olinadi', () => {
    expect(meetsMinLevel('overdue', 'overdue')).toBe(true)
    expect(meetsMinLevel('critical', 'overdue')).toBe(true)
    expect(meetsMinLevel('warning', 'overdue')).toBe(false)
  })

  it('qarzsiz (current) hech qachon qamrab olinmaydi', () => {
    expect(meetsMinLevel('current', 'current')).toBe(false)
    expect(meetsMinLevel(null, 'warning')).toBe(false)
  })

  it('minLevel=warning → barcha qarzdorlar', () => {
    expect(meetsMinLevel('warning', 'warning')).toBe(true)
    expect(meetsMinLevel('critical', 'warning')).toBe(true)
  })
})

describe('DEFAULT_ESCALATION_RULES — mahsulot qarori', () => {
  it('hech bir standart qoida avtomatik qora ro\'yxatga QO\'SHMAYDI', () => {
    // suggestBlacklist faqat TAVSIYA — qo'shish har doim odam qo'li bilan
    for (const r of DEFAULT_ESCALATION_RULES) {
      expect(Object.keys(r)).not.toContain('autoBlacklist')
    }
  })
})
