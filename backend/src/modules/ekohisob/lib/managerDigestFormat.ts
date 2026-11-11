// Rahbarga Telegram xulosalar — matn formati va tanlash mantig'i (pure, DB'siz, testlanadi).
//
// "So what?" testi: harakat talab qiladigan narsa bo'lmasa xabar YUBORILMAYDI (null qaytadi).
// Kassa va reja foizi — faqat kontekst; ularning o'zi xabar yuborishga sabab emas.
// Sana formati kun.oy.yil (uzDate). Telegram HTML rejimi — nomlar escape qilinadi.

import { uzDate, uzNum, uzMonth } from './dateFormat'
import { shiftMonth, isValidMonth } from './uzt'

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── (a) Ertalabki xulosa ────────────────────────────────────────────────────

export interface DuePromise {
  name: string
  /** va'da qilingan sana "YYYY-MM-DD" */
  promisedDate: string
  /** 0 = bugun, >0 = o'tib ketgan kunlar */
  daysOverdue: number
  debt: number
}

export interface MorningDigestInput {
  /** kecha (UZT) "YYYY-MM-DD" */
  yesterday: string
  yesterdayCollected: number
  yesterdayCount: number
  monthCollected: number
  monthExpected: number
  newCritical: Array<{ name: string; debt: number }>
  idleInspectors: string[]
  promises: DuePromise[]
}

const MAX_LINES = 8

/** Harakat talab qiladigan bo'lim bormi (xabar yuborish sharti). */
export function hasMorningActions(i: MorningDigestInput): boolean {
  return i.newCritical.length > 0 || i.idleInspectors.length > 0 || i.promises.length > 0
}

export function formatManagerMorning(i: MorningDigestInput): string | null {
  if (!hasMorningActions(i)) return null

  let msg = `☀️ <b>Ertalabki xulosa</b>\n\n`
  msg += `💰 Kecha (${uzDate(i.yesterday)}): <b>${uzNum(i.yesterdayCollected)} so'm</b>`
  msg += i.yesterdayCount > 0 ? ` (${i.yesterdayCount} ta to'lov)\n` : `\n`
  if (i.monthExpected > 0) {
    const pct = Math.round((i.monthCollected / i.monthExpected) * 100)
    msg += `📈 Shu oy rejaga nisbatan: <b>${pct}%</b> (${uzNum(i.monthCollected)} / ${uzNum(i.monthExpected)} so'm)\n`
  }

  if (i.newCritical.length > 0) {
    const sorted = [...i.newCritical].sort((a, b) => b.debt - a.debt)
    msg += `\n🔴 <b>Yangi 3+ oy qarzdorlar (${sorted.length})</b>\n`
    sorted.slice(0, MAX_LINES).forEach((c, n) => { msg += `${n + 1}. ${escapeHtml(c.name)} — ${uzNum(c.debt)} so'm\n` })
    if (sorted.length > MAX_LINES) msg += `...va yana ${sorted.length - MAX_LINES} ta\n`
  }

  if (i.promises.length > 0) {
    const sorted = [...i.promises].sort((a, b) => b.daysOverdue - a.daysOverdue || b.debt - a.debt)
    msg += `\n🤝 <b>Va'dasi bugun/o'tgan (${sorted.length})</b>\n`
    sorted.slice(0, MAX_LINES).forEach((p, n) => {
      const when = p.daysOverdue === 0 ? 'bugun' : `${p.daysOverdue} kun o'tdi`
      msg += `${n + 1}. ${escapeHtml(p.name)} — ${uzDate(p.promisedDate)} (${when}), ${uzNum(p.debt)} so'm\n`
    })
    if (sorted.length > MAX_LINES) msg += `...va yana ${sorted.length - MAX_LINES} ta\n`
  }

  if (i.idleInspectors.length > 0) {
    msg += `\n⚠️ <b>Bugun hali hech narsa kiritmagan inspektorlar (${i.idleInspectors.length})</b>\n`
    msg += i.idleInspectors.slice(0, 15).map(escapeHtml).join(', ')
    if (i.idleInspectors.length > 15) msg += ` ...va yana ${i.idleInspectors.length - 15} ta`
    msg += `\n`
  }
  return msg.trimEnd()
}

/**
 * Va'dasi bugun yoki o'tib ketgan tashkilotlar. Har tashkilot uchun ENG OXIRGI va'da olinadi;
 * va'dadan keyin to'lov bo'lgan yoki qarzi qolmagan tashkilot chiqmaydi.
 */
