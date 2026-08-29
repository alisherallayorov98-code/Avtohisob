// Kassa smena hisob-kitobi — pure funksiyalar. Kutilgan qoldiq = ochilish
// balansi + shu smenadagi POS sotuvlari yig'indisi (POS sotuvi darhol naqd
// to'langan deb hisoblanadi). Kamomad/ortiqcha = haqiqiy − kutilgan.

const round2 = (n: number): number => Math.round(n * 100) / 100

export function computeExpectedBalance(openingBalance: number, saleTotals: number[]): number {
  const salesSum = saleTotals.reduce((sum, t) => sum + t, 0)
  return round2(openingBalance + salesSum)
}

export function computeDiscrepancy(closingBalance: number, expectedBalance: number): number {
  return round2(closingBalance - expectedBalance)
}
