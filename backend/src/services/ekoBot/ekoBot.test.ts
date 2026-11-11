import { mulberry32, randInt } from '../../modules/ekohisob/lib/testRng'
import { parseBotAmount, parsePlanTarget, parseCubeVolume, quickAmounts, halfOf, BOT_MAX_AMOUNT } from './amount'
import { SessionStore } from './session'
import { paginate } from './paginate'
import { newPayDraft, setAmount, setMonth, beginSubmit, finishSubmit, failSubmit } from './payFlow'
import { matchCommand } from './commands'
import { classifyQuery } from './search'
import { REASONS, parsePromiseText, presetDate, validateVisit } from './visitFlow'
import { head, sum, failText, describeError, confirmText, successText, esc, receiptVerifyUrl, normApos } from './format'
import { mainKeyboard, payQuickKeyboard, payConfirmKeyboard, errorKeyboard, pagerRow, entityCardKeyboard } from './keyboards'
import { buildDailyPage, buildDistrictReport, planPercent, promiseTag } from './reports'

describe('parseBotAmount', () => {
  it.each([
    ['150000', 150000], ['150 000', 150000], ['1,500,000', 1500000], [' 50000 ', 50000], ['1 000', 1000],
  ])('qabul: %s', (t, v) => expect(parseBotAmount(t)).toEqual({ ok: true, value: v }))

  it.each(['1500.75', '1e6', '-5', '0x10', '1,5', '12,34', 'abc', '', '   ', '0', '000', '007', '1.000', '5 so\'m', '+100', '١٢٣'])(
    'rad: %j', (t) => expect(parseBotAmount(t).ok).toBe(false))

  it('juda katta', () => {
    expect(parseBotAmount(String(BOT_MAX_AMOUNT + 1))).toEqual({ ok: false, reason: 'too_large' })
    expect(parseBotAmount(String(BOT_MAX_AMOUNT))).toEqual({ ok: true, value: BOT_MAX_AMOUNT })
    expect(parseBotAmount('9'.repeat(20)).ok).toBe(false)
  })
  it('matn bo\'lmagan kirish', () => {
    expect(parseBotAmount(undefined).ok).toBe(false)
    expect(parseBotAmount(150000 as any).ok).toBe(false)
  })

  it('seeded: 300 ta tasodifiy butun son (bo\'shliq/vergul ajratgich bilan) aniq qaytadi', () => {
    const rnd = mulberry32(12345)
    for (let i = 0; i < 300; i++) {
      const n = randInt(rnd, 1, BOT_MAX_AMOUNT)
      const s = String(n)
      const mode = i % 3
      const text = mode === 0 ? s
        : mode === 1 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
        : s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      expect(parseBotAmount(text)).toEqual({ ok: true, value: n })
    }
  })

  it('seeded: 300 ta kasr/ilmiy/belgili kiritish doim rad', () => {
    const rnd = mulberry32(777)
    for (let i = 0; i < 300; i++) {
      const a = randInt(rnd, 1, 999999)
      const b = randInt(rnd, 1, 99)
      const variants = [`${a}.${b}`, `${a}e${randInt(rnd, 1, 5)}`, `-${a}`, `${a}x`, `${a}.`, `0${a}`, `${a},${b}`]
      const t = variants[i % variants.length]
      expect(parseBotAmount(t).ok).toBe(false)
    }
  })
})

describe('parsePlanTarget / parseCubeVolume', () => {
  it('plan 1..1000', () => {
    expect(parsePlanTarget('20')).toBe(20)
    expect(parsePlanTarget('1000')).toBe(1000)
    for (const t of ['0', '1001', '-1', '2.5', 'x', '', '99999']) expect(parsePlanTarget(t)).toBeNull()
  })
  it('kub 0 < v <= 1000', () => {
    expect(parseCubeVolume('3.5')).toBe(3.5)
    expect(parseCubeVolume('3,5')).toBe(3.5)
    expect(parseCubeVolume('1000')).toBe(1000)
    for (const t of ['0', '1000.5', '1001', '-2', '1.2345', 'abc', '1e3', '']) expect(parseCubeVolume(t)).toBeNull()
  })
})

