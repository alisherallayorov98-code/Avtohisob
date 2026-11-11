import { TtlCache, reportCacheKey, cached } from './reportCache'

const scope = (over: any = {}) => ({ orgId: 'o1', userId: 'u1', role: 'admin', districtIds: [] as string[], ...over })

describe('reportCacheKey — tenant leak yoq', () => {
  it('turli korxona / foydalanuvchi / rol / tuman -> turli kalit', () => {
    const base = reportCacheKey('k', scope(), { a: 1 })
    expect(reportCacheKey('k', scope({ orgId: 'o2' }), { a: 1 })).not.toBe(base)
    expect(reportCacheKey('k', scope({ userId: 'u2' }), { a: 1 })).not.toBe(base)
    expect(reportCacheKey('k', scope({ role: 'inspector' }), { a: 1 })).not.toBe(base)
    expect(reportCacheKey('k', scope({ districtIds: ['d1'] }), { a: 1 })).not.toBe(base)
    expect(reportCacheKey('k', scope(), { a: 2 })).not.toBe(base)
  })
  it('tuman va parametr tartibi kalitga tasir qilmaydi', () => {
    expect(reportCacheKey('k', scope({ districtIds: ['b', 'a'] }), { x: 1, y: 2 }))
      .toBe(reportCacheKey('k', scope({ districtIds: ['a', 'b'] }), { y: 2, x: 1 }))
  })
})

describe('TtlCache', () => {
  it('TTL otgach yoqoladi', () => {
    const c = new TtlCache<number>(1000)
    c.set('a', 1, 0)
    expect(c.get('a', 999)).toBe(1)
    expect(c.get('a', 1000)).toBeUndefined()
  })
  it('hajm chegarasi', () => {
    const c = new TtlCache<number>(1000, 3)
    for (let i = 0; i < 10; i++) c.set(String(i), i, 0)
    expect(c.size).toBeLessThanOrEqual(3)
  })
  it('cached: ikkinchi chaqiruv hisoblamaydi; xato keshda qolmaydi', async () => {
    const c = new TtlCache<Promise<number>>(60000)
    let calls = 0
    const f = async () => { calls++; return 7 }
    expect(await cached(c, 'k', f)).toBe(7)
    expect(await cached(c, 'k', f)).toBe(7)
    expect(calls).toBe(1)
    await expect(cached(c, 'bad', async () => { throw new Error('x') })).rejects.toThrow('x')
    await new Promise(r => setImmediate(r))
    expect(c.get('bad')).toBeUndefined()
  })
})
