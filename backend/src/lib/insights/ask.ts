// Tahlil — savol-javob ("30 574 OBA qachon motor remont bo'lgan?").
// Tashqi AI YO'Q: savoldan mashina, davr va niyat qoidalar bilan ajratiladi, javob esa
// Snapshot'dagi aniq yozuvlardan hisoblanadi (raqamni "o'ylab topish" xavfi yo'q).
// Tushunilmagan savolga taxmin bilan javob berilmaydi — namunalar ko'rsatiladi.
import type { FindingOut, VehicleSnap, MaintSnap } from './types'
import {
  type Ctx, DAY_MS, fmtDate, fmtNum, fmtUzs, maintText, maintTotal, consumption, median,
} from './context'
import { normalizePlate, isEnginePart, isFuelSystemPart } from './keywords'
import { effectiveServiceCurrentKm } from '../serviceStatus'
import { cyrillicToLatin } from '../transliterate'

export interface Answer {
  understood: boolean
  intent: string
  title: string
  text: string
  table?: { columns: string[]; rows: Array<Array<string | number>> }
  links?: Array<{ label: string; path: string }>
  vehicleId?: string
  suggestions?: string[]
}

interface Period { from: Date; to: Date; label: string }

const UZ = 5 * 3600 * 1000
const MAX_ROWS = 30

// ─── Matnni tayyorlash ────────────────────────────────────────────────────────