export function selectDuePromises(input: {
  today: string // "YYYY-MM-DD"
  visits: Array<{ entityId: string; promisedDate: string; createdAt: Date | string }>
  entities: Map<string, { name: string; debt: number }>
  /** tashkilotning oxirgi to'lov vaqti (bo'lsa) */
  lastPaymentAt: Map<string, Date | string>
}): DuePromise[] {
  const latest = new Map<string, { promisedDate: string; createdAt: number }>()
  for (const v of input.visits) {
    const c = new Date(v.createdAt).getTime()
    const cur = latest.get(v.entityId)
    if (!cur || c > cur.createdAt) latest.set(v.entityId, { promisedDate: v.promisedDate, createdAt: c })
  }
  const out: DuePromise[] = []
  for (const [entityId, v] of latest) {
    if (v.promisedDate > input.today) continue // hali muddati kelmagan
    const ent = input.entities.get(entityId)
    if (!ent || ent.debt <= 0) continue
    const paid = input.lastPaymentAt.get(entityId)
    if (paid && new Date(paid).getTime() >= v.createdAt) continue // va'dadan keyin to'lagan
    out.push({
      name: ent.name, promisedDate: v.promisedDate, debt: ent.debt,
      daysOverdue: daysBetween(v.promisedDate, input.today),
    })
  }
  return out
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`), b = Date.parse(`${toIso}T00:00:00Z`)
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

// ─── (b) Haftalik: yaqinda to'xtagan eng qimmat mijozlar ─────────────────────

export interface ChurnPaymentRow { entityId: string; name: string; month: string; amount: number }

export interface ChurnedClient {
  entityId: string
  name: string
  /** to'lagan oylardagi o'rtacha oylik to'lov (so'm) */
  avgMonthly: number
  lastPaidMonth: string
  paidMonths: number
}

export interface ChurnOptions {
  /** hozirgi oy "YYYY-MM" (UZT) */
  currentMonth: string
  /** to'xtash oynasi: oxirgi N TO'LIQ oy (+ joriy oy) da to'lov yo'q */
  silentMonths?: number
  /** shundan oldingi N oy tarixi ko'riladi */
  lookbackMonths?: number
  /** tarixda kamida shuncha oy to'lagan bo'lishi shart (doimiy mijoz) */
  minPaidMonths?: number
}

/**
 * Yaqinda to'xtagan mijozlar: tarixda doimiy to'lagan (lookback oyda >= minPaidMonths oy),
 * lekin oxirgi `silentMonths` to'liq oyda va joriy oyda hech narsa to'lamagan.
 * Qimmatligi — tarixdagi o'rtacha oylik to'lov; kamayish tartibida.
 */
export function findChurned(rows: ChurnPaymentRow[], opt: ChurnOptions): ChurnedClient[] {
  if (!isValidMonth(opt.currentMonth)) return []
  const silent = opt.silentMonths ?? 2
  const lookback = opt.lookbackMonths ?? 6
  const minPaid = opt.minPaidMonths ?? 3

  const silentSet = new Set<string>([opt.currentMonth])
  for (let k = 1; k <= silent; k++) silentSet.add(shiftMonth(opt.currentMonth, -k))
  const histEnd = shiftMonth(opt.currentMonth, -silent - 1) // silent oyidan oldingi oxirgi oy
  const histStart = shiftMonth(histEnd, -(lookback - 1))

  type Acc = { name: string; byMonth: Map<string, number>; silentPaid: boolean }
  const acc = new Map<string, Acc>()
  for (const r of rows) {
    if (!(r.amount > 0)) continue
    const a = acc.get(r.entityId) ?? { name: r.name, byMonth: new Map(), silentPaid: false }
    if (silentSet.has(r.month)) a.silentPaid = true
    else if (r.month >= histStart && r.month <= histEnd) a.byMonth.set(r.month, (a.byMonth.get(r.month) ?? 0) + r.amount)
    acc.set(r.entityId, a)
  }

  const out: ChurnedClient[] = []
  for (const [entityId, a] of acc) {
    if (a.silentPaid || a.byMonth.size < minPaid) continue
    const total = [...a.byMonth.values()].reduce((s, x) => s + x, 0)
    out.push({
      entityId, name: a.name,
      avgMonthly: Math.round(total / a.byMonth.size),
      lastPaidMonth: [...a.byMonth.keys()].sort().slice(-1)[0],
      paidMonths: a.byMonth.size,
    })
  }
  return out.sort((x, y) => y.avgMonthly - x.avgMonthly || (x.entityId < y.entityId ? -1 : 1))
}

export function formatChurnWeekly(clients: ChurnedClient[], limit = 10): string | null {
  if (clients.length === 0) return null
  const top = clients.slice(0, limit)
  const lostMonthly = clients.reduce((s, c) => s + c.avgMonthly, 0)
  let msg = `📉 <b>Yaqinda to'xtagan mijozlar</b>\n\n`
  msg += `Doimiy to'lagan, lekin oxirgi oylarda to'lamayotgan <b>${clients.length}</b> ta mijoz.\n`
  msg += `Oylik taxminiy yo'qotish: <b>${uzNum(lostMonthly)} so'm</b>\n\n`
  top.forEach((c, n) => {
    msg += `${n + 1}. ${escapeHtml(c.name)} — oyiga ~${uzNum(c.avgMonthly)} so'm, oxirgi to'lov: ${uzMonth(c.lastPaidMonth)}\n`
  })
  if (clients.length > limit) msg += `\n...va yana ${clients.length - limit} ta`
  msg += `\n\n📍 Borib sababini aniqlang: shartnoma bekor qilinganmi yoki shunchaki unutilganmi.`
  return msg
}