describe('quickAmounts', () => {
  it('qarz asosida', () => {
    expect(quickAmounts(150000, 100000)).toEqual({ full: 150000, half: 75000 })
  })
  it('qarz yo\'q -> oylik', () => {
    expect(quickAmounts(0, 80000)).toEqual({ full: 80000, half: 40000 })
  })
  it('hech narsa yo\'q', () => {
    expect(quickAmounts(0, 0)).toEqual({ full: null, half: null })
    expect(halfOf(1)).toBeNull()
  })
})

describe('SessionStore TTL', () => {
  it('muddat o\'tgach idle + expired', () => {
    let t = 0
    const s = new SessionStore(1000, () => t)
    s.set('a', 'pay_amount', { x: 1 })
    t = 500
    expect(s.take('a').session.state).toBe('pay_amount')
    t = 1400 // oxirgi faollik 500 da, +900
    expect(s.take('a').expired).toBe(false)
    t = 2500
    const r = s.take('a')
    expect(r.expired).toBe(true)
    expect(r.session.state).toBe('idle')
    expect(s.take('a').expired).toBe(false)
  })
  it('idle sessiya muddati o\'tsa expired emas', () => {
    let t = 0
    const s = new SessionStore(10, () => t)
    s.get('b'); t = 100
    expect(s.take('b').expired).toBe(false)
  })
  it('sweep va maxSize', () => {
    let t = 0
    const s = new SessionStore(10, () => t, 3)
    for (const id of ['1', '2', '3', '4', '5']) s.set(id, 'x')
    expect(s.size()).toBeLessThanOrEqual(3)
    t = 100
    expect(s.sweep()).toBeGreaterThan(0)
    expect(s.size()).toBe(0)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 20 }, (_, i) => i)
  it('sahifalar', () => {
    const p = paginate(items, 0, 8)
    expect(p.items).toHaveLength(8); expect(p.pages).toBe(3); expect(p.hasPrev).toBe(false); expect(p.hasNext).toBe(true)
    const l = paginate(items, 2, 8)
    expect(l.items).toEqual([16, 17, 18, 19]); expect(l.hasNext).toBe(false)
  })
  it('chegaradan tashqari sahifa qisqartiriladi', () => {
    expect(paginate(items, 99, 8).page).toBe(2)
    expect(paginate(items, -5, 8).page).toBe(0)
    expect(paginate([], 3, 8)).toMatchObject({ pages: 1, page: 0, total: 0 })
  })
  it('seeded: yig\'indi saqlanadi', () => {
    const rnd = mulberry32(5)
    for (let i = 0; i < 50; i++) {
      const n = randInt(rnd, 0, 100), size = randInt(rnd, 1, 12)
      const arr = Array.from({ length: n }, (_, k) => k)
      const p0 = paginate(arr, 0, size)
      let got = 0
      for (let pg = 0; pg < p0.pages; pg++) got += paginate(arr, pg, size).items.length
      expect(got).toBe(n)
    }
  })
  it('pagerRow', () => {
    expect(pagerRow(paginate(items, 1, 8), 'dl').map(b => b.callback_data)).toEqual(['dl:0', 'dl:2'])
  })
})

