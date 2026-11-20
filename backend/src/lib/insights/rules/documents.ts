// E. Hujjatlar, texnik tekshiruv, kafolat (59–69)
import type { Rule, Finding, VehicleSnap } from '../types'
import { DAY_MS, fmtDate, fmtUzs, maintText, maintTotal, type Ctx } from '../context'
import { isBrakeWork } from '../keywords'
import { vehicleEv, maintEv, table } from '../evidence'
import type { InspectionSnap } from '../types'

const STATUS_UZ: Record<string, string> = { ok: 'yaxshi', good: 'yaxshi', warning: 'ogohlantirish', critical: 'KRITIK' }
const inspEv = (xs: InspectionSnap[], note?: string) =>
  table(['Tekshiruv sanasi', 'Umumiy holat', 'Tormoz'], xs.slice(0, 6).map(i => [fmtDate(i.date), STATUS_UZ[i.overall] || i.overall, STATUS_UZ[i.brakes] || i.brakes]), note)

const card = (v: VehicleSnap) => ({ label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` })
const INSP = { label: 'Texnik tekshiruv', path: '/inspections' }

type DocField = 'insuranceExpiry' | 'techInspectionExpiry'
const DOC_NAME: Record<DocField, string> = { insuranceExpiry: "Sug'urta", techInspectionExpiry: 'Texosmotr' }

function docRules(field: DocField, base: number, slug: string): Rule[] {
  const name = DOC_NAME[field]
  return [
    {
      key: `documents.${slug}_missing`, no: base, category: 'documents', name: `${name} sanasi kiritilmagan`,
      collapse: { title: (n) => `${n} ta mashinada ${name.toLowerCase()} muddati kiritilmagan — eslatma ishlamaydi`, action: { label: 'Mashinalar', path: '/vehicles' } },
      run: (c) => c.active.filter(v => !v[field]).map(v => c.f({
        ruleKey: `documents.${slug}_missing`, category: 'documents', severity: 'info', vehicleId: v.id,
        title: `${v.plate} — ${name.toLowerCase()} qachon tugaydi?`,
        detail: `Sana kiritilmagan — muddat o'tib ketsa tizim ogohlantira olmaydi (jarima xavfi).`,
        action: card(v), evidence: vehicleEv(v, [[`${name} tugash sanasi`, null]]),
        quick: { kind: 'vehicle_date', field, label: `${name} tugash sanasi` },
      })),
    },
    {
      key: `documents.${slug}_expired`, no: base + 1, category: 'documents', name: `${name} muddati o'tgan`,
      run: (c) => c.active.filter(v => v[field] && v[field]! < c.now).map(v => c.f({
        ruleKey: `documents.${slug}_expired`, category: 'documents', severity: 'critical', vehicleId: v.id,
        title: `${v.plate} — ${name.toLowerCase()} ${c.daysSince(v[field]!)} kundan beri tugagan! Mashina yo'lga chiqyaptimi?`,
        detail: `Muddat: ${fmtDate(v[field])}. Yangilangan bo'lsa — yangi sanani kiriting.`,
        action: card(v), evidence: vehicleEv(v, [[`${name} tugash sanasi`, fmtDate(v[field])], ['Bugun', fmtDate(c.now)], ["O'tgan kun", c.daysSince(v[field]!)]]),
        quick: { kind: 'vehicle_date', field, label: `Yangi ${name.toLowerCase()} tugash sanasi` },
      })),
    },
    {
      key: `documents.${slug}_soon`, no: base + 2, category: 'documents', name: `${name} tez orada tugaydi`,
      run: (c) => c.active
        .filter(v => v[field] && v[field]! >= c.now && v[field]!.getTime() - c.now.getTime() <= c.t.docWarnDays * DAY_MS)
        .map(v => c.f({
          ruleKey: `documents.${slug}_soon`, category: 'documents', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — ${name.toLowerCase()} ${Math.ceil((v[field]!.getTime() - c.now.getTime()) / DAY_MS)} kunda tugaydi. Yangilash rejalashtirilganmi?`,
          detail: `Muddat: ${fmtDate(v[field])}.`,
          action: card(v), evidence: vehicleEv(v, [[`${name} tugash sanasi`, fmtDate(v[field])], ['Bugun', fmtDate(c.now)]]),
          quick: { kind: 'vehicle_date', field, label: `Yangi ${name.toLowerCase()} tugash sanasi` },
        })),
    },
  ]
}

const usesInspections = (c: Ctx) => c.s.inspections.some(i => i.date >= c.ago(180))

export const documentRules: Rule[] = [
  ...docRules('insuranceExpiry', 59, 'insurance'),
  ...docRules('techInspectionExpiry', 62, 'techinsp'),
  {
    key: 'documents.monthly_inspection_missing', no: 65, category: 'documents', name: "Bu oy texnik tekshiruv o'tkazilmagan",
    collapse: { title: (n) => `${n} ta mashina bu oy texnik tekshiruvdan o'tmagan`, action: INSP, severity: 'warning' },
    run: (c) => {
      if (!usesInspections(c)) return []
      // Oyning 20-sanasidan keyin so'raymiz — oy boshida hali vaqt bor
      const uz = new Date(c.now.getTime() + 5 * 3600 * 1000)
      if (uz.getUTCDate() < 20) return []
      const monthStart = new Date(Date.UTC(uz.getUTCFullYear(), uz.getUTCMonth(), 1) - 5 * 3600 * 1000)
      return c.active
        .filter(v => !(c.inspByV.get(v.id) || []).some(i => i.date >= monthStart))
        .map(v => c.f({
          ruleKey: 'documents.monthly_inspection_missing', category: 'documents', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — bu oy texnik tekshiruvdan o'tdimi?`,
          detail: `Oylik tekshiruv yozuvi yo'q. Oxirgisi: ${fmtDate((c.inspByV.get(v.id) || [])[0]?.date)}.`,
          action: INSP, evidence: inspEv(c.inspByV.get(v.id) || [], `Bu oy (${fmtDate(monthStart)} dan) tekshiruv yozuvi yo'q. Oxirgi tekshiruvlar:`),
        }))
    },
  },
  {
    key: 'documents.critical_inspection_no_repair', no: 66, category: 'documents', name: "Tekshiruv KRITIK, ta'mir yo'q",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const last = (c.inspByV.get(v.id) || [])[0]
        if (!last || last.overall !== 'critical' || c.daysSince(last.date) < 14) continue
        const fixed = (c.maintByV.get(v.id) || []).some(m => m.date >= last.date)
        if (fixed) continue
        out.push(c.f({
          ruleKey: 'documents.critical_inspection_no_repair', category: 'documents', severity: 'critical', vehicleId: v.id,
          title: `${v.plate} — ${fmtDate(last.date)} tekshiruvda KRITIK holat. Ta'mirlandimi?`,
          detail: `${c.daysSince(last.date)} kun o'tdi, lekin keyin birorta ta'mir yozuvi yo'q. Mashina kritik holatda ishlayaptimi?`,
          action: { label: "Ta'mir kiritish", path: '/maintenance' },
          evidence: inspEv(c.inspByV.get(v.id) || [], `${fmtDate(last.date)} dan keyin ta'mir yozuvi: 0 ta. Oxirgi ta'mir: ${fmtDate((c.maintByV.get(v.id) || []).slice(-1)[0]?.date)}.`),
        }))
      }
      return out
    },
  },
  {
    key: 'documents.brakes_not_fixed', no: 67, category: 'documents', name: "Tormoz yomon, tormoz ta'miri yo'q",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const last = (c.inspByV.get(v.id) || [])[0]
        if (!last || last.brakes === 'ok' || c.daysSince(last.date) < 7) continue
        const fixed = (c.maintByV.get(v.id) || []).some(m => m.date >= last.date && isBrakeWork(maintText(m)))
        if (fixed) continue
        out.push(c.f({
          ruleKey: 'documents.brakes_not_fixed', category: 'documents', severity: last.brakes === 'critical' ? 'critical' : 'warning', vehicleId: v.id,
          title: `${v.plate} — tormoz ${last.brakes === 'critical' ? 'KRITIK' : 'ogohlantirish'} holatida edi. Tuzatildimi?`,
          detail: `${fmtDate(last.date)} tekshiruvi. Shundan keyin tormoz bo'yicha ta'mir yozuvi yo'q — xavfsizlik masalasi.`,
          action: { label: "Ta'mir kiritish", path: '/maintenance' },
          evidence: (() => {
            const after = (c.maintByV.get(v.id) || []).filter(m => m.date >= last.date)
            return after.length
              ? maintEv(after, `${fmtDate(last.date)} tekshiruvida tormoz: ${STATUS_UZ[last.brakes] || last.brakes}. Keyingi ta'mirlarda "tormoz/kolodka" so'zi topilmadi — boshqa nom bilan yozilgan bo'lsa "Savol noto'g'ri" deng.`)
              : inspEv(c.inspByV.get(v.id) || [], `Tekshiruvdan keyin birorta ta'mir yozuvi yo'q.`)
          })(),
        }))
      }
      return out
    },
  },
  {
    key: 'documents.warranty_soon', no: 68, category: 'documents', name: 'Kafolat 30 kunda tugaydi',
    run: (c) => c.s.warranties
      .filter(w => w.status !== 'claimed' && w.endDate >= c.now && w.endDate.getTime() - c.now.getTime() <= 30 * DAY_MS)
      .filter(w => !w.vehicleId || c.vehicle.has(w.vehicleId))
      .map(w => c.f({
        ruleKey: 'documents.warranty_soon', category: 'documents', severity: 'info', vehicleId: w.vehicleId, subjectKey: w.id,
        title: `${w.vehicleId ? c.plate(w.vehicleId) + ' — ' : ''}"${w.partName}" kafolati ${fmtDate(w.endDate)} da tugaydi. Muammo bo'lsa hozir murojaat qiling`,
        detail: `Kafolat tugagach ta'mir o'z hisobingizdan bo'ladi.`,
        action: { label: 'Kafolatlar', path: '/warranties' },
        evidence: table(['Qism', 'Boshlanish', 'Tugash', 'Holat'], [[w.partName, fmtDate(w.startDate), fmtDate(w.endDate), w.status]]),
      })),
  },
  {
    key: 'documents.paid_under_warranty', no: 69, category: 'documents', name: "Kafolatdagi qism pulli ta'mirlangan",
    run: (c) => {
      const out: Finding[] = []
      for (const w of c.s.warranties) {
        if (!w.vehicleId || !c.vehicle.has(w.vehicleId)) continue
        const key = w.partName.toLowerCase().trim()
        if (key.length < 4) continue
        for (const m of c.maintByV.get(w.vehicleId) || []) {
          if (m.date < w.startDate || m.date > w.endDate || m.date < c.ago(365) || maintTotal(m) <= 0) continue
          if (!maintText(m).includes(key)) continue
          out.push(c.f({
            ruleKey: 'documents.paid_under_warranty', category: 'documents', severity: 'warning', vehicleId: w.vehicleId, subjectKey: m.id,
            title: `${c.plate(w.vehicleId)} — "${w.partName}" kafolatda edi, nega pul to'landi?`,
            detail: `${fmtDate(m.date)} ta'mir ${fmtUzs(maintTotal(m))}; kafolat ${fmtDate(w.endDate)} gacha. Yetkazib beruvchidan qaytarib olish mumkin.`,
            action: { label: 'Kafolatlar', path: '/warranties' }, impactUzs: maintTotal(m),
            evidence: maintEv([m], `Kafolat: "${w.partName}", ${fmtDate(w.startDate)} – ${fmtDate(w.endDate)}.`, [key]),
          }))
        }
      }
      return out
    },
  },
]
