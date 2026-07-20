import { formatTrend } from './weeklySummaryFormat'

describe('formatTrend — haftalik xarajat trendi', () => {
  it('o\'sish → ↑ foiz ko\'p', () => {
    expect(formatTrend(115, 100)).toBe("↑ 15% ko'p")
  })

  it('kamayish → ↓ foiz kam', () => {
    expect(formatTrend(80, 100)).toBe('↓ 20% kam')
  })

  it('±3% ichida → o\'zgarishsiz (shovqin darajasidagi farq)', () => {
    expect(formatTrend(102, 100)).toBe('≈ o\'tgan hafta bilan bir xil')
    expect(formatTrend(98, 100)).toBe('≈ o\'tgan hafta bilan bir xil')
  })

  it('o\'tgan hafta 0, bu hafta bor → "yangi"', () => {
    expect(formatTrend(50000, 0)).toBe('yangi (o\'tgan hafta bo\'lmagan)')
  })

  it('ikkalasi 0 → bo\'sh satr (ko\'rsatmaymiz)', () => {
    expect(formatTrend(0, 0)).toBe('')
  })

  it('bu hafta 0, o\'tgan haftada bor edi → ↓ 100%', () => {
    expect(formatTrend(0, 100)).toBe('↓ 100% (bu hafta yo\'q)')
  })

  it('katta o\'sish (2 barobar) → ↑ 100% ko\'p', () => {
    expect(formatTrend(200, 100)).toBe("↑ 100% ko'p")
  })

  it('real raqamlar (so\'m) bilan ishlaydi', () => {
    // 12.5 mln → 10 mln = 25% kamayish
    expect(formatTrend(10_000_000, 12_500_000)).toBe('↓ 20% kam')
  })
})