describe('to\'lov tasdiq holat mashinasi', () => {
  let n = 0
  const key = () => `bot-key-${++n}`
  const base = newPayDraft({ entityId: 'e1', entityName: 'X', debt: 100, monthlyFee: 100, debtMonths: ['2026-06', '2026-07'], currentMonth: '2026-07' })

  it('eng eski oy default', () => expect(base.month).toBe('2026-06'))
  it('oy qarz oylaridan tashqari bo\'lsa o\'zgarmaydi', () => expect(setMonth(base, '2030-01', key).month).toBe('2026-06'))
  it('qarz oyi yo\'q -> joriy oy', () => {
    expect(newPayDraft({ entityId: 'e', entityName: 'X', debt: 0, monthlyFee: 0, debtMonths: [], currentMonth: '2026-07' }).month).toBe('2026-07')
  })

  it('summa -> confirm, kalit bir marta', () => {
    const d = setAmount(base, 100, key)
    expect(d.status).toBe('confirm'); expect(d.key).toBeTruthy()
    expect(setAmount(d, 100, key).key).toBe(d.key)
    expect(setAmount(d, 50, key).key).not.toBe(d.key)
  })
  it('oy o\'zgarsa kalit yangilanadi', () => {
    const d = setAmount(base, 100, key)
    expect(setMonth(d, '2026-07', key).key).not.toBe(d.key)
  })

  it('ikki marta bosish: birinchi go, ikkinchi busy', () => {
    const d = setAmount(base, 100, key)
    const a = beginSubmit(d)
    expect(a.action).toBe('go'); expect(a.draft.status).toBe('sending')
    expect(beginSubmit(a.draft).action).toBe('busy')
  })
  it('yozilgandan keyin done', () => {
    const a = beginSubmit(setAmount(base, 100, key))
    const done = finishSubmit(a.draft, { receiptNumber: 'R1', verifyToken: null, remaining: 0, amount: 100, month: '2026-06', allocations: [], talonsClosed: 0 })
    expect(beginSubmit(done).action).toBe('done')
  })
  it('xatodan keyin qayta urinish bir xil kalit bilan', () => {
    const d = setAmount(base, 100, key)
    const a = beginSubmit(d)
    const f = failSubmit(a.draft)
    expect(f.status).toBe('confirm')
    const again = beginSubmit(f)
    expect(again.action).toBe('go'); expect(again.draft.key).toBe(d.key)
  })
  it('summa tanlanmagan -> invalid', () => expect(beginSubmit(base).action).toBe('invalid'))
})

describe('commands', () => {
  it('yangi va eski yorliqlar', () => {
    expect(matchCommand("Bugungi ro'yxat")).toBe('today')
    expect(matchCommand("📋 Bugungi ro'yxat")).toBe('today')
    expect(matchCommand('/bugun')).toBe('today')
    expect(matchCommand('/bugun@EkoBot')).toBe('today')
    expect(matchCommand('🔍 Tashkilot qidirish')).toBe('search')
    expect(matchCommand('Qidirish')).toBe('search')
    expect(matchCommand('📊 Mening tumanim')).toBe('district')
    expect(matchCommand('Mening hisobotim')).toBe('report')
    expect(matchCommand('Bekor')).toBe('cancel')
    expect(matchCommand('❌ Bekor qilish')).toBe('cancel')
    expect(matchCommand('Menyu')).toBe('menu')
    expect(matchCommand('🌐 Til / Тил')).toBe('lang')
    expect(matchCommand('Yordam')).toBe('help')
  })
  it('oddiy matn buyruq emas', () => {
    expect(matchCommand('Oq Yol MChJ')).toBeNull()
    expect(matchCommand('150000')).toBeNull()
    expect(matchCommand('')).toBeNull()
    expect(matchCommand(undefined)).toBeNull()
  })
})

describe('classifyQuery', () => {
  it('nom', () => expect(classifyQuery('Oq Yol')).toMatchObject({ kind: 'name', name: 'Oq Yol', digits: null }))
  it('STIR', () => expect(classifyQuery('305123456')).toMatchObject({ kind: 'digits', digits: '305123456', phoneTail: '305123456' }))
  it('telefon formati', () => {
    const q = classifyQuery('+998 90 123-45-67')
    expect(q.kind).toBe('digits'); expect(q.phoneTail).toBe('901234567')
  })
  it('oxirgi 4 raqam', () => expect(classifyQuery('4567').phoneTail).toBe('4567'))
  it('juda qisqa', () => {
    expect(classifyQuery('a').kind).toBe('invalid')
    expect(classifyQuery('12').kind).toBe('invalid')
  })
  it('kod', () => expect(classifyQuery('A-123').code).toBe('A-123'))
})

