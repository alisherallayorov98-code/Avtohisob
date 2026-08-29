import { consumeFifoLayers } from './fifoCost'

describe('consumeFifoLayers', () => {
  it('bitta qatlam to\'liq sotuvni qoplaydi', () => {
    const layers = [{ id: 'L1', unitCost: 1000, remainingQty: 50, createdAt: '2026-01-01' }]
    const result = consumeFifoLayers(layers, 10)
    expect(result.consumptions).toEqual([{ layerId: 'L1', quantity: 10, unitCost: 1000 }])
    expect(result.totalCost).toBe(10000)
    expect(result.avgUnitCost).toBe(1000)
  })

  it('sotuv 2+ qatlamdan eskisidan boshlab sarflaydi', () => {
    const layers = [
      { id: 'L2', unitCost: 1200, remainingQty: 20, createdAt: '2026-02-01' },
      { id: 'L1', unitCost: 1000, remainingQty: 5, createdAt: '2026-01-01' },
    ]
    const result = consumeFifoLayers(layers, 8)
    expect(result.consumptions).toEqual([
      { layerId: 'L1', quantity: 5, unitCost: 1000 },
      { layerId: 'L2', quantity: 3, unitCost: 1200 },
    ])
    expect(result.totalCost).toBe(5 * 1000 + 3 * 1200)
  })

  it('mavjud qoldiqdan ko\'p so\'ralsa xato tashlaydi, hech narsa sarflamaydi', () => {
    const layers = [{ id: 'L1', unitCost: 1000, remainingQty: 5, createdAt: '2026-01-01' }]
    expect(() => consumeFifoLayers(layers, 10)).toThrow(/yetarli qoldiq yo'q/i)
  })

  it('remainingQty=0 qatlam butunlay o\'tkazib yuboriladi', () => {
    const layers = [
      { id: 'L1', unitCost: 1000, remainingQty: 0, createdAt: '2026-01-01' },
      { id: 'L2', unitCost: 1100, remainingQty: 10, createdAt: '2026-02-01' },
    ]
    const result = consumeFifoLayers(layers, 4)
    expect(result.consumptions).toEqual([{ layerId: 'L2', quantity: 4, unitCost: 1100 }])
  })

  it('bir necha sotuv bitta qatlamni to\'liq 0gacha ketma-ket sarflaydi', () => {
    let layers = [{ id: 'L1', unitCost: 500, remainingQty: 10, createdAt: '2026-01-01' }]
    const first = consumeFifoLayers(layers, 6)
    expect(first.consumptions).toEqual([{ layerId: 'L1', quantity: 6, unitCost: 500 }])

    layers = [{ id: 'L1', unitCost: 500, remainingQty: 4, createdAt: '2026-01-01' }]
    const second = consumeFifoLayers(layers, 4)
    expect(second.consumptions).toEqual([{ layerId: 'L1', quantity: 4, unitCost: 500 }])
  })

  it('Decimal aniqlik — qisman sarflashda narx drift qilmaydi', () => {
    const layers = [{ id: 'L1', unitCost: 12345.67, remainingQty: 3, createdAt: '2026-01-01' }]
    const result = consumeFifoLayers(layers, 3)
    expect(result.totalCost).toBe(37037.01)
    expect(result.avgUnitCost).toBe(12345.67)
  })

  it('bir xil millisekundda ikkita qatlam bo\'lsa id bo\'yicha deterministik tartib', () => {
    const sameTime = '2026-01-01T00:00:00.000Z'
    const layers = [
      { id: 'LB', unitCost: 200, remainingQty: 5, createdAt: sameTime },
      { id: 'LA', unitCost: 100, remainingQty: 5, createdAt: sameTime },
    ]
    const result = consumeFifoLayers(layers, 5)
    expect(result.consumptions).toEqual([{ layerId: 'LA', quantity: 5, unitCost: 100 }])
  })

  it('qtyNeeded 0 yoki manfiy bo\'lsa xato tashlaydi', () => {
    const layers = [{ id: 'L1', unitCost: 1000, remainingQty: 5, createdAt: '2026-01-01' }]
    expect(() => consumeFifoLayers(layers, 0)).toThrow()
    expect(() => consumeFifoLayers(layers, -1)).toThrow()
  })
})
