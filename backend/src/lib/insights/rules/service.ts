// B. Moy va xizmat intervallari (13–26)
import type { Rule, Finding, IntervalSnap, VehicleSnap } from '../types'
import { fmtDate, fmtNum } from '../context'
import { effectiveServiceCurrentKm } from '../../serviceStatus'

const OIL = { label: 'Motor yog\'i bo\'limi', path: '/oil-change' }
const card = (v: VehicleSnap) => ({ label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` })

function curKm(v: VehicleSnap, it: IntervalSnap): number {
  return effectiveServiceCurrentKm(v.mileage, it.lastServiceKm, it.serviceOdometerKm)
}

function overdueKm(v: VehicleSnap, it: IntervalSnap | undefined): number | null {
  if (!it || it.nextDueKm == null) return null
  const over = curKm(v, it) - it.nextDueKm
  return over > 0 ? over : null
}

const FILTER_NAMES: Record<string, string> = { air_filter: 'Havo filtri', fuel_filter: "Yoqilg'i filtri" }

function filterRule(no: number, type: 'air_filter' | 'fuel_filter'): Rule {
  const key = `service.${type}`
  return {
    key, no, category: 'service', name: `${FILTER_NAMES[type]}: interval yo'q yoki muddati o'tgan`,
    collapse: {
      title: (n) => `${n} ta mashinada ${FILTER_NAMES[type].toLowerCase()} nazorati yo'q yoki muddati o'tgan`,
      action: OIL, severity: 'info',
    },
    run: (c) => {
      // Tashkilot bu xizmatni umuman yuritmasa — jim (shovqin emas)
      const orgUses = [...c.intervalsByV.values()].some(m => m.has(type))
      if (!orgUses) return []
      const out: Finding[] = []
      for (const v of c.active) {
        const it = c.intervalsByV.get(v.id)?.get(type)
        if (!it) {
          out.push(c.f({
            ruleKey: key, category: 'service', severity: 'info', vehicleId: v.id,
            title: `${v.plate} — ${FILTER_NAMES[type].toLowerCase()} qachon almashtirilgan?`,
            detail: `Boshqa mashinalarda bu xizmat yuritiladi, bu mashinada interval yo'q.`,
            action: card(v),
          }))
          continue
        }
        const over = overdueKm(v, it)
        const dateOver = it.nextDueDate && it.nextDueDate < c.now
        if (over == null && !dateOver) continue
        out.push(c.f({
          ruleKey: key, category: 'service', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — ${FILTER_NAMES[type].toLowerCase()} almashtirildimi?`,
          detail: over != null
            ? `Muddat ${fmtNum(over)} km o'tib ketgan (oxirgi: ${fmtDate(it.lastServiceDate)}).`
            : `Muddat ${fmtDate(it.nextDueDate)} da tugagan (oxirgi: ${fmtDate(it.lastServiceDate)}).`,
          action: OIL,
        }))
      }
      return out
    },
  }
}

