// A. Dvigatel va yirik ta'mir (1–12)
import type { Rule, Finding } from '../types'
import { DAY_MS, fmtDate, fmtNum, fmtUzs, maintText, maintTotal, consumption, consumptionEvidence, isoDay } from '../context'
import { isEnginePart, isFuelSystemPart, isGearbox, matchedEngineParts } from '../keywords'

const ENGINE_PATH = { label: 'Dvigatel pasportiga kiritish', path: '/engine-monitor' }
const OIL_PATH = { label: 'Moy almashtirishni kiritish', path: '/oil-change' }
const MAJOR = ['overhaul', 'major_repair']

export const engineRules: Rule[] = [
  {
    key: 'engine.parts_without_passport', no: 1, category: 'engine',
    name: "Dvigatel detali o'rnatilgan, pasportda yo'q",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(540)
      for (const v of c.vehicles) {
        const engine = c.engineByV.get(v.id) || []
        for (const m of c.maintByV.get(v.id) || []) {
          if (m.date < since || m.status !== 'approved') continue
          const text = maintText(m)
          if (!isEnginePart(text)) continue
          const covered = engine.some(e => Math.abs(e.date.getTime() - m.date.getTime()) <= 30 * DAY_MS)
          if (covered) continue
          const parts = matchedEngineParts([...m.parts.map(p => p.name), m.notes || ''])
          const total = maintTotal(m)
          out.push(c.f({
            ruleKey: 'engine.parts_without_passport', category: 'engine',
            severity: total >= c.t.engineCriticalUzs ? 'critical' : 'warning',
            vehicleId: v.id, subjectKey: m.id,
            title: `${v.plate} — motor remont bo'lganmi? Nega Dvigatel pasportiga kiritilmagan?`,
            detail: `${fmtDate(m.date)} ta'mirda ${parts.map(p => `"${p}"`).join(', ') || 'dvigatel detali'} ishlatilgan` +
              `${total > 0 ? ` (${fmtUzs(total)})` : ''}${m.mileage ? `, probeg ${fmtNum(m.mileage)} km` : ''}. ` +
              `Dvigatel pasportida shu sanaga yaqin (±30 kun) yozuv yo'q. Kiritsangiz, bu savol yo'qoladi.`,
            action: ENGINE_PATH, impactUzs: total,
            evidence: {
              note: `Ta'mir ${fmtDate(m.date)}${m.workerName ? `, usta: ${m.workerName}` : ''}${m.notes ? `. Izoh: "${m.notes.slice(0, 120)}"` : ''}. ` +
                (engine.length ? `Pasportdagi eng yaqin yozuv: ${fmtDate(engine.reduce((a, e) => Math.abs(e.date.getTime() - m.date.getTime()) < Math.abs(a.date.getTime() - m.date.getTime()) ? e : a).date)}.` : "Dvigatel pasporti umuman bo'sh."),
              columns: ['Qism', 'Soni', 'Narx'],
              rows: m.parts.map(p => [p.name, p.qty, fmtNum(p.unitCost * p.qty)]),
            },
            quick: {
              kind: 'engine_record',
              prefill: {
                date: isoDay(m.date), mileage: m.mileage ?? undefined, cost: total || undefined,
                recordType: total >= c.t.engineCriticalUzs ? 'overhaul' : 'major_repair',
                description: m.parts.map(p => p.name).filter(Boolean).slice(0, 5).join(', ') || (m.notes || '').slice(0, 120),
              },
            },
          }))
        }
      }
      return out
    },
  },
  {
    key: 'engine.high_mileage_no_passport', no: 2, category: 'engine',
    name: "300 000 km+ probeg, dvigatel pasporti bo'sh",
    run: (c) => c.active
      .filter(v => v.mileage >= 300_000 && !(c.engineByV.get(v.id) || []).length)
      .map(v => c.f({
        ruleKey: 'engine.high_mileage_no_passport', category: 'engine', severity: 'info', vehicleId: v.id,
        title: `${v.plate} — ${fmtNum(v.mileage)} km yurgan, dvigatel hech qachon ta'mirlanmaganmi?`,
        detail: `Dvigatel pasportida birorta ham yozuv yo'q. Bu probegda odatda kamida bitta yirik ta'mir bo'ladi — tarixini kiriting.`,
        action: ENGINE_PATH,
        quick: { kind: 'engine_record', prefill: { recordType: 'overhaul' } },
      })),
  },
  {
    key: 'engine.next_service_passed', no: 3, category: 'engine',
    name: "Dvigatel keyingi xizmat km'i o'tgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const recs = c.engineByV.get(v.id) || []
        const last = recs[recs.length - 1]
        if (!last?.nextServiceMileage) continue
        const cur = c.humanKm(v.id)
        if (cur <= last.nextServiceMileage) continue
        out.push(c.f({
          ruleKey: 'engine.next_service_passed', category: 'engine', severity: 'warning', vehicleId: v.id, subjectKey: last.id,
          title: `${v.plate} — dvigatel xizmati muddati o'tdi, bajarildimi?`,
          detail: `${fmtDate(last.date)} yozuvida keyingi xizmat ${fmtNum(last.nextServiceMileage)} km deb belgilangan, ` +
            `ma'lum probeg ${fmtNum(cur)} km (${fmtNum(cur - last.nextServiceMileage)} km oshgan).`,
          action: ENGINE_PATH,
        }))
      }
      return out
    },
  },
  {
    key: 'engine.repeated_overhaul', no: 4, category: 'engine', mergeGroup: 'engine-repeat',
    name: "12 oyda 2+ yirik dvigatel ta'miri",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(365)
      for (const v of c.vehicles) {
        const major = (c.engineByV.get(v.id) || []).filter(e => MAJOR.includes(e.type) && e.date >= since)
        if (major.length < 2) continue
        const cost = major.reduce((s, e) => s + e.cost, 0)
        out.push(c.f({
          ruleKey: 'engine.repeated_overhaul', category: 'engine', severity: 'critical', vehicleId: v.id,
          title: `${v.plate} — dvigatel bir yilda ${major.length} marta yirik ta'mirlandi. Sabab nima?`,
          detail: `Sanalar: ${major.map(e => fmtDate(e.date)).join(', ')}${cost ? `, jami ${fmtUzs(cost)}` : ''}. ` +
            `Ta'mir sifati, usta yoki haydovchi ekspluatatsiyasini tekshiring; mashinani almashtirish arzonroq bo'lishi mumkin.`,
          action: ENGINE_PATH, impactUzs: cost,
        }))
      }
      return out
    },
  },
  {
    key: 'engine.no_oil_after_overhaul', no: 5, category: 'engine',
    name: "Kapital ta'mirdan keyin obkatka moyi almashtirilmagan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const recs = (c.engineByV.get(v.id) || []).filter(e => e.type === 'overhaul' && e.date >= c.ago(180))
        const last = recs[recs.length - 1]
        if (!last) continue
        const oilAfter = (c.serviceByV.get(v.id) || []).some(r => r.serviceType === 'oil_change' && r.date > last.date)
        if (oilAfter) continue
        const gpsKm = c.kmBetween(v.id, last.date, c.now)
        const km = gpsKm ?? Math.max(0, c.humanKm(v.id) - last.mileage)
        if (km < 2000) continue
        out.push(c.f({
          ruleKey: 'engine.no_oil_after_overhaul', category: 'engine', severity: 'warning', vehicleId: v.id, subjectKey: last.id,
          title: `${v.plate} — kapital ta'mirdan keyin obkatka moyi almashtirildimi?`,
          detail: `${fmtDate(last.date)} kapital ta'mirdan beri ~${fmtNum(km)} km yurgan, moy almashtirish yozilmagan. ` +
            `Yangi dvigatelda birinchi moy 1500–2000 km'da almashtiriladi.`,
          action: OIL_PATH,
          quick: { kind: 'oil_change', serviceType: 'oil_change', prefill: {} },
        }))
      }
      return out
    },
  },
  {
    key: 'engine.zero_cost', no: 6, category: 'engine',
    name: "Dvigatel yozuvida narx 0",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const zero = (c.engineByV.get(v.id) || []).filter(e => e.cost <= 0 && e.type !== 'inspection' && e.date >= c.ago(730))
        if (!zero.length) continue
        out.push(c.f({
          ruleKey: 'engine.zero_cost', category: 'engine', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — dvigatel ta'miri tekinga bo'lganmi?`,
          detail: `${zero.length} ta dvigatel yozuvida narx 0 (${zero.slice(0, 3).map(e => fmtDate(e.date)).join(', ')}). Xarajat hisobotlarda ko'rinmayapti.`,
          action: ENGINE_PATH,
        }))
      }
      return out
    },
  },
  {
    key: 'engine.mileage_regress', no: 7, category: 'engine',
    name: "Dvigatel yozuvida probeg orqaga ketgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const recs = c.engineByV.get(v.id) || []
        for (let i = 1; i < recs.length; i++) {
          const a = recs[i - 1], b = recs[i]
          if (a.mileage > 0 && b.mileage > 0 && b.mileage < a.mileage - 100) {
            out.push(c.f({
              ruleKey: 'engine.mileage_regress', category: 'engine', severity: 'warning', vehicleId: v.id, subjectKey: b.id,
              title: `${v.plate} — dvigatel yozuvidagi probeg xato kiritilganmi?`,
              detail: `${fmtDate(a.date)}: ${fmtNum(a.mileage)} km, keyingi ${fmtDate(b.date)}: ${fmtNum(b.mileage)} km — probeg kamaygan.`,
              action: ENGINE_PATH,
            }))
          }
        }
      }
      return out
    },
  },
  {
    key: 'engine.oil_topups', no: 8, category: 'engine',
    name: "30 kunda 3+ marta moy qo'shilgan",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(30)
      for (const v of c.active) {
        const oil = (c.maintByV.get(v.id) || []).filter(m => m.isOil && m.date >= since)
        if (oil.length < 3) continue
        out.push(c.f({
          ruleKey: 'engine.oil_topups', category: 'engine', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — dvigatel moy yeyaptimi?`,
          detail: `So'nggi 30 kunda ${oil.length} marta moy berilgan (${oil.map(m => fmtDate(m.date)).join(', ')}). ` +
            `Kolsa/salnik yeyilishi yoki moy chiqib ketishini tekshiring.`,
          action: { label: "Ta'mirlarni ko'rish", path: '/maintenance' },
        }))
      }
      return out
    },
  },
  {
    key: 'engine.no_effect_after_overhaul', no: 9, category: 'engine',
    name: "Kapital ta'mirdan keyin sarf kamaymagan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const last = (c.engineByV.get(v.id) || []).filter(e => e.type === 'overhaul' && e.date <= c.ago(45) && e.date >= c.ago(170)).pop()
        if (!last) continue
        const before = consumption(c, v.id, new Date(last.date.getTime() - 60 * DAY_MS), last.date)
        const after = consumption(c, v.id, last.date, new Date(Math.min(c.now.getTime(), last.date.getTime() + 60 * DAY_MS)))
        if (!before || !after || after.per100 < before.per100 * 1.05) continue
        out.push(c.f({
          ruleKey: 'engine.no_effect_after_overhaul', category: 'engine', severity: 'info', vehicleId: v.id, subjectKey: last.id,
          title: `${v.plate} — kapital ta'mir foyda berdimi?`,
          detail: `${fmtDate(last.date)} ta'mirdan oldin ${fmtNum(before.per100, 1)} L/100km, keyin ${fmtNum(after.per100, 1)} L/100km — sarf kamaymadi, aksincha oshdi.`,
          action: ENGINE_PATH,
          evidence: consumptionEvidence(c, v.id, new Date(last.date.getTime() - 60 * DAY_MS), new Date(Math.min(c.now.getTime(), last.date.getTime() + 60 * DAY_MS))),
        }))
      }
      return out
    },
  },
  {
    key: 'engine.repeat_engine_repair', no: 10, category: 'engine', mergeGroup: 'engine-repeat',
    name: "Dvigatel ta'miridan keyin 60 kunda yana ta'mir",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(365)
      for (const v of c.vehicles) {
        const events = [
          ...(c.engineByV.get(v.id) || []).filter(e => e.type !== 'inspection').map(e => e.date),
          ...(c.maintByV.get(v.id) || []).filter(m => m.status === 'approved' && isEnginePart(maintText(m))).map(m => m.date),
        ].filter(d => d >= since).sort((a, b) => a.getTime() - b.getTime())
        // bir xil voqeani (pasport + ta'mir ±7 kun) bitta deb sanaymiz
        const uniq: Date[] = []
        for (const d of events) if (!uniq.length || d.getTime() - uniq[uniq.length - 1].getTime() > 7 * DAY_MS) uniq.push(d)
        for (let i = 1; i < uniq.length; i++) {
          const gap = Math.round((uniq[i].getTime() - uniq[i - 1].getTime()) / DAY_MS)
          if (gap <= 60) {
            out.push(c.f({
              ruleKey: 'engine.repeat_engine_repair', category: 'engine', severity: 'warning', vehicleId: v.id, subjectKey: uniq[i].toISOString().slice(0, 10),
              title: `${v.plate} — dvigatel ${gap} kun ichida qayta ta'mirlandi. Birinchi ta'mir sifatsizmi?`,
              detail: `${fmtDate(uniq[i - 1])} va ${fmtDate(uniq[i])} — ikkala ta'mirda ham dvigatel ishi. Usta va kafolatni tekshiring.`,
              action: { label: "Ta'mirlarni ko'rish", path: '/maintenance' },
            }))
          }
        }
      }
      return out
    },
  },
  {
    key: 'engine.fuel_system_without_passport', no: 11, category: 'engine',
    name: "Turbina/forsunka/TNVD almashtirilgan, pasportda yo'q",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(365)
      for (const v of c.vehicles) {
        const engine = c.engineByV.get(v.id) || []
        for (const m of c.maintByV.get(v.id) || []) {
          if (m.date < since || m.status !== 'approved') continue
          const text = maintText(m)
          if (!isFuelSystemPart(text) || isEnginePart(text)) continue
          if (engine.some(e => Math.abs(e.date.getTime() - m.date.getTime()) <= 30 * DAY_MS)) continue
          out.push(c.f({
            ruleKey: 'engine.fuel_system_without_passport', category: 'engine', severity: 'info', vehicleId: v.id, subjectKey: m.id,
            title: `${v.plate} — yoqilg'i apparaturasi ta'miri dvigatel pasportiga kiritilsinmi?`,
            detail: `${fmtDate(m.date)} da turbina/forsunka/TNVD ishi bajarilgan (${fmtUzs(maintTotal(m))}), dvigatel tarixida yo'q.`,
            action: ENGINE_PATH,
            quick: { kind: 'engine_record', prefill: { date: isoDay(m.date), mileage: m.mileage ?? undefined, cost: maintTotal(m) || undefined, recordType: 'minor_repair', description: m.parts.map(p => p.name).slice(0, 5).join(', ') } },
          }))
        }
      }
      return out
    },
  },
  {
    key: 'engine.gearbox_no_interval', no: 12, category: 'engine',
    name: "Korobka ta'mirlangan, korobka moyi intervali yo'q",
    run: (c) => {
      const out: Finding[] = []
      const since = c.ago(365)
      for (const v of c.active) {
        const gb = (c.maintByV.get(v.id) || []).filter(m => m.date >= since && m.status === 'approved' && isGearbox(maintText(m)))
        if (!gb.length || c.intervalsByV.get(v.id)?.has('gearbox_oil')) continue
        out.push(c.f({
          ruleKey: 'engine.gearbox_no_interval', category: 'engine', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — korobka moyi qachon almashtiriladi?`,
          detail: `${fmtDate(gb[gb.length - 1].date)} da korobka ishi bo'lgan, lekin korobka moyi intervali sozlanmagan — keyingi almashtirish nazoratsiz.`,
          action: { label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` },
        }))
      }
      return out
    },
  },
]