export function normalizeQuery(q: string): string {
  return cyrillicToLatin(q)
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const RX = {
  help: /(yordam|nima so'ra|qanday savol|nimalarni so'ra|misol|namuna|imkoniyat)/,
  engine: /(motor|dvigatel|kapital|kapremont|porshen|gbts|blok golovka)/,
  oil: /(\bmoy|yog'|\bmasl|\boil\b)/,
  filter: /filt/,
  fuel: /(yoqilg|yoqilgi|benzin|dizel|solyarka|\bgaz\b|metan|propan|zapravka|quyil|quydi|\blitr|toplivo)/,
  consumption: /(sarf|rasxod|100 ?km|normadan|norma\b)/,
  km: /(\bkm\b|kilometr|yurdi|yurgan|yurish|masofa|probeg)/,
  repair: /(ta'mir|tamir|remont|almashtir|nima qilingan|nima ish|zapchast|ehtiyot qism|\bqism)/,
  cost: /(xarajat|harajat|\bpul\b|so'm|\bsum\b|qancha ketgan|sarflangan pul|narx|qimmat)/,
  docs: /(sug'urta|sugurta|strax|texosmotr|texko'rik|tex ko'rik|hujjat|dokument|ruxsatnoma)/,
  tires: /(shina|balon|g'ildirak|rezina)/,
  problem: /(muammo|kamchilik|savollar|\bsavol\b|nima qilish kerak|e'tibor|xavf|diqqat|muhim)/,
  gps: /(\bgps|signal|treker|joylashuv)/,
  inspection: /(tekshiruv|osmotr|\bko'rik)/,
  waybill: /(yo'l varaqa|varaqa|putyovka|putevoy|putevka)/,
  idle: /(ishlamay|turib|harakatsiz|qo'zg'alma|bekor tur|yurmay)/,
  count: /\bnechta\s(\S+\s)?(mashina|texnika|avto|transport)|\bqancha (mashina|texnika)|(mashina|texnika)lar(imiz)? soni/,
  most: /(eng ko'p|eng katta|eng yuqori|eng qimmat|\btop\b|reyting|ko'p yoq|ko'p sarfla|ko'p yur)/,
  least: /(eng kam|eng oz|kam yurgan|kam ishlat|eng past)/,
  total: /(jami|umumiy|hammasi|butun)/,
  when: /(qachon|oxirgi marta|so'nggi marta|necha marta)/,
  worker: /\busta\b|\bustasi\b|\bmaster\b/,
  due: /(muddati|o'tib ketgan|kechik|almashtirish kerak|vaqti kel|qolgan|qoldi|tugay|tugag)/,
  battery: /(akkumulyator|akb\b|akkumlyator)/,
}

const STOP = new Set([
  'qachon', 'oxirgi', 'marta', "so'nggi", 'necha', 'qancha', 'nechta', 'bilan', 'uchun', 'mashina', 'mashinasi', 'mashinaga',
  'mashinada', 'almashtirilgan', 'almashtirildi', 'almashtirish', 'almashgan', 'qilingan', 'qilindi', "bo'lgan", "bo'ldi",
  'nima', 'qaysi', 'kerak', 'edi', 'bormi', 'yoqmi', 'haqida', 'malumot', "ma'lumot", 'korsat', "ko'rsat", 'ber', 'bering',
  'ayting', 'ayt', 'ta\'mir', 'tamir', 'remont', 'qism', 'qismi', 'detal', 'detali', 'texnika', 'avto', 'oyda', 'kunda', 'yilda',
  'shu', 'bu', 'ham', 'yana', 'endi', 'hozir', 'bugun', 'kecha', 'hafta', 'haftada', 'oy', 'yil', 'kun',
  'qanday', 'ketdi', 'ketgan', 'olindi', 'olingan', 'ishlatildi', 'ishlatilgan', 'qildi', 'tushdi', 'sarflandi', 'jami',
  'oxirgi', "o'tgan", 'oyida', 'mashinalar', 'mashinalarda', 'barcha', 'hamma', 'umumiy',
])

// ─── Davr ────────────────────────────────────────────────────────────────────

const MONTHS: Array<[RegExp, number]> = [
  [/\byanvar/, 0], [/\bfevral/, 1], [/\bmart(da|dagi|ida|oyi|oyida)?\b/, 2], [/\baprel/, 3], [/\bmay(da|dagi|ida|oyi|oyida)?\b/, 4],
  [/\biyun/, 5], [/\biyul/, 6], [/\bavgust/, 7], [/\bsent[ay]?abr/, 8], [/\bokt[ay]?abr/, 9], [/\bnoyabr/, 10], [/\bdekabr/, 11],
]

function uzStartOfDay(d: Date): Date {
  const u = new Date(d.getTime() + UZ)
  return new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()) - UZ)
}
function uzMonthStart(d: Date, offset = 0): Date {
  const u = new Date(d.getTime() + UZ)
  return new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth() + offset, 1) - UZ)
}

export function parsePeriod(qn: string, now: Date): Period | null {
  const today = uzStartOfDay(now)
  if (/\bbugun/.test(qn)) return { from: today, to: now, label: 'bugun' }
  if (/\bkecha/.test(qn)) return { from: new Date(today.getTime() - DAY_MS), to: new Date(today.getTime() - 1), label: 'kecha' }
  if (/o'tgan hafta/.test(qn)) {
    const dow = (new Date(today.getTime() + UZ).getUTCDay() + 6) % 7
    const mon = new Date(today.getTime() - dow * DAY_MS)
    return { from: new Date(mon.getTime() - 7 * DAY_MS), to: new Date(mon.getTime() - 1), label: "o'tgan hafta" }
  }
  if (/bu hafta|shu hafta/.test(qn)) {
    const dow = (new Date(today.getTime() + UZ).getUTCDay() + 6) % 7
    return { from: new Date(today.getTime() - dow * DAY_MS), to: now, label: 'bu hafta' }
  }
  if (/o'tgan oy/.test(qn)) return { from: uzMonthStart(now, -1), to: new Date(uzMonthStart(now).getTime() - 1), label: "o'tgan oy" }
  if (/bu oy|shu oy|joriy oy/.test(qn)) return { from: uzMonthStart(now), to: now, label: 'bu oy' }
  if (/o'tgan yil/.test(qn)) {
    const y = new Date(now.getTime() + UZ).getUTCFullYear() - 1
    return { from: new Date(Date.UTC(y, 0, 1) - UZ), to: new Date(Date.UTC(y + 1, 0, 1) - UZ - 1), label: "o'tgan yil" }
  }
  if (/bu yil|shu yil|joriy yil/.test(qn)) {
    const y = new Date(now.getTime() + UZ).getUTCFullYear()
    return { from: new Date(Date.UTC(y, 0, 1) - UZ), to: now, label: 'bu yil' }
  }
  const nDays = qn.match(/(\d+)\s*(kun|kunda|kunlik)\b/)
  if (nDays) return { from: new Date(now.getTime() - Number(nDays[1]) * DAY_MS), to: now, label: `oxirgi ${nDays[1]} kun` }
  const nWeeks = qn.match(/(\d+)\s*(hafta|haftada)\b/)
  if (nWeeks) return { from: new Date(now.getTime() - Number(nWeeks[1]) * 7 * DAY_MS), to: now, label: `oxirgi ${nWeeks[1]} hafta` }
  const nMonths = qn.match(/(\d+)\s*(oy|oyda|oylik)\b/)
  if (nMonths) return { from: new Date(now.getTime() - Number(nMonths[1]) * 30 * DAY_MS), to: now, label: `oxirgi ${nMonths[1]} oy` }
  for (const [rx, m] of MONTHS) {
    if (!rx.test(qn)) continue
    const u = new Date(now.getTime() + UZ)
    const y = m <= u.getUTCMonth() ? u.getUTCFullYear() : u.getUTCFullYear() - 1
    const from = new Date(Date.UTC(y, m, 1) - UZ)
    const to = new Date(Math.min(now.getTime(), Date.UTC(y, m + 1, 1) - UZ - 1))
    return { from, to, label: `${fmtDate(from).slice(3)} oyi` }
  }
  return null
}

const defaultPeriod = (now: Date, days: number, label?: string): Period =>
  ({ from: new Date(now.getTime() - days * DAY_MS), to: now, label: label || `oxirgi ${days} kun` })
const monthPeriod = (now: Date): Period => ({ from: uzMonthStart(now), to: now, label: 'bu oy' })

function topN(qn: string, def = 10): number {
  const m = qn.match(/(\d+)\s*(ta|tasi)\b/) || qn.match(/\btop\s*(\d+)/)
  const n = m ? Number(m[1]) : def
  return Math.min(Math.max(n, 1), MAX_ROWS)
}

// ─── Mashinani topish ────────────────────────────────────────────────────────

/** Savoldagi davr/son ifodalarini olib tashlaymiz — "30 kun" mashina raqami emas */
function stripNonPlateNumbers(qn: string): string {
  return qn
    .replace(/\d+\s*(kun|kunda|kunlik|oy|oyda|oylik|hafta|haftada|ta|tasi|km|litr|l\b|so'm|mln|ming|yil|yilda|marta|%|foiz)\b/g, ' ')
    .replace(/\btop\s*\d+/g, ' ')
}

export function findVehicles(qn: string, vehicles: VehicleSnap[]): VehicleSnap[] {
  const cleaned = stripNonPlateNumbers(qn)
  const compact = normalizePlate(cleaned)
  const exact = vehicles.filter(v => {
    const np = normalizePlate(v.plate)
    return np.length >= 5 && compact.includes(np)
  })
  if (exact.length) return exact
  // "30 574" → "30574"; eng uzun raqamli bo'lak bo'yicha qidiramiz
  const joined = cleaned.replace(/(\d)\s+(?=\d)/g, '$1')
  const nums = (joined.match(/\d{3,}/g) || []).sort((a, b) => b.length - a.length)
  for (const n of nums) {
    const hits = vehicles.filter(v => normalizePlate(v.plate).replace(/\D/g, '').includes(n))
    if (hits.length) return hits
  }
  return []
}

// ─── Javob yasovchilar ───────────────────────────────────────────────────────

const dossier = (v: VehicleSnap) => ({ label: `${v.plate} — to'liq dosye`, path: `/insights/vehicle/${v.id}` })
const inP = (d: Date, p: Period) => d >= p.from && d <= p.to
const unitOf = (ft: string) => (ft === 'gas' ? 'm³' : 'L')

function windowNote(p: Period, c: Ctx, days: number, what: string): string {
  return p.from < c.ago(days) ? ` (Diqqat: ${what} tahlilda faqat oxirgi ${Math.round(days / 30)} oy bor.)` : ''
}

function partHits(c: Ctx, vid: string | null, tokens: string[], p?: Period): Array<{ m: MaintSnap; name: string; qty: number; cost: number }> {
  const out: Array<{ m: MaintSnap; name: string; qty: number; cost: number }> = []
  const ms = vid ? (c.maintByV.get(vid) || []) : c.s.maintenance.filter(m => m.status !== 'rejected' && c.vehicle.has(m.vehicleId))
  for (const m of ms) {
    if (m.status === 'rejected' || (p && !inP(m.date, p))) continue
    const names = m.parts.length ? m.parts : [{ name: m.notes || '', qty: 1, unitCost: maintTotal(m), sparePartId: null, category: null }]
    for (const part of names) {
      const n = normalizeQuery(part.name)
      if (tokens.some(t => n.includes(t))) out.push({ m, name: part.name, qty: part.qty, cost: part.unitCost * part.qty })
    }
  }
  return out.sort((a, b) => b.m.date.getTime() - a.m.date.getTime())
}

/** Mavzu so'zlari (yoqilg'i, km, xarajat...) qism nomi sifatida qidirilmaydi — "yoqilg'i ketdi" ≠ "yoqilg'i filtri" */
const TOPIC_WORDS: RegExp[] = [RX.fuel, RX.km, RX.cost, RX.total, RX.consumption, RX.docs, RX.gps, RX.problem, RX.most, RX.least, RX.idle, RX.when, RX.waybill, RX.inspection]

function partTokens(qn: string): string[] {
  return stripNonPlateNumbers(qn)
    .replace(/[?!.,;:()"]/g, ' ')
    .split(' ')
    .map(w => w.replace(/(larni|ning|lar|dan|ni|si|ga|da|i)$/, ''))
    .filter(w => w.length >= 4 && !STOP.has(w) && !/\d/.test(w) && !TOPIC_WORDS.some(rx => rx.test(w)))
}

const USAGE_VERB = /(ishlatil|olindi|sarfi|sarflandi|nechta|qancha|almashtiril)/

function vOverview(c: Ctx, v: VehicleSnap, findings: FindingOut[]): Answer {
  const oil = c.intervalsByV.get(v.id)?.get('oil_change')
  const oilLeft = oil?.nextDueKm != null ? oil.nextDueKm - effectiveServiceCurrentKm(v.mileage, oil.lastServiceKm, oil.serviceOdometerKm) : null
  const cs = consumption(c, v.id, c.ago(30), c.now)
  const km30 = c.kmBetween(v.id, c.ago(30), c.now)
  const lastRepair = (c.maintByV.get(v.id) || []).slice(-1)[0]
  const mine = findings.filter(f => f.vehicleId === v.id)
  const STATUS: Record<string, string> = { active: 'Faol', maintenance: "Ta'mirda", inactive: 'Nofaol' }
  return {
    understood: true, intent: 'v_overview', vehicleId: v.id,
    title: `${v.plate} — ${v.brand} ${v.model}, ${v.year}`,
    text: mine.length ? `Bu mashina bo'yicha ${mine.length} ta ochiq savol bor (${mine.filter(f => f.severity === 'critical').length} ta kritik).` : "Bu mashina bo'yicha ochiq savol yo'q.",
    table: {
      columns: ["Ko'rsatkich", 'Qiymat'],
      rows: [
        ['Holati', STATUS[v.status] || v.status],
        ['Probeg', `${fmtNum(v.mileage)} km`],
        ['Oxirgi 30 kun', km30 != null ? `${fmtNum(km30)} km (GPS)` : 'GPS ma\'lumoti yo\'q'],
        ["Yoqilg'i sarfi (30 kun)", cs ? `${fmtNum(cs.per100, 1)} /100km${v.fuelNorm ? ` (norma ${fmtNum(v.fuelNorm, 1)})` : ''}` : "Ma'lumot yetarli emas"],
        ['Motor moyi', oil ? (oilLeft != null ? (oilLeft >= 0 ? `${fmtNum(oilLeft)} km qoldi` : `${fmtNum(-oilLeft)} km o'tib ketgan`) : `Oxirgi: ${fmtDate(oil.lastServiceDate)}`) : 'Nazorat yo\'q'],
        ["Sug'urta", v.insuranceExpiry ? fmtDate(v.insuranceExpiry) : 'kiritilmagan'],
        ['Texosmotr', v.techInspectionExpiry ? fmtDate(v.techInspectionExpiry) : 'kiritilmagan'],
        ["Oxirgi ta'mir", lastRepair ? `${fmtDate(lastRepair.date)} — ${fmtUzs(maintTotal(lastRepair))}` : 'yo\'q'],
      ],
    },
    links: [dossier(v)],
    suggestions: [`${v.plate} qachon motor remont bo'lgan?`, `${v.plate} moyi qachon almashtirilgan?`, `${v.plate} bu oy qancha yoqilg'i oldi?`],
  }
}

function vEngine(c: Ctx, v: VehicleSnap): Answer {
  const recs = [...(c.engineByV.get(v.id) || [])].reverse()
  const TYPE: Record<string, string> = { overhaul: 'Kapital', major_repair: "Yirik ta'mir", minor_repair: "Kichik ta'mir", inspection: "Ko'rik" }
  const covered = (d: Date) => recs.some(e => Math.abs(e.date.getTime() - d.getTime()) <= 30 * DAY_MS)
  const fromMaint = (c.maintByV.get(v.id) || [])
    .filter(m => m.status === 'approved' && (isEnginePart(maintText(m)) || isFuelSystemPart(maintText(m))) && !covered(m.date))
    .reverse()
  const lastOverhaul = recs.find(e => e.type === 'overhaul')
  const rows: Array<Array<string | number>> = [
    ...recs.map(e => [fmtDate(e.date), TYPE[e.type] || e.type, fmtNum(e.mileage), e.cost ? fmtNum(e.cost) : '—', 'Pasportda']),
    ...fromMaint.map(m => [fmtDate(m.date), "Ta'mirda dvigatel detali", m.mileage ? fmtNum(m.mileage) : '—', fmtNum(maintTotal(m)), "Pasportda YO'Q"]),
  ].slice(0, MAX_ROWS)
  let text: string
  if (!recs.length && !fromMaint.length) text = `${v.plate} bo'yicha dvigatel ta'miri haqida hech qanday yozuv yo'q — na Dvigatel pasportida, na ta'mirlarda.`
  else {
    text = lastOverhaul
      ? `Oxirgi kapital ta'mir: ${fmtDate(lastOverhaul.date)}, ${fmtNum(lastOverhaul.mileage)} km${lastOverhaul.cost ? `, ${fmtUzs(lastOverhaul.cost)}` : ''}.`
      : recs.length ? `Kapital ta'mir yozilmagan; oxirgi dvigatel yozuvi ${fmtDate(recs[0].date)}.` : 'Dvigatel pasporti bo\'sh.'
    if (fromMaint.length) text += ` Diqqat: ${fromMaint.length} ta ta'mirda dvigatel detali ishlatilgan, lekin pasportga kiritilmagan (oxirgisi ${fmtDate(fromMaint[0].date)}).`
  }
  return {
    understood: true, intent: 'v_engine', vehicleId: v.id, title: `${v.plate} — dvigatel tarixi`, text,
    table: rows.length ? { columns: ['Sana', 'Turi', 'Km', 'Narx', 'Holat'], rows } : undefined,
    links: [{ label: 'Dvigatel pasporti', path: '/engine-monitor' }, dossier(v)],
  }
}

function vService(c: Ctx, v: VehicleSnap, types: string[], title: string): Answer {
  const NAMES: Record<string, string> = { oil_change: 'Motor moyi', oil_filter: 'Moy filtri', air_filter: 'Havo filtri', fuel_filter: "Yoqilg'i filtri", gearbox_oil: 'Korobka moyi' }
  const rows: Array<Array<string | number>> = []
  const lines: string[] = []
  for (const t of types) {
    const it = c.intervalsByV.get(v.id)?.get(t)
    if (!it) { lines.push(`${NAMES[t] || t}: nazorat yo'q.`); continue }
    const cur = effectiveServiceCurrentKm(v.mileage, it.lastServiceKm, it.serviceOdometerKm)
    const left = it.nextDueKm != null ? it.nextDueKm - cur : null
    lines.push(`${NAMES[t] || t}: oxirgi ${fmtDate(it.lastServiceDate)}${it.lastServiceKm != null ? ` (${fmtNum(it.lastServiceKm)} km)` : ''}` +
      (left != null ? (left >= 0 ? `, keyingisiga ${fmtNum(left)} km qoldi.` : `, muddat ${fmtNum(-left)} km O'TIB KETGAN.`) : '.'))
  }
  for (const r of [...(c.serviceByV.get(v.id) || [])].reverse()) {
    if (!types.includes(r.serviceType)) continue
    rows.push([fmtDate(r.date), NAMES[r.serviceType] || r.serviceType, fmtNum(r.km), r.cost ? fmtNum(r.cost) : '—'])
    if (rows.length >= 10) break
  }
  return {
    understood: true, intent: 'v_service', vehicleId: v.id, title: `${v.plate} — ${title}`, text: lines.join(' '),
    table: rows.length ? { columns: ['Sana', 'Xizmat', 'Km', 'Narx'], rows } : undefined,
    links: [{ label: "Motor yog'i bo'limi", path: '/oil-change' }, dossier(v)],
  }
}

function vPart(c: Ctx, v: VehicleSnap, tokens: string[], qn: string): Answer | null {
  const toks = RX.battery.test(qn) ? ['akkumul', 'аккумул', 'akb'] : tokens
  if (!toks.length) return null
  const hits = partHits(c, v.id, toks)
  if (!hits.length) return null
  const last = hits[0]
  return {
    understood: true, intent: 'v_part', vehicleId: v.id,
    title: `${v.plate} — "${toks[0]}" tarixi`,
    text: `Oxirgi marta ${fmtDate(last.m.date)} da${last.m.mileage ? `, ${fmtNum(last.m.mileage)} km'da` : ''} "${last.name}" almashtirilgan${last.m.workerName ? ` (usta: ${last.m.workerName})` : ''}. ` +
      `Tahlil davrida jami ${hits.length} marta.`,
    table: { columns: ['Sana', 'Qism', 'Km', 'Usta', 'Narx'], rows: hits.slice(0, MAX_ROWS).map(h => [fmtDate(h.m.date), h.name, h.m.mileage ? fmtNum(h.m.mileage) : '—', h.m.workerName || '—', fmtNum(h.cost)]) },
    links: [{ label: "Ta'mirlar", path: '/maintenance' }, dossier(v)],
  }
}

function vFuel(c: Ctx, v: VehicleSnap, p: Period): Answer {
  const recs = (c.fuelByV.get(v.id) || []).filter(r => inP(r.date, p))
  const liters = recs.reduce((s, r) => s + r.liters, 0)
  const cost = recs.reduce((s, r) => s + r.cost, 0)
  return {
    understood: true, intent: 'v_fuel', vehicleId: v.id, title: `${v.plate} — yoqilg'i (${p.label})`,
    text: recs.length
      ? `${recs.length} marta quyilgan: jami ${fmtNum(liters, 1)} ${unitOf(v.fuelType)}, ${fmtUzs(cost)}.${windowNote(p, c, 180, "yoqilg'i")}`
      : `${p.label} davomida yoqilg'i yozuvi yo'q.${windowNote(p, c, 180, "yoqilg'i")}`,
    table: recs.length ? { columns: ['Sana', 'Miqdor', 'Odometr', 'Summa'], rows: [...recs].reverse().slice(0, MAX_ROWS).map(r => [fmtDate(r.date), fmtNum(r.liters, 1), r.odometer > 0 ? fmtNum(r.odometer) : '—', fmtNum(r.cost)]) } : undefined,
    links: [{ label: "Yoqilg'i yozuvlari", path: '/fuel' }, dossier(v)],
  }
}

function vConsumption(c: Ctx, v: VehicleSnap, p: Period): Answer {
  const cs = consumption(c, v.id, p.from, p.to)
  const peers = c.active.filter(x => x.brand === v.brand && x.model === v.model && x.id !== v.id)
    .map(x => consumption(c, x.id, p.from, p.to)?.per100).filter((x): x is number => x != null)
  const med = peers.length >= 2 ? median(peers) : null
  let text = cs
    ? `${p.label}: ${fmtNum(cs.km)} km, ${fmtNum(cs.liters, 1)} ${unitOf(v.fuelType)} → ${fmtNum(cs.per100, 1)} /100km.`
    : `${p.label} uchun sarfni hisoblash uchun ma'lumot yetarli emas (kamida 2 ta quyish va 300 km kerak).`
  if (cs && v.fuelNorm) text += ` Norma ${fmtNum(v.fuelNorm, 1)} — ${cs.per100 > v.fuelNorm ? `${Math.round((cs.per100 / v.fuelNorm - 1) * 100)}% ortiq` : 'normada'}.`
  if (cs && med) text += ` Shu modeldagi boshqa ${peers.length} ta mashina medianasi: ${fmtNum(med, 1)}.`
  return { understood: true, intent: 'v_consumption', vehicleId: v.id, title: `${v.plate} — yoqilg'i sarfi`, text, links: [{ label: 'Sarf tahlili', path: '/fuel-consumption' }, dossier(v)] }
}

function vKm(c: Ctx, v: VehicleSnap, p: Period): Answer {
  const km = c.kmBetween(v.id, p.from, p.to)
  const days = Math.max(1, Math.round((p.to.getTime() - p.from.getTime()) / DAY_MS))
  return {
    understood: true, intent: 'v_km', vehicleId: v.id, title: `${v.plate} — yurgan masofa (${p.label})`,
    text: km != null
      ? `GPS bo'yicha ${fmtNum(km)} km (kuniga o'rtacha ${fmtNum(km / days)} km). Joriy probeg: ${fmtNum(v.mileage)} km.`
      : `Bu davr uchun GPS ma'lumoti yo'q. Joriy probeg: ${fmtNum(v.mileage)} km.`,
    links: [{ label: 'GPS', path: '/gps' }, dossier(v)],
  }
}

function vRepairs(c: Ctx, v: VehicleSnap, p: Period): Answer {
  const ms = (c.maintByV.get(v.id) || []).filter(m => inP(m.date, p)).reverse()
  const total = ms.reduce((s, m) => s + maintTotal(m), 0)
  return {
    understood: true, intent: 'v_repairs', vehicleId: v.id, title: `${v.plate} — ta'mirlar (${p.label})`,
    text: ms.length ? `${ms.length} ta ta'mir, jami ${fmtUzs(total)}.` : `${p.label} davomida ta'mir yozuvi yo'q.`,
    table: ms.length ? { columns: ['Sana', 'Ish / qismlar', 'Usta', 'Summa'], rows: ms.slice(0, MAX_ROWS).map(m => [fmtDate(m.date), (m.parts.map(x => x.name).join(', ') || m.notes || '—').slice(0, 90), m.workerName || '—', fmtNum(maintTotal(m))]) } : undefined,
    links: [{ label: "Ta'mirlar", path: '/maintenance' }, dossier(v)],
  }
}

function vCost(c: Ctx, v: VehicleSnap, p: Period): Answer {
  const fuel = (c.fuelByV.get(v.id) || []).filter(r => inP(r.date, p)).reduce((s, r) => s + r.cost, 0)
  const maint = (c.maintByV.get(v.id) || []).filter(m => m.status === 'approved' && inP(m.date, p)).reduce((s, m) => s + maintTotal(m), 0)
  const exp = (c.expensesByV.get(v.id) || []).filter(e => inP(e.date, p)).reduce((s, e) => s + e.amount, 0)
  const total = fuel + maint + exp
  const km = c.kmBetween(v.id, p.from, p.to)
  return {
    understood: true, intent: 'v_cost', vehicleId: v.id, title: `${v.plate} — xarajatlar (${p.label})`,
    text: `Jami ${fmtUzs(total)}${km && km > 0 ? `, 1 km ≈ ${fmtNum(total / km)} so'm` : ''}.${windowNote(p, c, 180, "yoqilg'i")}`,
    table: { columns: ['Turi', 'Summa'], rows: [["Yoqilg'i", fmtNum(fuel)], ["Ta'mir", fmtNum(maint)], ['Boshqa xarajatlar', fmtNum(exp)]] },
    links: [dossier(v)],
  }
}

function vDocs(c: Ctx, v: VehicleSnap): Answer {
  const left = (d: Date | null) => (d ? Math.ceil((d.getTime() - c.now.getTime()) / DAY_MS) : null)
  const line = (name: string, d: Date | null) => {
    const l = left(d)
    return [name, d ? fmtDate(d) : 'kiritilmagan', l == null ? '—' : l < 0 ? `${-l} kun o'tgan` : `${l} kun qoldi`]
  }
  const warr = c.s.warranties.filter(w => w.vehicleId === v.id && w.endDate >= c.now)
  return {
    understood: true, intent: 'v_docs', vehicleId: v.id, title: `${v.plate} — hujjatlar`,
    text: `Sug'urta va texosmotr muddatlari${warr.length ? `, ${warr.length} ta amaldagi kafolat` : ''}.`,
    table: { columns: ['Hujjat', 'Muddat', 'Holat'], rows: [line("Sug'urta", v.insuranceExpiry), line('Texosmotr', v.techInspectionExpiry), ...warr.map(w => line(`Kafolat: ${w.partName}`, w.endDate))] },
    links: [{ label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` }],
  }
}

function vTires(c: Ctx, v: VehicleSnap): Answer {
  const ts = (c.tiresByV.get(v.id) || []).filter(t => t.status === 'installed')
  return {
    understood: true, intent: 'v_tires', vehicleId: v.id, title: `${v.plate} — shinalar`,
    text: ts.length ? `${ts.length} ta shina o'rnatilgan.` : "Shina biriktirilmagan.",
    table: ts.length ? { columns: ['Joyi', 'Seriya', "O'rnatilgan km", 'Yurgan', 'Norma'], rows: ts.map(t => [t.position || '—', t.serial, t.installedMileageKm != null ? fmtNum(t.installedMileageKm) : '—', t.installedMileageKm != null ? fmtNum(Math.max(0, v.mileage - t.installedMileageKm)) : '—', fmtNum(t.standardMileageKm)]) } : undefined,
    links: [{ label: 'Shinalar', path: '/tires' }],
  }
}

function vProblems(v: VehicleSnap, findings: FindingOut[]): Answer {
  const mine = findings.filter(f => f.vehicleId === v.id)
  const SEV: Record<string, string> = { critical: 'Kritik', warning: 'Diqqat', info: "Ma'lumot" }
  return {
    understood: true, intent: 'v_problems', vehicleId: v.id, title: `${v.plate} — ochiq savollar`,
    text: mine.length ? `${mine.length} ta ochiq savol.` : "Bu mashina bo'yicha ochiq savol yo'q.",
    table: mine.length ? { columns: ['Daraja', 'Savol'], rows: mine.slice(0, MAX_ROWS).map(f => [SEV[f.severity], f.title]) } : undefined,
    links: [dossier(v)],
  }
}

function vGps(c: Ctx, v: VehicleSnap): Answer {
  const km7 = c.kmBetween(v.id, c.ago(7), c.now)
  return {
    understood: true, intent: 'v_gps', vehicleId: v.id, title: `${v.plate} — GPS`,
    text: !c.isGpsLinked(v) ? "Mashina GPS trekeriga bog'lanmagan."
      : `Oxirgi signal: ${v.lastGpsSignal ? `${fmtDate(v.lastGpsSignal)} (${c.daysSince(v.lastGpsSignal)} kun oldin)` : "noma'lum"}.${km7 != null ? ` Oxirgi 7 kunda ${fmtNum(km7)} km.` : ''}`,
    links: [{ label: 'GPS', path: '/gps' }],
  }
}

function vInspection(c: Ctx, v: VehicleSnap): Answer {
  const ins = c.inspByV.get(v.id) || []
  const ST: Record<string, string> = { ok: 'Yaxshi', warning: 'Ogohlantirish', critical: 'Kritik' }
  return {
    understood: true, intent: 'v_inspection', vehicleId: v.id, title: `${v.plate} — texnik tekshiruvlar`,
    text: ins.length ? `Oxirgi tekshiruv: ${fmtDate(ins[0].date)} — ${ST[ins[0].overall] || ins[0].overall}.` : "Oxirgi yilda texnik tekshiruv yozuvi yo'q.",
    table: ins.length ? { columns: ['Sana', 'Umumiy', 'Tormoz'], rows: ins.slice(0, 12).map(i => [fmtDate(i.date), ST[i.overall] || i.overall, ST[i.brakes] || i.brakes]) } : undefined,
    links: [{ label: 'Texnik tekshiruv', path: '/inspections' }],
  }
}

function vWaybills(c: Ctx, v: VehicleSnap, p: Period): Answer {
  const ws = (c.waybillsByV.get(v.id) || []).filter(w => inP(w.actualDeparture || w.plannedDeparture, p))
    .sort((a, b) => (b.actualDeparture || b.plannedDeparture).getTime() - (a.actualDeparture || a.plannedDeparture).getTime())
  const ST: Record<string, string> = { draft: 'Qoralama', active: 'Faol', completed: 'Yakunlangan', cancelled: 'Bekor' }
  return {
    understood: true, intent: 'v_waybills', vehicleId: v.id, title: `${v.plate} — yo'l varaqalari (${p.label})`,
    text: ws.length ? `${ws.length} ta varaqa.` : "Bu davrda yo'l varaqasi yo'q.",
    table: ws.length ? { columns: ['Raqam', 'Chiqish', 'Holat', 'Masofa'], rows: ws.slice(0, MAX_ROWS).map(w => [w.number, fmtDate(w.actualDeparture || w.plannedDeparture), ST[w.status] || w.status, w.returnOdometer != null && w.departureOdometer != null ? fmtNum(w.returnOdometer - w.departureOdometer) : '—']) } : undefined,
    links: [{ label: "Yo'l varaqalari", path: '/waybills' }],
  }
}

// ─── Butun avtopark ──────────────────────────────────────────────────────────

function vehicleTable(c: Ctx, rows: Array<{ id: string; cells: Array<string | number> }>, columns: string[]): Answer['table'] {
  return { columns: ['Mashina', ...columns], rows: rows.map(r => [c.plate(r.id), ...r.cells]) }
}

function fTopFuel(c: Ctx, p: Period, n: number): Answer {
  const by = new Map<string, { l: number; s: number }>()
  for (const r of c.s.fuel) if (inP(r.date, p) && c.vehicle.has(r.vehicleId)) {
    const x = by.get(r.vehicleId) || { l: 0, s: 0 }; x.l += r.liters; x.s += r.cost; by.set(r.vehicleId, x)
  }
  const top = [...by.entries()].sort((a, b) => b[1].s - a[1].s || b[1].l - a[1].l).slice(0, n)
  const total = [...by.values()].reduce((s, x) => s + x.s, 0)
  return {
    understood: true, intent: 'f_top_fuel', title: `Eng ko'p yoqilg'i olgan ${top.length} ta mashina (${p.label})`,
    text: top.length ? `Butun avtopark: ${fmtUzs(total)}. Ro'yxatdagilar ulushi: ${total ? Math.round(top.reduce((s, [, x]) => s + x.s, 0) / total * 100) : 0}%.${windowNote(p, c, 180, "yoqilg'i")}` : "Bu davrda yoqilg'i yozuvi yo'q.",
    table: top.length ? vehicleTable(c, top.map(([id, x]) => ({ id, cells: [fmtNum(x.l, 1), fmtNum(x.s)] })), ['Miqdor', 'Summa']) : undefined,
    links: [{ label: "Yoqilg'i yozuvlari", path: '/fuel' }],
  }
}

function fTopConsumption(c: Ctx, p: Period, n: number): Answer {
  const rows = c.active.map(v => ({ v, cs: consumption(c, v.id, p.from, p.to) }))
    .filter((x): x is { v: VehicleSnap; cs: NonNullable<ReturnType<typeof consumption>> } => !!x.cs)
    .map(x => ({ ...x, over: x.v.fuelNorm ? (x.cs.per100 / x.v.fuelNorm - 1) * 100 : null }))
    .sort((a, b) => (b.over ?? -999) - (a.over ?? -999) || b.cs.per100 - a.cs.per100)
    .slice(0, n)
  return {
    understood: true, intent: 'f_top_consumption', title: `Sarfi eng yuqori ${rows.length} ta mashina (${p.label})`,
    text: rows.length ? 'Normasi belgilangan mashinalar normadan oshish foizi bo\'yicha, qolganlari sarf bo\'yicha tartiblangan.' : "Sarfni hisoblash uchun ma'lumot yetarli emas.",
    table: rows.length ? vehicleTable(c, rows.map(r => ({ id: r.v.id, cells: [fmtNum(r.cs.per100, 1), r.v.fuelNorm ? fmtNum(r.v.fuelNorm, 1) : '—', r.over != null ? `${r.over > 0 ? '+' : ''}${Math.round(r.over)}%` : '—', fmtNum(r.cs.km)] })), ['/100km', 'Norma', 'Farq', 'km']) : undefined,
    links: [{ label: 'Sarf tahlili', path: '/fuel-consumption' }],
  }
}

function fKm(c: Ctx, p: Period, n: number, least: boolean): Answer {
  const rows = c.active.map(v => ({ id: v.id, km: c.kmBetween(v.id, p.from, p.to) }))
    .filter((x): x is { id: string; km: number } => x.km != null)
    .sort((a, b) => (least ? a.km - b.km : b.km - a.km)).slice(0, n)
  return {
    understood: true, intent: least ? 'f_least_km' : 'f_top_km',
    title: `Eng ${least ? 'kam' : "ko'p"} yurgan ${rows.length} ta mashina (${p.label})`,
    text: rows.length ? "GPS kunlik km bo'yicha." : "GPS ma'lumoti yo'q.",
    table: rows.length ? vehicleTable(c, rows.map(r => ({ id: r.id, cells: [fmtNum(r.km)] })), ['km']) : undefined,
    links: [{ label: 'GPS', path: '/gps' }],
  }
}

function fTopCost(c: Ctx, p: Period, n: number, repairsOnly: boolean): Answer {
  const by = new Map<string, number>()
  const add = (vid: string, x: number) => { if (c.vehicle.has(vid)) by.set(vid, (by.get(vid) || 0) + x) }
  for (const m of c.s.maintenance) if (m.status === 'approved' && inP(m.date, p)) add(m.vehicleId, maintTotal(m))
  if (!repairsOnly) {
    for (const r of c.s.fuel) if (inP(r.date, p)) add(r.vehicleId, r.cost)
    for (const e of c.s.expenses) if (inP(e.date, p)) add(e.vehicleId, e.amount)
  }
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  return {
    understood: true, intent: repairsOnly ? 'f_top_repair' : 'f_top_cost',
    title: `${repairsOnly ? "Ta'miri eng qimmat" : 'Xarajati eng katta'} ${top.length} ta mashina (${p.label})`,
    text: top.length ? `${repairsOnly ? "Faqat ta'mir" : "Yoqilg'i + ta'mir + boshqa xarajatlar"}.` : "Bu davrda xarajat yo'q.",
    table: top.length ? vehicleTable(c, top.map(([id, s]) => ({ id, cells: [fmtNum(s)] })), ['Summa']) : undefined,
  }
}

function fOilDue(c: Ctx): Answer {
  const rows = c.active.map(v => {
    const it = c.intervalsByV.get(v.id)?.get('oil_change')
    if (!it || it.nextDueKm == null) return null
    const left = it.nextDueKm - effectiveServiceCurrentKm(v.mileage, it.lastServiceKm, it.serviceOdometerKm)
    return left <= it.warningKm ? { id: v.id, left, last: it.lastServiceDate } : null
  }).filter((x): x is { id: string; left: number; last: Date | null } => !!x).sort((a, b) => a.left - b.left)
  const noInterval = c.active.filter(v => !c.intervalsByV.get(v.id)?.has('oil_change')).length
  return {
    understood: true, intent: 'f_oil_due', title: "Moyi muddati o'tgan yoki tugayotgan mashinalar",
    text: `${rows.filter(r => r.left < 0).length} ta mashinada muddat o'tgan, ${rows.filter(r => r.left >= 0).length} tasida tez orada tugaydi.${noInterval ? ` Yana ${noInterval} ta mashinada moy nazorati yo'q.` : ''}`,
    table: rows.length ? vehicleTable(c, rows.slice(0, MAX_ROWS).map(r => ({ id: r.id, cells: [r.left < 0 ? `${fmtNum(-r.left)} km o'tgan` : `${fmtNum(r.left)} km qoldi`, fmtDate(r.last)] })), ['Holat', 'Oxirgi almashtirish']) : undefined,
    links: [{ label: "Motor yog'i bo'limi", path: '/oil-change' }],
  }
}

function fDocs(c: Ctx): Answer {
  const rows: Array<{ id: string; cells: Array<string | number>; days: number }> = []
  for (const v of c.active) {
    for (const [name, d] of [["Sug'urta", v.insuranceExpiry], ['Texosmotr', v.techInspectionExpiry]] as const) {
      if (!d) continue
      const days = Math.ceil((d.getTime() - c.now.getTime()) / DAY_MS)
      if (days <= 30) rows.push({ id: v.id, days, cells: [name, fmtDate(d), days < 0 ? `${-days} kun o'tgan` : `${days} kun qoldi`] })
    }
  }
  rows.sort((a, b) => a.days - b.days)
  const missing = c.active.filter(v => !v.insuranceExpiry || !v.techInspectionExpiry).length
  return {
    understood: true, intent: 'f_docs', title: "Muddati o'tgan yoki 30 kunda tugaydigan hujjatlar",
    text: `${rows.filter(r => r.days < 0).length} ta hujjat muddati o'tgan, ${rows.filter(r => r.days >= 0).length} tasi 30 kunda tugaydi.${missing ? ` ${missing} ta mashinada sana kiritilmagan.` : ''}`,
    table: rows.length ? vehicleTable(c, rows.slice(0, MAX_ROWS), ['Hujjat', 'Muddat', 'Holat']) : undefined,
    links: [{ label: 'Mashinalar', path: '/vehicles' }],
  }
}

function fNoGps(c: Ctx): Answer {
  const rows = c.active.map(v => ({ v, days: v.lastGpsSignal ? c.daysSince(v.lastGpsSignal) : null }))
    .filter(x => !c.isGpsLinked(x.v) || (x.days != null && x.days >= c.t.gpsNoSignalDays))
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999))
  return {
    understood: true, intent: 'f_no_gps', title: "GPS signali yo'q mashinalar",
    text: rows.length ? `${rows.length} ta mashina.` : 'Barcha faol mashinalardan signal kelmoqda.',
    table: rows.length ? vehicleTable(c, rows.slice(0, MAX_ROWS).map(r => ({ id: r.v.id, cells: [c.isGpsLinked(r.v) ? fmtDate(r.v.lastGpsSignal) : "bog'lanmagan", r.days != null ? `${r.days} kun` : '—'] })), ['Oxirgi signal', 'Necha kun']) : undefined,
    links: [{ label: 'GPS', path: '/gps' }],
  }
}

function fIdle(c: Ctx): Answer {
  const rows = c.active.map(v => ({ id: v.id, km: c.kmBetween(v.id, c.ago(c.t.idleDays), c.now) }))
    .filter((x): x is { id: string; km: number } => x.km != null && x.km <= 5)
  return {
    understood: true, intent: 'f_idle', title: `${c.t.idleDays} kundan beri joyidan qo'zg'almagan mashinalar`,
    text: rows.length ? `${rows.length} ta faol mashina ishlamayapti.` : "Hamma faol mashinalar harakatda (yoki GPS ma'lumoti yo'q).",
    table: rows.length ? vehicleTable(c, rows.slice(0, MAX_ROWS).map(r => ({ id: r.id, cells: [`${fmtNum(r.km)} km`] })), [`${c.t.idleDays} kunda`]) : undefined,
  }
}

function fCount(c: Ctx): Answer {
  const by = (s: string) => c.vehicles.filter(v => v.status === s).length
  return {
    understood: true, intent: 'f_count', title: 'Avtopark tarkibi',
    text: `Jami ${c.vehicles.length} ta mashina: ${by('active')} ta faol, ${by('maintenance')} ta ta'mirda, ${by('inactive')} ta nofaol.`,
    table: { columns: ['Marka va model', 'Soni'], rows: [...c.vehicles.reduce((m, v) => m.set(`${v.brand} ${v.model}`.trim(), (m.get(`${v.brand} ${v.model}`.trim()) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, MAX_ROWS) },
  }
}

function fTotals(c: Ctx, p: Period, focus: { fuel: boolean; repair: boolean }): Answer {
  const span = p.to.getTime() - p.from.getTime()
  const prev: Period = { from: new Date(p.from.getTime() - span), to: new Date(p.from.getTime() - 1), label: 'oldingi davr' }
  const sums = (q: Period) => ({
    fuel: c.s.fuel.filter(r => inP(r.date, q) && c.vehicle.has(r.vehicleId)).reduce((s, r) => s + r.cost, 0),
    liters: c.s.fuel.filter(r => inP(r.date, q) && c.vehicle.has(r.vehicleId)).reduce((s, r) => s + r.liters, 0),
    maint: c.s.maintenance.filter(m => m.status === 'approved' && inP(m.date, q) && c.vehicle.has(m.vehicleId)).reduce((s, m) => s + maintTotal(m), 0),
    exp: c.s.expenses.filter(e => inP(e.date, q) && c.vehicle.has(e.vehicleId)).reduce((s, e) => s + e.amount, 0),
  })
  const a = sums(p), b = sums(prev)
  const pct = (x: number, y: number) => (y > 0 ? `${x >= y ? '+' : ''}${Math.round((x / y - 1) * 100)}%` : '—')
  const rows: Array<Array<string | number>> = []
  if (!focus.repair || focus.fuel) rows.push(["Yoqilg'i", fmtNum(a.fuel), fmtNum(b.fuel), pct(a.fuel, b.fuel)])
  if (!focus.fuel || focus.repair) rows.push(["Ta'mir", fmtNum(a.maint), fmtNum(b.maint), pct(a.maint, b.maint)])
  if (!focus.fuel && !focus.repair) {
    rows.push(['Boshqa xarajatlar', fmtNum(a.exp), fmtNum(b.exp), pct(a.exp, b.exp)])
    rows.push(['JAMI', fmtNum(a.fuel + a.maint + a.exp), fmtNum(b.fuel + b.maint + b.exp), pct(a.fuel + a.maint + a.exp, b.fuel + b.maint + b.exp)])
  }
  return {
    understood: true, intent: 'f_totals', title: `Xarajatlar (${p.label})`,
    text: `${focus.fuel ? `Yoqilg'i: ${fmtNum(a.liters, 1)} birlik, ${fmtUzs(a.fuel)}. ` : ''}Oldingi teng davr bilan solishtirildi.${windowNote(prev, c, 180, "yoqilg'i")}`,
    table: { columns: ['Turi', p.label, 'Oldingi davr', "O'zgarish"], rows },
  }
}

function fProblems(findings: FindingOut[]): Answer {
  const top = [...findings].sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, 10)
  return {
    understood: true, intent: 'f_problems', title: 'Bugun eng muhim 10 ta savol',
    text: findings.length ? `Jami ${findings.length} ta ochiq savol; daraja, pul ta'siri va yangiligi bo'yicha eng muhimlari:` : "Ochiq savol yo'q.",
    table: top.length ? { columns: ['Mashina', 'Savol'], rows: top.map(f => [f.plate || '—', f.title]) } : undefined,
  }
}

function fEngine(c: Ctx, p: Period): Answer {
  const rows: Array<{ id: string; d: Date; cells: Array<string | number> }> = []
  for (const e of c.s.engine) if (inP(e.date, p) && c.vehicle.has(e.vehicleId) && e.type !== 'inspection') rows.push({ id: e.vehicleId, d: e.date, cells: [fmtDate(e.date), 'Pasportda', fmtNum(e.cost)] })
  for (const m of c.s.maintenance) if (m.status === 'approved' && inP(m.date, p) && c.vehicle.has(m.vehicleId) && isEnginePart(maintText(m))) rows.push({ id: m.vehicleId, d: m.date, cells: [fmtDate(m.date), "Ta'mirda dvigatel detali", fmtNum(maintTotal(m))] })
  rows.sort((a, b) => b.d.getTime() - a.d.getTime())
  return {
    understood: true, intent: 'f_engine', title: `Dvigatel ta'mirlari (${p.label})`,
    text: rows.length ? `${new Set(rows.map(r => r.id)).size} ta mashinada ${rows.length} ta dvigatel ishi.` : "Bu davrda dvigatel ta'miri yozilmagan.",
    table: rows.length ? vehicleTable(c, rows.slice(0, MAX_ROWS), ['Sana', 'Manba', 'Summa']) : undefined,
    links: [{ label: 'Dvigatel pasporti', path: '/engine-monitor' }],
  }
}

function fRepairs(c: Ctx, p: Period): Answer {
  const ms = c.s.maintenance.filter(m => m.status === 'approved' && inP(m.date, p) && c.vehicle.has(m.vehicleId)).sort((a, b) => maintTotal(b) - maintTotal(a))
  const total = ms.reduce((s, m) => s + maintTotal(m), 0)
  return {
    understood: true, intent: 'f_repairs', title: `Ta'mirlar (${p.label})`,
    text: ms.length ? `${ms.length} ta ta'mir, jami ${fmtUzs(total)}. Eng qimmatlari:` : "Bu davrda ta'mir yo'q.",
    table: ms.length ? vehicleTable(c, ms.slice(0, MAX_ROWS).map(m => ({ id: m.vehicleId, cells: [fmtDate(m.date), (m.parts.map(x => x.name).join(', ') || m.notes || '—').slice(0, 70), fmtNum(maintTotal(m))] })), ['Sana', 'Ish', 'Summa']) : undefined,
    links: [{ label: "Ta'mirlar", path: '/maintenance' }],
  }
}

function fTires(c: Ctx): Answer {
  const rows = c.s.tires.filter(t => t.status === 'installed' && t.vehicleId && c.vehicle.has(t.vehicleId) && t.installedMileageKm != null)
    .map(t => ({ t, used: c.vehicle.get(t.vehicleId!)!.mileage - t.installedMileageKm! }))
    .filter(x => x.used > x.t.standardMileageKm && x.used < 500_000)
    .sort((a, b) => b.used / b.t.standardMileageKm - a.used / a.t.standardMileageKm)
  return {
    understood: true, intent: 'f_tires', title: 'Normasi oshgan shinalar',
    text: rows.length ? `${rows.length} ta shina normadan oshgan.` : "Normasi oshgan shina yo'q.",
    table: rows.length ? vehicleTable(c, rows.slice(0, MAX_ROWS).map(r => ({ id: r.t.vehicleId!, cells: [r.t.serial, r.t.position || '—', fmtNum(r.used), fmtNum(r.t.standardMileageKm)] })), ['Seriya', 'Joyi', 'Yurgan', 'Norma']) : undefined,
    links: [{ label: 'Shinalar', path: '/tires' }],
  }
}

function fPartUsage(c: Ctx, tokens: string[], p: Period): Answer | null {
  if (!tokens.length) return null
  const hits = partHits(c, null, tokens, p)
  if (!hits.length) return null
  const qty = hits.reduce((s, h) => s + h.qty, 0)
  const cost = hits.reduce((s, h) => s + h.cost, 0)
  return {
    understood: true, intent: 'f_part_usage', title: `"${tokens[0]}" sarfi (${p.label})`,
    text: `${new Set(hits.map(h => h.m.vehicleId)).size} ta mashinada ${fmtNum(qty)} dona, jami ${fmtUzs(cost)}.`,
    table: vehicleTable(c, hits.slice(0, MAX_ROWS).map(h => ({ id: h.m.vehicleId, cells: [fmtDate(h.m.date), h.name, h.qty, fmtNum(h.cost)] })), ['Sana', 'Qism', 'Soni', 'Summa']),
    links: [{ label: "Ta'mirlar", path: '/maintenance' }],
  }
}

function fWorker(c: Ctx, qn: string, p: Period): Answer | null {
  const name = qn.split(/\busta(si)?\b|\bmaster\b/)[2]?.trim().split(' ')[0] || qn.split(/\busta(si)?\b|\bmaster\b/)[0]?.trim().split(' ').pop()
  if (!name || name.length < 3) return null
  const ms = c.s.maintenance.filter(m => m.status === 'approved' && m.workerName && normalizeQuery(m.workerName).includes(name) && inP(m.date, p) && c.vehicle.has(m.vehicleId))
  if (!ms.length) return { understood: true, intent: 'f_worker', title: `Usta "${name}"`, text: `${p.label} davomida "${name}" nomli usta bajargan ta'mir topilmadi.` }
  const labor = ms.reduce((s, m) => s + m.laborCost, 0)
  return {
    understood: true, intent: 'f_worker', title: `Usta ${ms[0].workerName} (${p.label})`,
    text: `${ms.length} ta ta'mir, ${new Set(ms.map(m => m.vehicleId)).size} ta mashinada; ish haqi jami ${fmtUzs(labor)}, umumiy ${fmtUzs(ms.reduce((s, m) => s + maintTotal(m), 0))}.`,
    table: vehicleTable(c, [...ms].reverse().slice(0, MAX_ROWS).map(m => ({ id: m.vehicleId, cells: [fmtDate(m.date), (m.parts.map(x => x.name).join(', ') || m.notes || '—').slice(0, 70), fmtNum(maintTotal(m))] })), ['Sana', 'Ish', 'Summa']),
    links: [{ label: 'Ustalar', path: '/masters' }],
  }
}

// ─── Namunalar (UI'da ko'rsatiladi va testda har biri tushunilishi tekshiriladi) ───

export const EXAMPLES: Array<{ group: string; q: string }> = [
  // Bitta mashina
  ...[
    "{plate} qachon motor remont bo'lgan?", '{plate} dvigatel tarixi', '{plate} kapital remont qachon qilingan?',
    '{plate} moyi qachon almashtirilgan?', '{plate} moyga qancha qoldi?', '{plate} filtrlari qachon almashtirilgan?',
    "{plate} havo filtri", "{plate} bu oy qancha yoqilg'i oldi?", "{plate} o'tgan oy qancha benzin quyildi?",
    "{plate} oxirgi 30 kunda qancha yoqilg'i", '{plate} sarfi qancha?', '{plate} 100 km ga qancha yoqadi?',
    "{plate} normadan oshyaptimi?", '{plate} bu hafta qancha yurdi?', "{plate} o'tgan oy necha km yurgan?",
    "{plate} oxirgi 7 kunda masofa", "{plate} qanday ta'mirlar qilingan?", "{plate} bu yil nima almashtirilgan?",
    "{plate} oxirgi 3 oyda remontlar", "{plate} kolodka qachon almashtirilgan?", '{plate} akkumulyator qachon olingan?',
    '{plate} stseplenie qachon almashtirilgan?', '{plate} bu oy qancha xarajat qildi?', "{plate} bu yil qancha pul ketgan?",
    "{plate} sug'urtasi qachon tugaydi?", '{plate} texosmotr muddati', '{plate} hujjatlari', '{plate} shinalari',
    "{plate} qaysi balonlarda yuribdi?", '{plate} muammolari', '{plate} bo\'yicha savollar', '{plate} gps signal',
    "{plate} oxirgi tekshiruv", "{plate} yo'l varaqalari", '{plate}', "{plate} haqida ma'lumot",
    "{plate} oxirgi ta'mir qachon bo'lgan?", '{plate} bu oy qancha km yurdi?', "{plate} o'tgan hafta yoqilg'i",
    "{plate} aprel oyida ta'mirlar", '{plate} moy filtri qachon almashtirilgan?', "{plate} yoqilg'i filtri",
    '{plate} kafolatlari', '{plate} oxirgi signal qachon?', '{plate} bu yil xarajatlari',
    '{plate} 1 km necha pulga tushyapti?', '{plate} turbina qachon almashtirilgan?', '{plate} motor tarixi',
  ].map(q => ({ group: 'Bitta mashina', q })),
  // Yoqilg'i
  ...[
    "Bu oy eng ko'p yoqilg'i olgan 10 ta mashina", "O'tgan oy eng ko'p benzin quygan mashinalar", "Eng ko'p yoqilg'i yoqqan 5 ta",
    "Top 10 yoqilg'i", "Sarfi eng yuqori mashinalar", "Normadan eng ko'p oshgan mashinalar", "Eng ko'p sarflaydigan 5 ta mashina",
    "Bu oy jami yoqilg'i xarajati", "O'tgan oy qancha yoqilg'i ketdi?", "Bu yil yoqilg'iga qancha pul ketgan?", "Oktabr oyida yoqilg'i xarajati",
    "Bu hafta jami yoqilg'i", "Sarf reytingi", "Kecha qancha yoqilg'i quyildi?", "Bugungi yoqilg'i xarajati",
    "Normadan oshgan mashinalar",
  ].map(q => ({ group: "Yoqilg'i", q })),
  // Masofa va GPS
  ...[
    "Bu oy eng ko'p yurgan mashinalar", "Eng kam yurgan 10 ta mashina", "O'tgan hafta eng ko'p yurgan 5 ta", "Kam ishlatilayotgan mashinalar",
    "Qaysi mashinalar ishlamayapti?", "Turib qolgan mashinalar", "GPS signali yo'q mashinalar", "Treker ulanmagan mashinalar",
    "Harakatsiz mashinalar", "Bu hafta eng ko'p yurgan mashinalar", 'GPS ishlamayotgan mashinalar',
  ].map(q => ({ group: 'Masofa va GPS', q })),
  // Ta'mir va xarajat
  ...[
    "Bu oy eng qimmat ta'mirlar", "Ta'miri eng qimmat 10 ta mashina", "Eng ko'p xarajat qilgan mashinalar", "Bu oy qanday ta'mirlar bo'ldi?",
    "O'tgan oy jami ta'mir xarajati", "Bu yil jami xarajat", "Bu oy umumiy xarajatlar", "O'tgan oy xarajatlar qancha?",
    "Bu oy qancha kolodka ishlatildi?", "Bu yil nechta akkumulyator olindi?", "Oxirgi 3 oyda filtr sarfi", "Usta Karim bu oy nechta ta'mir qildi?",
    "Bu oy dvigatel ta'mirlari", "Bu yil qaysi mashinalar motor remont bo'ldi?", "Xarajat reytingi",
    "Bu oy eng ko'p ta'mirlangan mashinalar", "O'tgan oy eng qimmat ta'mirlar", 'Oxirgi 7 kunda jami xarajat',
    'Bu oy qancha tormoz kolodkasi olindi?',
  ].map(q => ({ group: "Ta'mir va xarajat", q })),
  // Xizmat va hujjatlar
  ...[
    "Moyi muddati o'tgan mashinalar", "Qaysi mashinalarga moy almashtirish kerak?", "Moyi tugayotgan mashinalar", "Moy holati",
    "Sug'urtasi tugayotgan mashinalar", "Texosmotr muddati o'tgan mashinalar", "Hujjatlari tugaydigan mashinalar", "Normasi oshgan shinalar",
    "Shinalar holati", "Qaysi mashinalarning sug'urtasi tugagan?",
  ].map(q => ({ group: 'Xizmat va hujjatlar', q })),
  // Umumiy
  ...[
    'Nechta mashinamiz bor?', 'Mashinalar soni', 'Bugun eng muhim muammolar', 'Nimaga e\'tibor berish kerak?', 'Diqqat talab qiladigan savollar',
    "Nima so'rasa bo'ladi?", 'Eng muhim 10 ta savol', 'Nechta faol mashina bor?',
  ].map(q => ({ group: 'Umumiy', q })),
]

// ─── Asosiy funksiya ─────────────────────────────────────────────────────────

export function answerQuestion(question: string, c: Ctx, findings: FindingOut[]): Answer {
  const qn = normalizeQuery(question)
  const has = (k: keyof typeof RX) => RX[k].test(qn)
  const period = parsePeriod(qn, c.now)
  const n = topN(qn)

  if (!qn || has('help')) return help(c)

  const isFleetQuestion = has('most') || has('least') || has('total') || has('count')
  const found = findVehicles(qn, c.vehicles)
  if (found.length > 1 && !isFleetQuestion) {
    return {
      understood: true, intent: 'clarify', title: 'Qaysi mashina?',
      text: `"${question}" bo'yicha ${found.length} ta mashina topildi. Aniqroq yozing:`,
      suggestions: found.slice(0, 8).map(v => qn.replace(/\d[\d\s]*\d?/, v.plate)),
    }
  }

  if (found.length === 1 && !isFleetQuestion) {
    const v = found[0]
    if (has('engine')) return vEngine(c, v)
    if (has('filter')) return vService(c, v, ['oil_filter', 'air_filter', 'fuel_filter'], 'filtrlar')
    if (has('oil')) return vService(c, v, ['oil_change', 'oil_filter'], 'motor moyi')
    if (has('docs')) return vDocs(c, v)
    if (has('tires')) return vTires(c, v)
    if (has('consumption')) return vConsumption(c, v, period || defaultPeriod(c.now, 30))
    if (has('fuel')) return vFuel(c, v, period || monthPeriod(c.now))
    if (has('km')) return vKm(c, v, period || defaultPeriod(c.now, 30))
    if (has('problem')) return vProblems(v, findings)
    if (has('gps')) return vGps(c, v)
    if (has('inspection')) return vInspection(c, v)
    if (has('waybill')) return vWaybills(c, v, period || defaultPeriod(c.now, 30))
    if (has('cost') && !has('repair')) return vCost(c, v, period || monthPeriod(c.now))
    if (has('when') || has('repair') || has('battery')) {
      const part = vPart(c, v, partTokens(qn), qn)
      if (part) return part
      return vRepairs(c, v, period || defaultPeriod(c.now, 90))
    }
    return vOverview(c, v, findings)
  }

  // ── Butun avtopark ──
  if (has('worker')) { const a = fWorker(c, qn, period || monthPeriod(c.now)); if (a) return a }
  if (has('least') && (has('km') || has('idle') || /ishlat/.test(qn))) return fKm(c, period || defaultPeriod(c.now, 30), n, true)
  if (has('most')) {
    if (has('consumption')) return fTopConsumption(c, period || defaultPeriod(c.now, 30), n)
    if (has('fuel')) return fTopFuel(c, period || monthPeriod(c.now), n)
    if (has('km')) return fKm(c, period || defaultPeriod(c.now, 30), n, false)
    if (has('repair')) return fTopCost(c, period || monthPeriod(c.now), n, true)
    return fTopCost(c, period || monthPeriod(c.now), n, false)
  }
  if (has('oil') || (has('filter') && has('due'))) return fOilDue(c)
  if (has('docs')) return fDocs(c)
  if (has('tires')) return fTires(c)
  if (has('gps')) return fNoGps(c)
  if (has('idle')) return fIdle(c)
  if (has('count')) return fCount(c)
  if (has('problem')) return fProblems(findings)
  if (has('engine')) return fEngine(c, period || defaultPeriod(c.now, 365, 'oxirgi 1 yil'))
  // "Bu oy qancha kolodka ishlatildi?", "filtr sarfi" — qism nomi bo'yicha (sarf/jami so'zlaridan oldin)
  const tokens = RX.battery.test(qn) ? ['akkumul', 'аккумул', 'akb'] : partTokens(qn)
  const usagePeriod = period || monthPeriod(c.now)
  const usage = fPartUsage(c, tokens, usagePeriod)
  if (usage && !has('total') && !has('cost')) return usage
  if (has('consumption')) return fTopConsumption(c, period || defaultPeriod(c.now, 30), n)
  if (has('total') || has('cost') || has('fuel')) return fTotals(c, period || monthPeriod(c.now), { fuel: has('fuel'), repair: has('repair') })
  if (has('repair')) return fRepairs(c, period || monthPeriod(c.now))
  if (has('km')) return fKm(c, period || defaultPeriod(c.now, 30), n, false)
  if (usage) return usage
  // Qism so'ralgan, lekin tahlil davrida topilmadi — tushunildi, faqat yozuv yo'q
  if (tokens.length && USAGE_VERB.test(qn)) {
    return {
      understood: true, intent: 'f_part_usage', title: `"${tokens[0]}" sarfi (${usagePeriod.label})`,
      text: `${usagePeriod.label} davomida nomida "${tokens[0]}" bo'lgan qism ishlatilgan ta'mir topilmadi.`,
    }
  }

  return {
    ...help(c),
    understood: false, intent: 'unknown',
    title: 'Savolni tushunmadim',
    text: found.length === 0 && /\d{3}/.test(qn)
      ? "Savoldagi raqam bo'yicha mashina topilmadi. Davlat raqamini to'liq yozing (masalan 30 574 OBA) yoki quyidagi namunalardan foydalaning."
      : "Men taxmin bilan javob bermayman. Savolni quyidagi namunalarga o'xshatib yozing:",
  }
}

function help(c: Ctx): Answer {
  const plate = c.active[0]?.plate || '30 574 OBA'
  return {
    understood: true, intent: 'help', title: "Nimalarni so'rash mumkin",
    text: "Mashina raqami bilan (masalan, moy, dvigatel, yoqilg'i, ta'mir, hujjatlar) yoki butun avtopark bo'yicha (eng ko'p, eng kam, jami) so'rang. Davrni ham ko'rsatish mumkin: bugun, bu hafta, o'tgan oy, aprel, oxirgi 30 kun.",
    suggestions: [
      `${plate} qachon motor remont bo'lgan?`, `${plate} moyi qachon almashtirilgan?`, "Bu oy eng ko'p yoqilg'i olgan 10 ta mashina",
      "Moyi muddati o'tgan mashinalar", "O'tgan oy jami xarajat", 'Bugun eng muhim muammolar',
    ],
  }
}