export const serviceRules: Rule[] = [
  {
    key: 'service.no_oil_interval', no: 13, category: 'service', name: "Motor moyi intervali yo'q",
    collapse: { title: (n) => `${n} ta mashinada motor moyi nazorati yoqilmagan`, action: OIL, severity: 'warning' },
    run: (c) => c.active
      .filter(v => !c.intervalsByV.get(v.id)?.has('oil_change'))
      .map(v => c.f({
        ruleKey: 'service.no_oil_interval', category: 'service', severity: 'warning', vehicleId: v.id,
        title: `${v.plate} — moy qachon almashtirilgan? Nazorat yo'q`,
        detail: `Motor moyi intervali kiritilmagan — tizim moy muddatini kuzata olmaydi. Oxirgi almashtirish sanasi va km'ini kiriting.`,
        action: OIL,
      })),
  },
  {
    key: 'service.oil_overdue_km', no: 14, category: 'service', name: "Moy muddati km bo'yicha o'tgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const it = c.intervalsByV.get(v.id)?.get('oil_change')
        const over = overdueKm(v, it)
        if (over == null || !it) continue
        out.push(c.f({
          ruleKey: 'service.oil_overdue_km', category: 'service', severity: over > 1000 ? 'critical' : 'warning', vehicleId: v.id,
          title: `${v.plate} — moy ${fmtNum(over)} km o'tib ketdi. Almashtirildimi yoki kiritilmadimi?`,
          detail: `Oxirgi almashtirish: ${fmtDate(it.lastServiceDate)}${it.lastServiceKm != null ? `, ${fmtNum(it.lastServiceKm)} km` : ''}; ` +
            `interval ${fmtNum(it.intervalKm)} km. Almashtirilgan bo'lsa — kiriting, savol yo'qoladi.`,
          action: OIL,
        }))
      }
      return out
    },
  },
  {
    key: 'service.oil_overdue_days', no: 15, category: 'service', name: "Moy muddati kun bo'yicha o'tgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const it = c.intervalsByV.get(v.id)?.get('oil_change')
        if (!it?.nextDueDate || it.nextDueDate >= c.now || overdueKm(v, it) != null) continue
        out.push(c.f({
          ruleKey: 'service.oil_overdue_days', category: 'service', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — moy ${c.daysSince(it.nextDueDate)} kundan beri muddati o'tgan`,
          detail: `Km bo'yicha hali yetmagan, lekin vaqt bo'yicha (${it.intervalDays} kun) muddat ${fmtDate(it.nextDueDate)} da tugagan. Moy eskiradi.`,
          action: OIL,
        }))
      }
      return out
    },
  },
  {
    key: 'service.oil_due_soon', no: 16, category: 'service', name: 'Moy tez orada tugaydi',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const it = c.intervalsByV.get(v.id)?.get('oil_change')
        if (!it || it.nextDueKm == null) continue
        const left = it.nextDueKm - curKm(v, it)
        if (left <= 0 || left > it.warningKm) continue
        out.push(c.f({
          ruleKey: 'service.oil_due_soon', category: 'service', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — moyga ${fmtNum(left)} km qoldi. Moy va filtr omborda bormi?`,
          detail: `Keyingi almashtirish ${fmtNum(it.nextDueKm)} km da.`,
          action: OIL,
        }))
      }
      return out
    },
  },
  {
    key: 'service.oil_history_empty', no: 17, category: 'service', name: "6 oydan beri tizimda, moy tarixi bo'sh",
    collapse: { title: (n) => `${n} ta mashinada moy almashtirish tarixi umuman kiritilmagan`, action: OIL },
    run: (c) => c.active
      .filter(v => c.daysSince(v.createdAt) >= 180)
      .filter(v => {
        const it = c.intervalsByV.get(v.id)?.get('oil_change')
        if (it?.lastServiceDate) return false
        return !(c.serviceByV.get(v.id) || []).some(r => r.serviceType === 'oil_change')
      })
      .map(v => c.f({
        ruleKey: 'service.oil_history_empty', category: 'service', severity: 'warning', vehicleId: v.id,
        title: `${v.plate} — ${c.daysSince(v.createdAt)} kundan beri moy almashtirilmaganmi?`,
        detail: `Mashina ${fmtDate(v.createdAt)} dan tizimda, lekin birorta ham moy almashtirish yozuvi yo'q.`,
        action: OIL,
      })),
  },
  {
    key: 'service.oil_too_early', no: 18, category: 'service', name: 'Moy erta almashtirilmoqda (ortiqcha xarajat)',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const it = c.intervalsByV.get(v.id)?.get('oil_change')
        const recs = (c.serviceByV.get(v.id) || []).filter(r => r.serviceType === 'oil_change')
        if (!it || recs.length < 4) continue
        const last4 = recs.slice(-4)
        const gaps = last4.slice(1).map((r, i) => r.km - last4[i].km)
        if (!gaps.every(g => g > 0 && g < it.intervalKm * 0.5)) continue
        const avgCost = last4.reduce((s, r) => s + r.cost, 0) / last4.length
        out.push(c.f({
          ruleKey: 'service.oil_too_early', category: 'service', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — moy nega muddatidan ancha oldin almashtirilmoqda?`,
          detail: `Oxirgi 3 almashtirish orasidagi masofa: ${gaps.map(g => fmtNum(g)).join(', ')} km, interval esa ${fmtNum(it.intervalKm)} km. ` +
            `Ortiqcha xarajat yoki noto'g'ri kiritish.`,
          action: OIL, impactUzs: avgCost > 0 ? avgCost * 2 : undefined,
        }))
      }
      return out
    },
  },
  filterRule(19, 'air_filter'),
  filterRule(20, 'fuel_filter'),
  {
    key: 'service.no_anchor', no: 21, category: 'service', name: "Xizmat langari yo'q (qolgan km noaniq)",
    collapse: { title: (n) => `${n} ta mashinada moy qolgan km'i taxminiy (eski usulda kiritilgan)`, action: OIL },
    run: (c) => c.active
      .filter(v => v.gpsUnitName)
      .filter(v => {
        const it = c.intervalsByV.get(v.id)?.get('oil_change')
        return it && it.lastServiceKm != null && it.serviceOdometerKm == null
      })
      .map(v => c.f({
        ruleKey: 'service.no_anchor', category: 'service', severity: 'info', vehicleId: v.id,
        title: `${v.plate} — moyning qolgan km'i to'g'rimi?`,
        detail: `Oxirgi moy GPS langarisiz kiritilgan — spidometr va GPS shkalasi farq qilsa qolgan km noto'g'ri chiqadi. Oxirgi almashtirishni sana bilan qayta saqlang.`,
        action: OIL,
      })),
  },
  {
    key: 'service.record_above_current', no: 22, category: 'service', name: "Xizmat yozuvi km'i joriy probegdan katta",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        for (const [type, it] of c.intervalsByV.get(v.id) || []) {
          const recs = (c.serviceByV.get(v.id) || []).filter(r => r.serviceType === type)
          const last = recs[recs.length - 1]
          if (!last) continue
          const cur = curKm(v, it)
          if (last.km <= cur + 1000) continue
          out.push(c.f({
            ruleKey: 'service.record_above_current', category: 'service', severity: 'warning', vehicleId: v.id, subjectKey: type,
            title: `${v.plate} — xizmat yozuvidagi km xato emasmi?`,
            detail: `${fmtDate(last.date)} xizmatida ${fmtNum(last.km)} km yozilgan, joriy probeg esa ${fmtNum(cur)} km. Bitta nol ortiqcha bo'lishi mumkin.`,
            action: OIL,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'service.oil_maint_not_recorded', no: 23, category: 'service', name: "Ta'mirda moy, almashtirish yozilmagan",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(120)
      for (const v of c.active) {
        const recs = (c.serviceByV.get(v.id) || []).filter(r => r.serviceType === 'oil_change')
        for (const m of c.maintByV.get(v.id) || []) {
          if (!m.isOil || m.date < since || m.status !== 'approved') continue
          if (recs.some(r => Math.abs(r.date.getTime() - m.date.getTime()) <= 7 * 86400000)) continue
          out.push(c.f({
            ruleKey: 'service.oil_maint_not_recorded', category: 'service', severity: 'info', vehicleId: v.id, subjectKey: m.id,
            title: `${v.plate} — ${fmtDate(m.date)} da moy almashtirildimi yoki qo'shildimi?`,
            detail: `Ta'mir yozuvida motor moyi bor, lekin Motor yog'i bo'limida almashtirish yo'q. Almashtirilgan bo'lsa — belgilang, interval qaytadan boshlanadi.`,
            action: OIL,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'service.odd_interval', no: 24, category: 'service', name: "Moy intervali g'ayrioddiy",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const km = v.oilIntervalKm ?? c.intervalsByV.get(v.id)?.get('oil_change')?.intervalKm
        if (!km || (km >= 3000 && km <= 20000)) continue
        out.push(c.f({
          ruleKey: 'service.odd_interval', category: 'service', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — moy intervali ${fmtNum(km)} km. To'g'rimi?`,
          detail: `Odatiy oraliq 5 000–15 000 km. Xato kiritilgan bo'lsa, moy ogohlantirishlari noto'g'ri ishlaydi.`,
          action: card(v),
        }))
      }
      return out
    },
  },
  {
    key: 'service.model_interval_mismatch', no: 25, category: 'service', name: 'Bir modelda moy intervali har xil',
    run: (c) => {
      const byModel = new Map<string, { plates: string[]; kms: number[] }>()
      for (const v of c.active) {
        const km = v.oilIntervalKm ?? c.intervalsByV.get(v.id)?.get('oil_change')?.intervalKm
        if (!km) continue
        const k = `${v.brand} ${v.model}`.trim()
        const g = byModel.get(k) || { plates: [], kms: [] }
        g.plates.push(v.plate); g.kms.push(km)
        byModel.set(k, g)
      }
      const out: Finding[] = []
      for (const [model, g] of byModel) {
        if (g.kms.length < 3) continue
        const min = Math.min(...g.kms), max = Math.max(...g.kms)
        if (max < min * 1.5) continue
        out.push(c.f({
          ruleKey: 'service.model_interval_mismatch', category: 'service', severity: 'info', subjectKey: model,
          title: `${model} mashinalarida moy intervali nega har xil?`,
          detail: `${g.kms.length} ta mashinada interval ${fmtNum(min)} km dan ${fmtNum(max)} km gacha. Bir xil model uchun bir xil norma belgilang.`,
          action: OIL,
        }))
      }
      return out
    },
  },
  {
    key: 'service.zero_cost', no: 26, category: 'service', name: 'Xizmat yozuvida narx 0',
    collapse: { title: (n) => `${n} ta mashinada moy/filtr xizmati narxsiz kiritilmoqda`, action: OIL },
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(180)
      for (const v of c.vehicles) {
        const zero = (c.serviceByV.get(v.id) || []).filter(r => r.date >= since && r.cost <= 0)
        if (!zero.length) continue
        out.push(c.f({
          ruleKey: 'service.zero_cost', category: 'service', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — moy/filtr tekinmi? Narx kiritilmagan`,
          detail: `${zero.length} ta xizmat yozuvida narx 0 (oxirgisi ${fmtDate(zero[zero.length - 1].date)}). Xizmat xarajati hisobotga tushmayapti.`,
          action: OIL,
        }))
      }
      return out
    },
  },
]
