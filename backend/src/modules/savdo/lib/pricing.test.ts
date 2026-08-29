import { resolveUnitPrice } from './pricing'

describe('resolveUnitPrice', () => {
  it('mijoz optom bo\'lsa optom narx qaytadi', () => {
    const price = resolveUnitPrice({ wholesalePrice: 8000, retailPrice: 10000, customerPriceTier: 'wholesale' })
    expect(price).toBe(8000)
  })

  it('mijoz chakana bo\'lsa chakana narx qaytadi', () => {
    const price = resolveUnitPrice({ wholesalePrice: 8000, retailPrice: 10000, customerPriceTier: 'retail' })
    expect(price).toBe(10000)
  })

  it('mijoz tanlanmagan bo\'lsa (null) chakana narx standart', () => {
    const price = resolveUnitPrice({ wholesalePrice: 8000, retailPrice: 10000, customerPriceTier: null })
    expect(price).toBe(10000)
  })

  it('qo\'lda narx berilsa mijoz toifasidan qat\'i nazar ustunlik qiladi', () => {
    const price = resolveUnitPrice({ wholesalePrice: 8000, retailPrice: 10000, customerPriceTier: 'wholesale', manualPrice: 9500 })
    expect(price).toBe(9500)
  })

  it('qo\'lda narx 0 bo\'lsa ham ustunlik qiladi (falsy emas, null tekshiriladi)', () => {
    const price = resolveUnitPrice({ wholesalePrice: 8000, retailPrice: 10000, manualPrice: 0 })
    expect(price).toBe(0)
  })
})
