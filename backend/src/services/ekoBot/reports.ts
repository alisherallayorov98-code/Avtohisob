// Ro'yxat va hisobot matnlari (pure).

import { uzMonth, uzNum } from '../../modules/ekohisob/lib/dateFormat'
import { Page, paginate } from './paginate'
import { clip, esc, head, kv, lines, statusFor, sum, uzTime } from './format'
import { entityButtons, pagerRow } from './keyboards'

export const DAILY_PAGE_SIZE = 8

export interface DailyRow { id: string; name: string; debt: number; mahalla?: string | null; promiseDays?: number | null }

export function promiseTag(days: number | null | undefined): string {
  if (days == null) return ''
  return days <= 0 ? " · va'da bugun" : ` · va'da ${days} kun o'tgan`
}

export function buildDailyPage(i: { rows: DailyRow[]; page: number; collectedToday: number; month: string }) {
  const p: Page<DailyRow> = paginate(i.rows, i.page, DAILY_PAGE_SIZE)
  const top = lines(
    head(statusFor(i.rows.length > 0), "Bugungi ro'yxat"),
    kv('Bugun yig\'ildi', sum(i.collectedToday)) + ` · Qoldi: ${i.rows.length} ta`,
    kv('Oy', uzMonth(i.month)),
  )
  if (i.rows.length === 0) return { text: top + "\nQarzdor yo'q.", reply_markup: { inline_keyboard: [] as any[][] }, page: p }
  const base = p.page * DAILY_PAGE_SIZE
  const body = p.items.map((r, idx) =>
    `${base + idx + 1}. ${esc(r.name)}${r.mahalla ? ` [${esc(r.mahalla)}]` : ''} — ${sum(r.debt)}${promiseTag(r.promiseDays)}`).join('\n')
  const kb = entityButtons(p.items.map((r, idx) => ({ id: r.id, label: `${base + idx + 1}. ${r.name} · ${uzNum(r.debt)}` })))
  const pr = pagerRow(p, 'dl')
  if (pr.length) kb.push(pr)
  kb.push([{ text: 'Yopish', callback_data: 'cancel' }])
  return { text: `${top}\nSahifa: ${p.page + 1} / ${p.pages}\n\n${body}`, reply_markup: { inline_keyboard: kb }, page: p }
}

export interface InspectorRow {
  id: string; name: string; monthSum: number; monthCnt: number; todaySum: number; todayCnt: number
  lastPaidAt: Date | null; planTarget: number | null; newToday: number
}

export function planPercent(newToday: number, target: number | null): number | null {
  if (!target || target <= 0) return null
  return Math.round((newToday * 100) / target)
}

export function buildDistrictReport(i: {
  month: string; totalEnt: number; paidEnts: number; collectedMonth: number; collectedToday: number
  expected: number; inspectors: InspectorRow[]
}) {
  const rate = i.totalEnt > 0 ? Math.round((i.paidEnts * 100) / i.totalEnt) : 0
  const sorted = [...i.inspectors].sort((a, b) => b.monthSum - a.monthSum || a.name.localeCompare(b.name))
  const rows = sorted.map((r, idx) => {
    const pct = planPercent(r.newToday, r.planTarget)
    return `${idx + 1}. ${esc(r.name)} — ${sum(r.monthSum)} (${r.monthCnt} ta)` +
      ` · bugun ${sum(r.todaySum)}` +
      ` · oxirgi: ${r.lastPaidAt ? uzTime(r.lastPaidAt) : "yo'q"}` +
      (pct != null ? ` · plan ${pct}%` : '')
  })
  const text = lines(
    head(statusFor(rate < 100), `Mening tumanim — ${uzMonth(i.month)}`),
    kv('Tashkilotlar', `${i.totalEnt} ta`),
    kv("To'lagan", `${i.paidEnts} ta (${rate}%)`),
    kv("Bu oy yig'ildi", `<b>${sum(i.collectedMonth)}</b>`),
    i.expected > 0 ? kv('Kutilgan', sum(i.expected)) : null,
    kv('Bugun', sum(i.collectedToday)),
    '',
    kv('Inspektorlar', String(sorted.length)),
    rows.length ? rows.join('\n') : "Inspektor biriktirilmagan",
  )
  const kb = sorted.slice(0, 20).map(r => [{ text: clip(r.name, 40), callback_data: `insp:${r.id}` }])
  kb.push([{ text: 'Yopish', callback_data: 'cancel' }])
  return { text, reply_markup: { inline_keyboard: kb } }
}

export function buildInspectorShort(r: InspectorRow, day: string) {
  const pct = planPercent(r.newToday, r.planTarget)
  return lines(
    head('ok', `${r.name} — bugun`),
    kv('Sana', day),
    kv("Yig'ildi", `${sum(r.todaySum)} (${r.todayCnt} ta)`),
    kv('Oxirgi to\'lov', r.lastPaidAt ? uzTime(r.lastPaidAt) : "yo'q"),
    kv('Yangi tashkilot', r.planTarget ? `${r.newToday} / ${r.planTarget}${pct != null ? ` (${pct}%)` : ''}` : String(r.newToday)),
    kv('Bu oy', `${sum(r.monthSum)} (${r.monthCnt} ta)`),
  )
}
