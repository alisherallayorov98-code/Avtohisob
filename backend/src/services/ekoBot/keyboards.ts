// Tugmalar generatsiyasi (pure). Tugma matni 1-3 so'z; '❌' faqat xato uchun.
// callback_data <= 64 bayt (uuid 36 + prefiks).

import { uzMonth, uzNum } from '../../modules/ekohisob/lib/dateFormat'
import { clip } from './format'
import { Page } from './paginate'

type Btn = Record<string, any>

export function mainKeyboard(role: string | undefined, webAppUrl: string | null, tabUrl?: (base: string, tab: 'map' | 'debtors') => string) {
  const rows: Btn[][] = [
    [{ text: 'Joylashuv yuborish', request_location: true }],
    [{ text: 'Qidirish' }, { text: "Bugungi ro'yxat" }],
  ]
  if (webAppUrl) {
    const u = (t: 'map' | 'debtors') => (tabUrl ? tabUrl(webAppUrl, t) : webAppUrl)
    rows.push([{ text: 'Xarita', web_app: { url: u('map') } }, { text: 'Qarzdorlar', web_app: { url: u('debtors') } }])
  }
  if (role === 'supervisor') rows.push([{ text: 'Mening tumanim' }, { text: 'Plan berish' }])
  else if (role === 'admin') rows.push([{ text: 'Mening hisobotim' }, { text: 'Plan berish' }])
  else rows.push([{ text: 'Mening hisobotim' }])
  rows.push([{ text: 'Menyu' }])
  return { keyboard: rows, resize_keyboard: true, persistent: true }
}

export const cancelKeyboard = () => ({ keyboard: [[{ text: 'Bekor' }]], resize_keyboard: true })

export const menuInline = () => ({
  inline_keyboard: [[{ text: 'Yordam', callback_data: 'm:help' }, { text: 'Til / Тил', callback_data: 'm:lang' }]],
})

export function payQuickKeyboard(i: {
  entityId: string; full: number | null; half: number | null; months: string[]; selectedMonth: string
}) {
  const rows: Btn[][] = []
  const amt: Btn[] = []
  if (i.full) amt.push({ text: `To'liq ${uzNum(i.full)}`, callback_data: `pq:full:${i.entityId}` })
  if (i.half) amt.push({ text: `Yarmi ${uzNum(i.half)}`, callback_data: `pq:half:${i.entityId}` })
  if (amt.length) rows.push(amt)
  rows.push([{ text: 'Boshqa summa', callback_data: `pq:other:${i.entityId}` }])
  if (i.months.length > 1) {
    rows.push(i.months.slice(0, 6).map(m => ({
      text: `${m === i.selectedMonth ? '• ' : ''}${uzMonth(m)}`, callback_data: `pm:${m}`,
    })))
  }
  rows.push([{ text: 'Orqaga', callback_data: `sel:${i.entityId}` }, { text: 'Bekor', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

export function payConfirmKeyboard(entityId: string) {
  return { inline_keyboard: [
    [{ text: 'Ha, yozish', callback_data: 'pok' }, { text: 'Bekor', callback_data: 'cancel' }],
    [{ text: 'Orqaga', callback_data: `pay:${entityId}` }],
  ] }
}

export const duplicateKeyboard = () => ({
  inline_keyboard: [[{ text: 'Baribir yozish', callback_data: 'pforce' }, { text: 'Bekor', callback_data: 'cancel' }]],
})

export function paySuccessKeyboard(i: { entityId: string; remaining: number; verifyUrl: string | null }) {
  const rows: Btn[][] = []
  if (i.remaining > 0) rows.push([{ text: `Yana to'lov`, callback_data: `pay:${i.entityId}` }])
  if (i.verifyUrl) rows.push([{ text: 'Tekshiruv havolasi', url: i.verifyUrl }])
  rows.push([{ text: 'Tayyor', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

export function errorKeyboard(retryData?: string | null) {
  const row: Btn[] = []
  if (retryData && Buffer.byteLength(`rt:${retryData}`) <= 64) row.push({ text: 'Qayta urinish', callback_data: `rt:${retryData}` })
  row.push({ text: 'Bekor', callback_data: 'cancel' })
  return { inline_keyboard: [row] }
}

export function entityCardKeyboard(i: {
  entityId: string; canWrite: boolean; canPay: boolean; talon: boolean; talonPriceSet: boolean
  hasLocation: boolean; lat: number | null; lon: number | null; hasBack: boolean
}) {
  const rows: Btn[][] = []
  if (i.canWrite) {
    if (i.canPay) rows.push([{ text: "To'lov qabul qilish", callback_data: `pay:${i.entityId}` }])
    if (i.talon && i.talonPriceSet) rows.push([{ text: "Talon qo'shish", callback_data: `talon:${i.entityId}` }])
    rows.push([{ text: "To'lamadi", callback_data: `notpaid:${i.entityId}` }])
    if (i.hasLocation) rows.push([{ text: 'Joylashuvni saqlash', callback_data: `saveloc:${i.entityId}` }])
  }
  rows.push([{ text: 'Qarz tarixi', callback_data: `hist:${i.entityId}` }])
  if (i.lat != null && i.lon != null) {
    rows.push([{ text: "Yo'l ko'rsatish", url: `https://www.google.com/maps/dir/?api=1&destination=${i.lat},${i.lon}` }])
  }
  rows.push([i.hasBack ? { text: 'Orqaga', callback_data: 'back:list' } : { text: 'Yopish', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

export function notpaidReasonKeyboard(entityId: string) {
  return { inline_keyboard: [
    [{ text: "Pul yo'q", callback_data: 'npr:cash' }, { text: "Egasi yo'q", callback_data: 'npr:absent' }],
    [{ text: 'Rad etdi', callback_data: 'npr:refused' }, { text: "Keyin to'laydi", callback_data: 'npr:later' }],
    [{ text: 'Boshqa', callback_data: 'npr:other' }],
    [{ text: 'Orqaga', callback_data: `sel:${entityId}` }, { text: 'Bekor', callback_data: 'cancel' }],
  ] }
}

export const notpaidExtraKeyboard = () => ({ inline_keyboard: [
  [{ text: 'Bugundan 3 kun', callback_data: 'npd:3' }, { text: '1 hafta', callback_data: 'npd:7' }, { text: '2 hafta', callback_data: 'npd:14' }],
  [{ text: 'Sana yozish', callback_data: 'npd:txt' }],
  [{ text: "Va'dasiz saqlash", callback_data: 'nps' }, { text: 'Bekor', callback_data: 'cancel' }],
] })

export function pagerRow(p: Page<unknown>, prefix: string): Btn[] {
  const row: Btn[] = []
  if (p.hasPrev) row.push({ text: 'Oldingi', callback_data: `${prefix}:${p.page - 1}` })
  if (p.hasNext) row.push({ text: 'Keyingi', callback_data: `${prefix}:${p.page + 1}` })
  return row
}

export function entityButtons(items: { id: string; label: string }[]): Btn[][] {
  return items.map(e => [{ text: clip(e.label, 48), callback_data: `sel:${e.id}` }])
}
