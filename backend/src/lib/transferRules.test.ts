import { parseQty, normalizeItems, canActOnBatch, resolveReceived } from './transferRules'
import { nextDocNumber, withUniqueDocNumber } from './docNumber'

describe('transferRules', () => {
  it('parseQty: manfiy, kasr, nol, NaN va juda katta rad etiladi', () => {
    expect(parseQty(5)).toBe(5)
    expect(parseQty('7')).toBe(7)
    for (const bad of [-50, 0, 1.5, 'abc', NaN, null, undefined, 10_000_000, '']) expect(parseQty(bad as any)).toBeNull()
  })

  it('normalizeItems: takroriy qatorlar yig\'iladi', () => {
    const r = normalizeItems([{ sparePartId: 'a', quantity: 2 }, { sparePartId: 'b', quantity: 1 }, { sparePartId: 'a', quantity: 3 }])
    expect(r.error).toBeUndefined()
    expect(r.items).toEqual([{ sparePartId: 'a', quantity: 5 }, { sparePartId: 'b', quantity: 1 }])
  })

  it('normalizeItems: manfiy miqdor va bo\'sh ro\'yxat xato', () => {
    expect(normalizeItems([{ sparePartId: 'a', quantity: -50 }]).error).toBeTruthy()
    expect(normalizeItems([]).error).toBeTruthy()
    expect(normalizeItems([{ quantity: 1 }]).error).toBeTruthy()
    expect(normalizeItems('x').error).toBeTruthy()
  })

  it('canActOnBatch: yuborish — jo\'natuvchi, qabul — qabul qiluvchi tomon', () => {
    // filial xodimi faqat o'z omborini ko'radi
    expect(canActOnBatch('ship', ['A'], 'A', 'B')).toBe(true)
    expect(canActOnBatch('receive', ['A'], 'A', 'B')).toBe(false) // yuboruvchi o'zi qabul qila olmaydi
    expect(canActOnBatch('reject', ['A'], 'A', 'B')).toBe(false)
    expect(canActOnBatch('ship', ['B'], 'A', 'B')).toBe(false)
    expect(canActOnBatch('receive', ['B'], 'A', 'B')).toBe(true)
    // tashkilot admini ikkala omborni ko'radi
    expect(canActOnBatch('ship', ['A', 'B'], 'A', 'B')).toBe(true)
    expect(canActOnBatch('receive', ['A', 'B'], 'A', 'B')).toBe(true)
    // super_admin
    expect(canActOnBatch('receive', null, 'A', 'B')).toBe(true)
  })

  it('resolveReceived: berilmasa to\'liq; kamomad hisoblanadi', () => {
    const t = [{ id: '1', quantity: 5 }, { id: '2', quantity: 3 }]
    expect(resolveReceived(t, undefined)).toEqual({ rows: [{ id: '1', quantity: 5, received: 5 }, { id: '2', quantity: 3, received: 3 }], shortage: 0 })
    const r = resolveReceived(t, [{ transferId: '1', receivedQuantity: 4 }])
    expect(r.shortage).toBe(1)
    expect(r.rows[0].received).toBe(4)
    expect(r.rows[1].received).toBe(3) // berilmagani — to'liq
  })

  it('resolveReceived: ortiq/manfiy/kasr/begona/takror xato', () => {
    const t = [{ id: '1', quantity: 5 }]
    expect(resolveReceived(t, [{ transferId: '1', receivedQuantity: 6 }]).error).toBeTruthy()
    expect(resolveReceived(t, [{ transferId: '1', receivedQuantity: -1 }]).error).toBeTruthy()
    expect(resolveReceived(t, [{ transferId: '1', receivedQuantity: 2.5 }]).error).toBeTruthy()
    expect(resolveReceived(t, [{ transferId: 'x', receivedQuantity: 1 }]).error).toBeTruthy()
    expect(resolveReceived(t, [{ transferId: '1', receivedQuantity: 1 }, { transferId: '1', receivedQuantity: 2 }]).error).toBeTruthy()
    expect(resolveReceived(t, [{ transferId: '1', receivedQuantity: 0 }]).shortage).toBe(5) // umuman kelmagan — ruxsat
  })
})

describe('docNumber', () => {
  it('nextDocNumber', () => {
    expect(nextDocNumber('TRF-2026', null)).toBe('TRF-2026-0001')
    expect(nextDocNumber('TRF-2026', 'TRF-2026-0271')).toBe('TRF-2026-0272')
    expect(nextDocNumber('TRF-2026', 'TRF-2026-9999')).toBe('TRF-2026-10000')
  })

  it('withUniqueDocNumber: urilib qolsa yangi raqam bilan qayta uradi', async () => {
    let last = 'TRF-2026-0005'
    let calls = 0
    const res = await withUniqueDocNumber('TRF-2026', async () => last, async (num) => {
      calls++
      if (calls === 1) { last = 'TRF-2026-0006'; throw Object.assign(new Error('dup'), { code: 'P2002' }) }
      return num
    })
    expect(res).toBe('TRF-2026-0007')
    expect(calls).toBe(2)
  })

  it('withUniqueDocNumber: boshqa xatoni qayta uramaydi', async () => {
    let calls = 0
    await expect(withUniqueDocNumber('X', async () => null, async () => { calls++; throw new Error('boom') })).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })
})
