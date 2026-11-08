// Hisobotlar tepasidagi "Nimaga e'tibor berish kerak" xulosalari (sof mantiq, testlangan).
// "So what?" qoidasi: ma'noli narsa bo'lmasa — ro'yxat bo'sh qaytadi va blok ko'rsatilmaydi.

export interface VehicleAgg {
  id: string
  registrationNumber: string
  cost: number
  prevCost: number | null
  l100: number | null
  normPer100: number | null
}

export interface Totals { total: number; fuel: number; maintenance: number; expenses: number }

export interface Insight {
  level: 'warning' | 'info'
  text: string
  vehicleId?: string
}

export function pctDelta(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null
  return Math.round(((cur - prev) / prev) * 100)
}

const money = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')} mln so'm`
  if (a >= 1_000) return `${Math.round(n / 1_000)} ming so'm`
  return `${Math.round(n)} so'm`
}

const signed = (p: number) => `${p > 0 ? '+' : ''}${p}%`

export const OVER_NORM_PCT = 15
export const TOTAL_CHANGE_PCT = 10

export function buildInsights(input: { vehicles: VehicleAgg[]; cur: Totals; prev: Totals | null }): Insight[] {
  const out: Insight[] = []
  const { vehicles, cur, prev } = input

  // 1) Jami o'zgarish (faqat sezilarli bo'lsa)
  if (prev) {
    const d = pctDelta(cur.total, prev.total)
    if (d != null && Math.abs(d) >= TOTAL_CHANGE_PCT) {
      out.push({
        level: d > 0 ? 'warning' : 'info',
        text: `Jami xarajat oldingi davrga nisbatan ${signed(d)} (${money(prev.total)} → ${money(cur.total)})`,
      })
    }
  }

  // 2) Eng ko'p xarajat qilgan mashina
  const withCost = vehicles.filter(v => v.cost > 0).sort((a, b) => b.cost - a.cost)
  if (withCost.length >= 2 && cur.total > 0) {
    const top = withCost[0]
    const share = Math.round((top.cost / cur.total) * 100)
    const d = top.prevCost != null ? pctDelta(top.cost, top.prevCost) : null
    const dTxt = d != null && Math.abs(d) >= 10 ? `, oldingi davrdan ${signed(d)}` : ''
    if (share >= 15 || (d != null && d >= 30)) {
      out.push({
        level: d != null && d >= 30 ? 'warning' : 'info',
        text: `Eng ko'p xarajat: ${top.registrationNumber} — ${money(top.cost)} (jami xarajatning ${share}%${dTxt})`,
        vehicleId: top.id,
      })
    }
  }

  // 3) Yoqilg'i sarfi me'yordan ortiq mashinalar
  const over = vehicles
    .filter(v => v.l100 != null && v.normPer100 != null && v.normPer100 > 0)
    .map(v => ({ v, pct: Math.round(((v.l100! - v.normPer100!) / v.normPer100!) * 100) }))
    .filter(x => x.pct >= OVER_NORM_PCT)
    .sort((a, b) => b.pct - a.pct)
  if (over.length > 0) {
    const list = over.slice(0, 3).map(x => `${x.v.registrationNumber} (${signed(x.pct)})`).join(', ')
    out.push({
      level: 'warning',
      text: `${over.length} ta mashinada yoqilg'i sarfi me'yordan ${OVER_NORM_PCT}% dan ortiq: ${list}${over.length > 3 ? ' va boshqalar' : ''}`,
      vehicleId: over[0].v.id,
    })
  }

  // 4) Ta'mirlash ulushi yuqori
  if (cur.total > 0 && cur.maintenance > 0) {
    const share = Math.round((cur.maintenance / cur.total) * 100)
    const prevShare = prev && prev.total > 0 ? Math.round((prev.maintenance / prev.total) * 100) : null
    if (share >= 60 && (prevShare == null || share - prevShare >= 10)) {
      out.push({ level: 'info', text: `Xarajatning ${share}% i ta'mirlashga ketgan${prevShare != null ? ` (oldin ${prevShare}%)` : ''}` })
    }
  }

  return out
}