describe('visitFlow', () => {
  it('sabab tugmalari', () => expect(Object.keys(REASONS)).toEqual(['cash', 'absent', 'refused', 'later']))
  it('sana parse', () => {
    expect(parsePromiseText('25.11.2026')).toBe('2026-11-25')
    expect(parsePromiseText('5/1/2027')).toBe('2027-01-05')
    for (const t of ['31.02.2026', '2026-11-25', 'abc', '25.13.2026', '']) expect(parsePromiseText(t)).toBeNull()
  })
  it('preset', () => expect(presetDate('2026-11-10', 7)).toBe('2026-11-17'))
  it('validatsiya: sabab va sana', () => {
    const base = { reason: "Pul yo'q", promisedDate: null, photoFileId: null, lat: null, lon: null }
    expect(validateVisit(base, '2026-11-10').ok).toBe(true)
    expect(validateVisit({ ...base, promisedDate: '2026-11-13' }, '2026-11-10')).toMatchObject({ ok: true, value: { kind: 'promised' } })
    expect(validateVisit({ ...base, promisedDate: '2026-11-01' }, '2026-11-10').ok).toBe(false)
    expect(validateVisit({ ...base, promisedDate: '2027-06-01' }, '2026-11-10').ok).toBe(false)
    expect(validateVisit({ ...base, lat: 41.3, lon: 69.2 }, '2026-11-10').ok).toBe(true)
    expect(validateVisit({ ...base, lat: 999, lon: 69.2 }, '2026-11-10').ok).toBe(false)
  })
})

describe('format', () => {
  it('summa va sarlavha', () => {
    expect(sum(150000)).toBe("150 000 so'm")
    expect(head('ok', "To'lov qabul qilindi")).toBe("✅ <b>To'lov qabul qilindi</b>")
    expect(head('warn', 'X').startsWith('⚠️')).toBe(true)
  })
  it('apostrof va escape', () => {
    expect(normApos('o’zbek oʻg')).toBe("o'zbek o'g")
    expect(esc('<b>&')).toBe('&lt;b&gt;&amp;')
  })
  it('xato shabloni', () => {
    expect(failText('tarmoq xatosi.')).toBe('❌ <b>Bajarilmadi:</b> tarmoq xatosi.')
    expect(failText('x')).not.toContain('Xato yuz berdi')
  })
  it('xato turlari farqlanadi', () => {
    expect(describeError({ code: 'ETIMEDOUT' }).kind).toBe('network')
    expect(describeError({ message: 'ETELEGRAM: 502' }).kind).toBe('network')
    expect(describeError({ code: 'P1001' }).kind).toBe('db')
    expect(describeError({ name: 'PaymentError', code: 'FORBIDDEN' })).toMatchObject({ kind: 'forbidden', retryable: false })
    expect(describeError({ name: 'PaymentError', code: 'INVALID_AMOUNT' }).kind).toBe('validation')
    expect(describeError(new Error('boom')).kind).toBe('unknown')
    expect(describeError(undefined).reason).toBeTruthy()
  })
  it('tasdiq matni: oy chiroyli, ortiqcha qator', () => {
    const t = confirmText({ entityName: 'A&B', month: '2026-07', amount: 200000, debt: 150000, debtMonths: ['2026-07'] })
    expect(t).toContain('Iyul 2026'); expect(t).toContain('200 000 so\'m'); expect(t).toContain('A&amp;B')
    expect(t).toContain('Ortiqcha 50 000')
    expect(t).not.toContain('━')
    expect(t).not.toContain('2026-07')
  })
  it('muvaffaqiyat matni', () => {
    const t = successText({
      entityName: 'A', month: '2026-07', amount: 150000, allocations: [{ month: '2026-06', amount: 50000 }, { month: '2026-07', amount: 100000 }],
      talonsClosed: 0, remaining: 0, receiptNumber: 'EKO-2026-00001', inspector: 'Ali', replay: false,
    })
    expect(t.split('\n')[0]).toBe("✅ <b>To'lov qabul qilindi</b>")
    expect(t).toContain('Taqsimot: Iyun 2026 50 000 so\'m; Iyul 2026 100 000 so\'m')
    expect(t).toContain('EKO-2026-00001')
    const r = successText({ entityName: 'A', month: '2026-07', amount: 1, allocations: [], talonsClosed: 0, remaining: 5, receiptNumber: '', inspector: 'Ali', replay: true })
    expect(r.split('\n')[0]).toContain('allaqachon yozilgan')
  })
  it('tekshiruv havolasi', () => {
    expect(receiptVerifyUrl('abc', { FRONTEND_URL: 'https://x.uz/' } as any)).toBe('https://x.uz/ekohisob/kvitansiya/abc')
    expect(receiptVerifyUrl(null)).toBeNull()
    expect(receiptVerifyUrl('abc', { FRONTEND_URL: 'http://x.uz' } as any)).toBeNull()
  })
})

