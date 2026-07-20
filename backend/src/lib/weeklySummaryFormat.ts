// Haftalik rahbar xulosasining sof (DB'siz) formatlash mantiqi.
// "So what?" testi: rahbar raqamni emas, YO'NALISHni ko'rishi kerak — o'tgan hafta
// bilan taqqoslash trendi shu yerda hisoblanadi va test bilan qotiriladi.

/**
 * Joriy va oldingi qiymat orasidagi trendni matn ko'rinishida qaytaradi.
 *  - oldingi 0 va joriy > 0 → "yangi" (foiz cheksiz bo'lardi)
 *  - ikkalasi 0 → bo'sh satr (ko'rsatishga arzimaydi)
 *  - ±3% ichida → "≈ o'zgarishsiz" (shovqin darajasidagi farq)
 * Belgi: o'sish ↑, kamayish ↓. Xarajat kontekstida o'sish yomon, shuning uchun
 * chaqiruvchi rang/urg'uni o'zi hal qiladi — bu funksiya faqat faktni beradi.
 */
export function formatTrend(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? 'yangi (o\'tgan hafta bo\'lmagan)' : ''
  }
  if (current === 0) {
    return '↓ 100% (bu hafta yo\'q)'
  }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (Math.abs(pct) <= 3) return '≈ o\'tgan hafta bilan bir xil'
  return pct > 0 ? `↑ ${pct}% ko'p` : `↓ ${Math.abs(pct)}% kam`
}
