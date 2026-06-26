/**
 * serviceStatus.ts sof funksiyalari testi.
 *
 * Bu testlar 2026-06-26 da kurashilgan ASOSIY xatoni "tosh qotirib" qo'yadi:
 *   - "shkala-aralashuvi": vehicle.mileage (Wialon odometr) va lastServiceKm
 *     (foydalanuvchi bazasi) HAR XIL shkalada bo'lishi mumkin. Langar
 *     (serviceOdometerKm) bo'lsa "joriy km" = baza + (mileage − langar).
 *   - Bu xato yolg'on "muddati o'tdi" Telegram/status berardi.
 *
 * Agar kelajakda kimdir (men yoki boshqa) shu mantiqni buzsa — deploy'gacha
 * CI bu testda to'xtaydi, foydalanuvchi ko'rmaydi.
 */
import { effectiveServiceCurrentKm, computeServiceStatus } from './serviceStatus'

describe('effectiveServiceCurrentKm', () => {
  it('langarsiz (eski yozuv) → vehicle.mileage qaytaradi (orqaga moslik)', () => {
    expect(effectiveServiceCurrentKm(179120, 177336, null)).toBe(179120)
    expect(effectiveServiceCurrentKm(179120, null, null)).toBe(179120)
    expect(effectiveServiceCurrentKm(179120, null, 178711)).toBe(179120)
  })

  it('2026-06-26 real stsenariy: mileage=179120, baza=177336, langar=178711 → 177745', () => {
    // yurgan = 179120 − 178711 = 409;  joriy = 177336 + 409 = 177745
    expect(effectiveServiceCurrentKm(179120, 177336, 178711)).toBe(177745)
  })

  it('hozirgina xizmat qilingan (mileage == langar) → yurgan 0 → baza qaytadi', () => {
    expect(effectiveServiceCurrentKm(178711, 177336, 178711)).toBe(177336)
  })

  it('mashina yurgani sayin joriy km jonli o\'sadi', () => {
    // langar=178711, baza=177336. mileage=179320 → yurgan = 179320−178711 = 609
    expect(effectiveServiceCurrentKm(179320, 177336, 178711)).toBe(177945) // 177336 + 609
  })

  it('mileage langardan past bo\'lsa (g\'ayritabiiy) → manfiyga tushmaydi, baza qaytadi', () => {
    expect(effectiveServiceCurrentKm(178000, 177336, 178711)).toBe(177336)
  })
})

describe('computeServiceStatus', () => {
  it('nextDueKm null → ok', () => {
    expect(computeServiceStatus(null, 500, 180000)).toBe('ok')
  })

  it('joriy km nextDue dan oshgan → overdue', () => {
    expect(computeServiceStatus(187336, 500, 187400)).toBe('overdue')
    expect(computeServiceStatus(187336, 500, 187336)).toBe('overdue')
  })

  it('ogohlantirish zonasi (nextDue − warning ichida) → due_soon', () => {
    expect(computeServiceStatus(187336, 500, 187000)).toBe('due_soon') // 187336-500=186836 <= 187000
  })

  it('hali uzoq → ok', () => {
    expect(computeServiceStatus(187336, 500, 177745)).toBe('ok')
  })

  it('SHKALA XATOSI hujjati: xom mileage yolg\'on overdue beradi, effective to\'g\'ri', () => {
    // nextDue=179000, warning=500. mileage=179120 (Wialon) → noto'g'ri "overdue".
    expect(computeServiceStatus(179000, 500, 179120)).toBe('overdue')
    // Lekin foydalanuvchi shkalasidagi joriy km (baza+GPS=177745) → to'g'ri "ok".
    const eff = effectiveServiceCurrentKm(179120, 177336, 178711) // 177745
    expect(computeServiceStatus(179000, 500, eff)).toBe('ok')
  })
})