describe('keyboards', () => {
  const flat = (k: any) => (k.inline_keyboard as any[][]).flat()
  it('asosiy klaviatura: rol bilan, mini-app faqat URL bo\'lsa', () => {
    const noUrl = mainKeyboard('supervisor', null).keyboard.flat().map((b: any) => b.text)
    expect(noUrl).toContain('Mening tumanim'); expect(noUrl).not.toContain('Xarita')
    const withUrl = mainKeyboard('inspector', 'https://x.uz/tg').keyboard.flat().map((b: any) => b.text)
    expect(withUrl).toContain('Xarita'); expect(withUrl).toContain('Mening hisobotim'); expect(withUrl).not.toContain('Mening tumanim')
    expect(mainKeyboard('inspector', null).keyboard.flat().some((b: any) => b.text.includes('Yordam'))).toBe(false)
  })
  it('tezkor summa tugmalari va oy chiplari', () => {
    const one = flat(payQuickKeyboard({ entityId: 'e1', full: 150000, half: 75000, months: ['2026-07'], selectedMonth: '2026-07' }))
    expect(one.map(b => b.text)).toEqual(expect.arrayContaining(['To\'liq 150 000', 'Yarmi 75 000', 'Boshqa summa']))
    expect(one.some(b => String(b.callback_data).startsWith('pm:'))).toBe(false)
    const many = flat(payQuickKeyboard({ entityId: 'e1', full: 1, half: null, months: ['2026-06', '2026-07'], selectedMonth: '2026-06' }))
    expect(many.filter(b => String(b.callback_data).startsWith('pm:'))).toHaveLength(2)
    expect(many.find(b => b.callback_data === 'pm:2026-06')!.text).toContain('Iyun 2026')
  })
  it('callback_data 64 baytdan oshmaydi', () => {
    const id = '12345678-1234-1234-1234-123456789012'
    const all = [
      ...flat(payQuickKeyboard({ entityId: id, full: 1, half: 1, months: ['2026-06', '2026-07'], selectedMonth: '2026-06' })),
      ...flat(payConfirmKeyboard(id)),
      ...flat(entityCardKeyboard({ entityId: id, canWrite: true, canPay: true, talon: true, talonPriceSet: true, hasLocation: true, lat: 1, lon: 2, hasBack: true })),
    ]
    for (const b of all) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64)
  })
  it('❌ tugmalarda yo\'q', () => {
    const id = 'e'
    const all = [...flat(payConfirmKeyboard(id)), ...flat(errorKeyboard('pok')),
      ...flat(entityCardKeyboard({ entityId: id, canWrite: true, canPay: true, talon: false, talonPriceSet: false, hasLocation: true, lat: null, lon: null, hasBack: false }))]
    for (const b of all) expect(b.text).not.toContain('❌')
  })
  it('Orqaga va Bekor farqli', () => {
    const k = flat(payConfirmKeyboard('e1'))
    expect(k.find(b => b.text === 'Orqaga')!.callback_data).toBe('pay:e1')
    expect(k.find(b => b.text === 'Bekor')!.callback_data).toBe('cancel')
  })
  it('xato tugmasi: qayta urinish uzun data bo\'lsa tushib qoladi', () => {
    expect(flat(errorKeyboard('pok')).map(b => b.text)).toContain('Qayta urinish')
    expect(flat(errorKeyboard('x'.repeat(80))).map(b => b.text)).not.toContain('Qayta urinish')
  })
})

