// C. Yoqilg'i (27–46)
import type { Rule, Finding, FuelSnap } from '../types'
import { DAY_MS, fmtDate, fmtNum, fmtUzs, median, uzDay, consumption, type Ctx } from '../context'

const FUEL = { label: "Yoqilg'i yozuvlari", path: '/fuel' }
const CONS = { label: "Sarf tahlili", path: '/fuel-consumption' }
const MON = { label: 'Bak nazorati', path: '/fuel-monitoring' }
const unit = (ft: string) => (ft === 'gas' ? 'm³' : 'L')

/** Tashkilot yoqilg'ini umuman kiritadimi (so'nggi 60 kunda) */
const orgRecordsFuel = (c: Ctx) => c.s.fuel.some(r => r.date >= c.ago(60))

function priceAt(c: Ctx, ft: string, d: Date): number | null {
  let best: { from: Date; price: number } | null = null
  for (const p of c.s.fuelPrices) {
    if (p.fuelType !== ft || p.from > d) continue
    if (!best || p.from > best.from) best = p
  }
  return best?.price ?? null
}

export const fuelRules: Rule[] = [
  {
    key: 'fuel.moved_no_fuel', no: 27, category: 'fuel', name: "GPS bo'yicha yurgan, yoqilg'i kiritilmagan",
    run: (c) => {
      if (!orgRecordsFuel(c)) return []
      const out: Finding[] = []
      for (const v of c.active) {
        const km = c.kmBetween(v.id, c.ago(30), c.now)
        if (km == null || km < 300) continue
        if ((c.fuelByV.get(v.id) || []).some(r => r.date >= c.ago(30))) continue
        out.push(c.f({
          ruleKey: 'fuel.moved_no_fuel', category: 'fuel', severity: 'critical', vehicleId: v.id,
          title: `${v.plate} — 30 kunda ${fmtNum(km)} km yurgan, yoqilg'i qayerdan olingan?`,
          detail: `GPS bo'yicha mashina ishlagan, lekin oxirgi 30 kunda birorta ham yoqilg'i yozuvi yo'q. Vedomost kiritilmaganmi?`,
          action: { label: 'Vedomost import', path: '/fuel-import' },
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.fuel_while_parked', no: 28, category: 'fuel', name: "Turgan mashinaga yoqilg'i quyilgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        for (const r of c.fuelByV.get(v.id) || []) {
          if (r.date < c.ago(60) || r.liters < 20) continue
          const from = new Date(r.date.getTime() - 3 * DAY_MS)
          const to = new Date(Math.min(c.now.getTime() - DAY_MS, r.date.getTime() + 3 * DAY_MS))
          if (to <= r.date) continue
          const km = c.kmBetween(v.id, from, to)
          if (km == null || km > 5) continue
          // Treker o'sha davrda tirik bo'lganini tasdiqlaymiz (±10 kunda harakat bor) — aks holda
          // uzilgan treker "turgan mashina" bo'lib ko'rinadi (yolg'on signal)
          const alive = c.kmBetween(v.id, new Date(r.date.getTime() - 10 * DAY_MS), new Date(r.date.getTime() + 10 * DAY_MS))
          if (!alive || alive < 50) continue
          out.push(c.f({
            ruleKey: 'fuel.fuel_while_parked', category: 'fuel', severity: 'critical', vehicleId: v.id, subjectKey: r.id,
            title: `${v.plate} — ${fmtDate(r.date)} da ${fmtNum(r.liters)} ${unit(r.fuelType)} quyilgan, lekin mashina joyidan qo'zg'almagan. Yoqilg'i qayerga ketdi?`,
            detail: `Quyish kunidan ±3 kun ichida GPS bo'yicha ${fmtNum(km, 1)} km. ${r.cost > 0 ? `Summa: ${fmtUzs(r.cost)}.` : ''}`,
            action: FUEL, impactUzs: r.cost,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'fuel.over_norm', no: 29, category: 'fuel', name: 'Sarf normadan 20%+ yuqori',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        if (!v.fuelNorm) continue
        const cs = consumption(c, v.id, c.ago(30), c.now)
        if (!cs || cs.per100 <= v.fuelNorm * 1.2) continue
        const extra = ((cs.per100 - v.fuelNorm) / 100) * cs.km
        const impact = extra * c.avgFuelPrice(v.fuelType)
        out.push(c.f({
          ruleKey: 'fuel.over_norm', category: 'fuel', severity: cs.per100 > v.fuelNorm * 1.4 ? 'critical' : 'warning', vehicleId: v.id,
          title: `${v.plate} — sarf normadan ${Math.round((cs.per100 / v.fuelNorm - 1) * 100)}% yuqori. Nega?`,
          detail: `30 kunda ${fmtNum(cs.km)} km, ${fmtNum(cs.liters)} ${unit(v.fuelType)} → ${fmtNum(cs.per100, 1)} /100km (norma ${fmtNum(v.fuelNorm, 1)}). ` +
            `Ortiqcha ~${fmtNum(extra)} ${unit(v.fuelType)}${impact > 0 ? ` ≈ ${fmtUzs(impact)}` : ''}.`,
          action: CONS, impactUzs: impact,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.no_norm', no: 30, category: 'fuel', name: "Yoqilg'i normasi belgilanmagan",
    collapse: { title: (n) => `${n} ta mashinada yoqilg'i normasi yo'q — ortiqcha sarfni aniqlab bo'lmaydi`, action: CONS, severity: 'warning' },
    run: (c) => c.active
      .filter(v => !v.fuelNorm && (c.fuelByV.get(v.id) || []).length > 0)
      .map(v => {
        const cs = consumption(c, v.id, c.ago(90), c.now)
        return c.f({
          ruleKey: 'fuel.no_norm', category: 'fuel', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — yoqilg'i normasi qancha? Belgilanmagan`,
          detail: `Normasiz ortiqcha sarfni aniqlab bo'lmaydi.${cs ? ` Haqiqiy o'rtacha sarf: ${fmtNum(cs.per100, 1)} /100km — shuni boshlang'ich norma qilish mumkin.` : ''}`,
          action: { label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` },
        })
      }),
  },
  {
    key: 'fuel.odometer_regress', no: 31, category: 'fuel', name: "Yoqilg'i yozuvida odometr orqaga ketgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const recs = (c.fuelByV.get(v.id) || []).filter(r => r.odometer > 0)
        const bad: Array<[FuelSnap, FuelSnap]> = []
        for (let i = 1; i < recs.length; i++) if (recs[i].odometer < recs[i - 1].odometer - 1) bad.push([recs[i - 1], recs[i]])
        if (!bad.length) continue
        const [a, b] = bad[bad.length - 1]
        out.push(c.f({
          ruleKey: 'fuel.odometer_regress', category: 'fuel', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — odometr nega orqaga ketgan?`,
          detail: `${bad.length} ta holat. Oxirgisi: ${fmtDate(a.date)} — ${fmtNum(a.odometer)} km, ${fmtDate(b.date)} — ${fmtNum(b.odometer)} km. Sarf hisobi buziladi.`,
          action: FUEL,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.zero_odometer', no: 32, category: 'fuel', name: "Odometr 0 kiritilgan",
    collapse: { title: (n) => `${n} ta mashinada yoqilg'i odometrsiz kiritilmoqda`, action: FUEL },
    run: (c) => {
      // GPS rejimida odometr shart emas — jim
      if (c.s.org.fuelDistanceMode === 'gps' && c.s.org.gpsConnected) return []
      const out: Finding[] = []
      for (const v of c.active) {
        const zero = (c.fuelByV.get(v.id) || []).filter(r => r.date >= c.ago(60) && r.odometer <= 0)
        if (!zero.length) continue
        out.push(c.f({
          ruleKey: 'fuel.zero_odometer', category: 'fuel', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — ${zero.length} ta quyishda odometr kiritilmagan`,
          detail: `Odometrsiz (GPS ham yo'q) sarfni hisoblab bo'lmaydi.`,
          action: FUEL,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.over_tank', no: 33, category: 'fuel', name: "Bir quyishda bak hajmidan ko'p",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        if (!v.tankCapacity || v.fuelType === 'gas') continue
        for (const r of c.fuelByV.get(v.id) || []) {
          if (r.date < c.ago(90) || r.liters <= v.tankCapacity * 1.05) continue
          out.push(c.f({
            ruleKey: 'fuel.over_tank', category: 'fuel', severity: 'critical', vehicleId: v.id, subjectKey: r.id,
            title: `${v.plate} — ${fmtDate(r.date)} da bakka ${fmtNum(r.liters)} L qanday sig'di?`,
            detail: `Bak hajmi ${fmtNum(v.tankCapacity)} L. Ortiqcha ${fmtNum(r.liters - v.tankCapacity)} L — boshqa idishga quyilganmi yoki xato kiritilganmi?`,
            action: FUEL, impactUzs: r.liters > 0 ? (r.cost / r.liters) * (r.liters - v.tankCapacity) : 0,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'fuel.multi_fill_day', no: 34, category: 'fuel', name: "Bir kunda bir necha quyish, jami bakdan ko'p",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        if (!v.tankCapacity || v.fuelType === 'gas') continue
        const byDay = new Map<string, FuelSnap[]>()
        for (const r of c.fuelByV.get(v.id) || []) {
          if (r.date < c.ago(90)) continue
          const k = uzDay(r.date)
          byDay.set(k, [...(byDay.get(k) || []), r])
        }
        for (const [day, rs] of byDay) {
          if (rs.length < 2) continue
          const sum = rs.reduce((s, r) => s + r.liters, 0)
          if (sum <= v.tankCapacity * 1.2) continue
          out.push(c.f({
            ruleKey: 'fuel.multi_fill_day', category: 'fuel', severity: 'warning', vehicleId: v.id, subjectKey: day,
            title: `${v.plate} — bir kunda ${rs.length} marta, jami ${fmtNum(sum)} L quyilgan. Bunga ehtiyoj bormidi?`,
            detail: `${fmtDate(rs[0].date)}: bak ${fmtNum(v.tankCapacity)} L. Uzoq reys bo'lmagan bo'lsa — tekshiring.`,
            action: FUEL,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'fuel.type_mismatch', no: 35, category: 'fuel', name: "Yoqilg'i turi mashinaga mos emas",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        if (v.fuelType === 'hybrid') continue
        const bad = (c.fuelByV.get(v.id) || []).filter(r => r.date >= c.ago(90) && r.fuelType !== v.fuelType)
        if (!bad.length) continue
        out.push(c.f({
          ruleKey: 'fuel.type_mismatch', category: 'fuel', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — mashinaga boshqa turdagi yoqilg'i quyilganmi?`,
          detail: `${bad.length} ta yozuvda yoqilg'i turi mashina turidan farq qiladi (oxirgisi ${fmtDate(bad[bad.length - 1].date)}). Xato kiritish yoki boshqa mashinaga quyilgan.`,
          action: FUEL,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.price_mismatch', no: 36, category: 'fuel', name: "Litr narxi narx tarixidan farq qiladi",
    run: (c) => {
      if (!c.s.fuelPrices.length) return []
      const out: Finding[] = []
      for (const v of c.vehicles) {
        let n = 0, extra = 0
        let example: { r: FuelSnap; unitP: number; ref: number } | null = null
        for (const r of c.fuelByV.get(v.id) || []) {
          if (r.date < c.ago(60) || r.liters <= 0 || r.cost <= 0) continue
          const ref = priceAt(c, r.fuelType, r.date)
          if (!ref) continue
          const unitP = r.cost / r.liters
          if (Math.abs(unitP - ref) / ref <= 0.15) continue
          n++
          if (unitP > ref) extra += (unitP - ref) * r.liters
          example = { r, unitP, ref }
        }
        if (!n || !example) continue
        out.push(c.f({
          ruleKey: 'fuel.price_mismatch', category: 'fuel', severity: extra > 0 ? 'warning' : 'info', vehicleId: v.id,
          title: `${v.plate} — yoqilg'i narxi nega boshqacha?`,
          detail: `${n} ta quyishda litr narxi belgilangan narxdan 15%+ farq qiladi. Masalan ${fmtDate(example.r.date)}: ${fmtNum(example.unitP)} so'm (belgilangan ${fmtNum(example.ref)} so'm).`,
          action: FUEL, impactUzs: extra,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.import_draft', no: 37, category: 'fuel', name: "Vedomost tasdiqlanmagan",
    run: (c) => c.s.fuelImports
      .filter(i => i.status === 'draft' && c.daysSince(i.createdAt) >= 7)
      .map(i => c.f({
        ruleKey: 'fuel.import_draft', category: 'fuel', severity: 'warning', subjectKey: i.id,
        title: `"${i.title}" vedomosti ${c.daysSince(i.createdAt)} kundan beri tasdiqlanmagan. Unutilganmi?`,
        detail: `Tasdiqlanmaguncha bu yoqilg'i hisobotlarda va sarf tahlilida yo'q.`,
        action: { label: 'Vedomostni ochish', path: '/fuel-import' },
      })),
  },
  {
    key: 'fuel.import_unmatched', no: 38, category: 'fuel', name: "Vedomostda bog'lanmagan qatorlar",
    run: (c) => c.s.fuelImports
      .filter(i => i.status === 'draft' && i.unmatchedRows > 0)
      .map(i => c.f({
        ruleKey: 'fuel.import_unmatched', category: 'fuel', severity: 'warning', subjectKey: i.id,
        title: `"${i.title}" vedomostida ${i.unmatchedRows} ta qator qaysi mashinaga tegishli?`,
        detail: `Davlat raqami mashinaga bog'lanmagan — bu qatorlar kirim qilinmaydi.`,
        action: { label: 'Vedomostni ochish', path: '/fuel-import' },
      })),
  },
  {
    key: 'fuel.above_own_avg', no: 39, category: 'fuel', name: "Sarf o'z o'rtachasidan 25%+ oshgan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const cur = consumption(c, v.id, c.ago(30), c.now)
        const prev = consumption(c, v.id, c.ago(120), c.ago(30), 600)
        if (!cur || !prev || cur.per100 <= prev.per100 * 1.25) continue
        const extra = ((cur.per100 - prev.per100) / 100) * cur.km
        const impact = extra * c.avgFuelPrice(v.fuelType)
        out.push(c.f({
          ruleKey: 'fuel.above_own_avg', category: 'fuel', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — bu oy sarf ${Math.round((cur.per100 / prev.per100 - 1) * 100)}% oshdi. Nima o'zgardi?`,
          detail: `Oxirgi 30 kun: ${fmtNum(cur.per100, 1)} /100km, oldingi 3 oy: ${fmtNum(prev.per100, 1)} /100km. Haydovchi, marshrut yoki texnik nosozlik?` +
            `${impact > 0 ? ` Farq ≈ ${fmtUzs(impact)}.` : ''}`,
          action: CONS, impactUzs: impact,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.above_model_median', no: 40, category: 'fuel', name: "Sarf shu model medianasidan 30%+ yuqori",
    run: (c) => {
      const byModel = new Map<string, Array<{ id: string; per100: number; km: number; ft: string }>>()
      for (const v of c.active) {
        const cs = consumption(c, v.id, c.ago(60), c.now, 500)
        if (!cs) continue
        const k = `${v.brand} ${v.model}`.trim()
        byModel.set(k, [...(byModel.get(k) || []), { id: v.id, per100: cs.per100, km: cs.km, ft: v.fuelType }])
      }
      const out: Finding[] = []
      for (const [model, rows] of byModel) {
        if (rows.length < 3) continue
        const med = median(rows.map(r => r.per100))
        for (const r of rows) {
          if (r.per100 <= med * 1.3) continue
          const extra = ((r.per100 - med) / 100) * r.km
          const impact = extra * c.avgFuelPrice(r.ft)
          out.push(c.f({
            ruleKey: 'fuel.above_model_median', category: 'fuel', severity: 'warning', vehicleId: r.id,
            title: `${c.plate(r.id)} — xuddi shunday ${model}lardan ${Math.round((r.per100 / med - 1) * 100)}% ko'p yoqmoqda. Nega?`,
            detail: `60 kunlik sarf ${fmtNum(r.per100, 1)} /100km, shu modeldagi ${rows.length} ta mashina medianasi ${fmtNum(med, 1)}.` +
              `${impact > 0 ? ` Farq ≈ ${fmtUzs(impact)}.` : ''}`,
            action: CONS, impactUzs: impact,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'fuel.sensor_theft', no: 41, category: 'fuel', name: 'Bak sensori: sliv belgisi',
    run: (c) => {
      const out: Finding[] = []
      const byV = new Map<string, typeof c.s.fuelAnomalies>()
      for (const a of c.s.fuelAnomalies) if (a.anomaly === 'theft') byV.set(a.vehicleId, [...(byV.get(a.vehicleId) || []), a])
      for (const [vid, xs] of byV) {
        if (!c.vehicle.has(vid)) continue
        const liters = xs.reduce((s, a) => s + Math.abs(a.deltaL || 0), 0)
        const v = c.vehicle.get(vid)!
        out.push(c.f({
          ruleKey: 'fuel.sensor_theft', category: 'fuel', severity: 'critical', vehicleId: vid,
          title: `${v.plate} — 30 kunda ${xs.length} marta bakdan yoqilg'i kamaygan (dvigatel o'chiq). Sliv bo'ldimi?`,
          detail: `Jami ~${fmtNum(liters)} L. Oxirgisi ${fmtDate(xs[xs.length - 1].at)}. Haydovchi bilan gaplashing, sensor xaritasida joyini ko'ring.`,
          action: MON, impactUzs: liters * c.avgFuelPrice(v.fuelType),
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.sensor_unrecorded', no: 42, category: 'fuel', name: 'Bak sensori: chek yo\'q quyish',
    run: (c) => {
      const out: Finding[] = []
      const byV = new Map<string, typeof c.s.fuelAnomalies>()
      for (const a of c.s.fuelAnomalies) if (a.anomaly === 'unrecorded_refuel') byV.set(a.vehicleId, [...(byV.get(a.vehicleId) || []), a])
      for (const [vid, xs] of byV) {
        if (!c.vehicle.has(vid)) continue
        const liters = xs.reduce((s, a) => s + Math.abs(a.deltaL || 0), 0)
        out.push(c.f({
          ruleKey: 'fuel.sensor_unrecorded', category: 'fuel', severity: 'warning', vehicleId: vid,
          title: `${c.plate(vid)} — bakka ${xs.length} marta yoqilg'i quyilgan, lekin yozuv yo'q. Qayerdan quyilgan?`,
          detail: `Sensor ~${fmtNum(liters)} L ko'tarilishni ko'rdi (oxirgisi ${fmtDate(xs[xs.length - 1].at)}), tizimda mos yoqilg'i yozuvi topilmadi.`,
          action: MON,
        }))
      }
      return out
    },
  },
  {
    key: 'fuel.sensor_no_tank', no: 43, category: 'fuel', name: "Sensor bor, bak hajmi sozlanmagan",
    run: (c) => c.active
      .filter(v => (v.fuelSensorName || v.lastFuelUpdate) && !v.tankCapacity)
      .map(v => c.f({
        ruleKey: 'fuel.sensor_no_tank', category: 'fuel', severity: 'info', vehicleId: v.id,
        title: `${v.plate} — bak hajmi necha litr?`,
        detail: `Yoqilg'i sensori ishlaydi, lekin bak hajmi kiritilmagan — "bakdan ko'p quyish" nazorati ishlamaydi.`,
        action: MON,
      })),
  },
  {
    key: 'fuel.org_spend_up', no: 44, category: 'fuel', name: "Yoqilg'i xarajati oshgan (tashkilot)",
    run: (c) => {
      const sum = (from: Date, to: Date) => c.s.fuel.filter(r => r.date >= from && r.date < to).reduce((s, r) => s + r.cost, 0)
      const cur = sum(c.ago(30), c.now)
      const prev = sum(c.ago(60), c.ago(30))
      if (prev <= 0 || cur <= prev * 1.2) return []
      const curKm = c.active.reduce((s, v) => s + (c.kmBetween(v.id, c.ago(30), c.now) || 0), 0)
      const prevKm = c.active.reduce((s, v) => s + (c.kmBetween(v.id, c.ago(60), c.ago(30)) || 0), 0)
      const kmNote = prevKm > 0 && curKm > 0 ? ` Shu davrda yurilgan km ${Math.round((curKm / prevKm - 1) * 100)}% o'zgargan.` : ''
      return [c.f({
        ruleKey: 'fuel.org_spend_up', category: 'fuel', severity: 'warning',
        title: `Yoqilg'i xarajati oxirgi 30 kunda ${Math.round((cur / prev - 1) * 100)}% oshdi. Sabab nima?`,
        detail: `${fmtUzs(cur)} (oldingi 30 kun: ${fmtUzs(prev)}).${kmNote} Narx oshganmi, ish hajmimi yoki ortiqcha sarfmi?`,
        action: CONS, impactUzs: cur - prev,
      })]
    },
  },
  {
    key: 'fuel.no_supplier', no: 45, category: 'fuel', name: "Yetkazib beruvchi ko'rsatilmagan",
    run: (c) => {
      const recent = c.s.fuel.filter(r => r.date >= c.ago(60))
      const withSup = recent.filter(r => r.supplierId).length
      const without = recent.length - withSup
      // Tashkilot yetkazuvchini yuritmasa — jim
      if (withSup === 0 || without === 0) return []
      return [c.f({
        ruleKey: 'fuel.no_supplier', category: 'fuel', severity: 'info',
        title: `${without} ta yoqilg'i yozuvi qaysi yetkazib beruvchidan?`,
        detail: `So'nggi 60 kunda ${recent.length} ta yozuvdan ${without} tasida yetkazib beruvchi yo'q — yetkazuvchi bilan solishtirish (sverka) chala chiqadi.`,
        action: FUEL,
      })]
    },
  },
  {
    key: 'fuel.duplicate_fill', no: 46, category: 'fuel', name: "Quyishlar orasi juda qisqa (takroriy?)",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const recs = (c.fuelByV.get(v.id) || []).filter(r => r.date >= c.ago(60) && r.liters >= 10)
        for (let i = 1; i < recs.length; i++) {
          const a = recs[i - 1], b = recs[i]
          if (b.date.getTime() - a.date.getTime() > 2 * DAY_MS) continue
          let km: number | null = c.kmBetween(v.id, a.date, b.date)
          if (km == null && a.odometer > 0 && b.odometer > 0) km = b.odometer - a.odometer
          if (km == null || km < 0 || km >= 20) continue
          out.push(c.f({
            ruleKey: 'fuel.duplicate_fill', category: 'fuel', severity: 'warning', vehicleId: v.id, subjectKey: b.id,
            title: `${v.plate} — ${fmtDate(a.date)} va ${fmtDate(b.date)} quyishlari orasida ${fmtNum(km)} km. Ikki marta kiritilganmi?`,
            detail: `${fmtNum(a.liters)} va ${fmtNum(b.liters)} ${unit(b.fuelType)}. Takroriy yozuv bo'lsa — o'chiring.`,
            action: FUEL, impactUzs: b.cost,
          }))
        }
      }
      return out
    },
  },
]