describe('reports', () => {
  const rows = Array.from({ length: 19 }, (_, i) => ({ id: `id${i}`, name: `Tashkilot ${i}`, debt: 1_000_000 - i * 1000, promiseDays: i === 1 ? 0 : i === 2 ? 3 : null }))
  it('bugungi ro\'yxat: sarlavha, tartib, sel tugmalari, sahifalash', () => {
    const p = buildDailyPage({ rows, page: 0, collectedToday: 1_200_000, month: '2026-11' })
    expect(p.text).toContain("Bugun yig'ildi: 1 200 000 so'm · Qoldi: 19 ta")
    expect(p.text).toContain("va'da bugun"); expect(p.text).toContain("va'da 3 kun o'tgan")
    const btns = p.reply_markup.inline_keyboard.flat() as any[]
    expect(btns.filter(b => String(b.callback_data).startsWith('sel:'))).toHaveLength(8)
    expect(btns.map(b => b.text)).toContain('Keyingi'); expect(btns.map(b => b.text)).not.toContain('Oldingi')
    const last = buildDailyPage({ rows, page: 2, collectedToday: 0, month: '2026-11' })
    expect(last.text).toContain('17. Tashkilot 16')
    expect((last.reply_markup.inline_keyboard.flat() as any[]).map(b => b.text)).toContain('Oldingi')
  })
  it('bo\'sh ro\'yxat', () => {
    expect(buildDailyPage({ rows: [], page: 0, collectedToday: 5, month: '2026-11' }).text).toContain('✅')
  })
  it('boshliq hisoboti: 0 bilan ham hamma inspektor', () => {
    const r = buildDistrictReport({
      month: '2026-11', totalEnt: 10, paidEnts: 4, collectedMonth: 500000, collectedToday: 100000, expected: 900000,
      inspectors: [
        { id: 'a', name: 'Ali', monthSum: 0, monthCnt: 0, todaySum: 0, todayCnt: 0, lastPaidAt: null, planTarget: null, newToday: 0 },
        { id: 'b', name: 'Vali', monthSum: 500000, monthCnt: 3, todaySum: 100000, todayCnt: 1, lastPaidAt: new Date('2026-11-10T09:30:00Z'), planTarget: 20, newToday: 10 },
      ],
    })
    expect(r.text).toContain('Ali'); expect(r.text).toContain('Vali')
    expect(r.text).toContain('plan 50%'); expect(r.text).toContain('14:30')
    expect(r.text).toContain('Noyabr 2026')
    expect((r.reply_markup.inline_keyboard.flat() as any[]).filter(b => String(b.callback_data).startsWith('insp:'))).toHaveLength(2)
  })
  it('plan foizi va va\'da belgisi', () => {
    expect(planPercent(5, 20)).toBe(25); expect(planPercent(5, null)).toBeNull(); expect(planPercent(5, 0)).toBeNull()
    expect(promiseTag(null)).toBe(''); expect(promiseTag(0)).toContain('bugun')
  })
})
