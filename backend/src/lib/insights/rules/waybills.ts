// I. Yo'l varaqasi (107–113)
import type { Rule, Finding } from '../types'
import { DAY_MS, fmtDate, fmtNum, uzDay, dailyKmEvidence, type Ctx } from '../context'
import { waybillEv, fuelEv, table } from '../evidence'

const WB = { label: "Yo'l varaqalari", path: '/waybills' }
const usesWaybills = (c: Ctx) => c.s.waybills.some(w => w.createdAt >= c.ago(90))

export const waybillRules: Rule[] = [
  {
    key: 'waybills.open_too_long', no: 107, category: 'waybills', name: "Faol varaqa yopilmagan",
    run: (c) => c.s.waybills
      .filter(w => w.status === 'active' && c.daysSince(w.actualDeparture || w.plannedDeparture) >= 3)
      .map(w => c.f({
        ruleKey: 'waybills.open_too_long', category: 'waybills', severity: 'warning', vehicleId: w.vehicleId, subjectKey: w.id,
        title: `${c.plate(w.vehicleId)} — ${w.number} yo'l varaqasi ${c.daysSince(w.actualDeparture || w.plannedDeparture)} kundan beri ochiq. Mashina qaytdimi?`,
        detail: `Chiqish: ${fmtDate(w.actualDeparture || w.plannedDeparture)}. Yopilmagan varaqada masofa va yoqilg'i hisoblanmaydi.`,
        action: WB, evidence: waybillEv([w]),
      })),
  },
  {
    key: 'waybills.no_return_odo', no: 108, category: 'waybills', name: "Qaytish odometri yo'q",
    run: (c) => {
      const bad = c.s.waybills.filter(w => w.status === 'completed' && w.returnOdometer == null && w.createdAt >= c.ago(60))
      if (!bad.length) return []
      return [c.f({
        ruleKey: 'waybills.no_return_odo', category: 'waybills', severity: 'info',
        title: `${bad.length} ta yopilgan varaqada qaytish odometri yozilmagan`,
        detail: `Masalan: ${bad.slice(0, 3).map(w => `${w.number} (${c.plate(w.vehicleId)})`).join(', ')}. Masofasiz varaqa — rasmiyatchilik.`,
        action: WB, evidence: waybillEv(bad, undefined, c.plate),
      })]
    },
  },
  {
    key: 'waybills.distance_vs_gps', no: 109, category: 'waybills', name: "Varaqa masofasi GPS'dan farq qiladi",
    run: (c) => {
      const out: Finding[] = []
      for (const w of c.s.waybills) {
        if (w.status !== 'completed' || w.createdAt < c.ago(60)) continue
        if (w.departureOdometer == null || w.returnOdometer == null || !w.actualDeparture || !w.actualReturn) continue
        const dist = w.returnOdometer - w.departureOdometer
        if (dist <= 0) continue
        const gps = c.kmBetween(w.vehicleId, w.actualDeparture, w.actualReturn)
        if (gps == null || gps <= 0) continue
        if (Math.abs(dist - gps) <= 30 || Math.abs(dist - gps) / gps <= 0.2) continue
        out.push(c.f({
          ruleKey: 'waybills.distance_vs_gps', category: 'waybills', severity: dist > gps ? 'warning' : 'info', vehicleId: w.vehicleId, subjectKey: w.id,
          title: `${c.plate(w.vehicleId)} — ${w.number} varaqada ${fmtNum(dist)} km, GPS esa ${fmtNum(gps)} km ko'rsatmoqda. Qaysi biri to'g'ri?`,
          detail: `${fmtDate(w.actualDeparture)}–${fmtDate(w.actualReturn)}. ${dist > gps ? "Varaqada km oshirib yozilgan bo'lsa — ortiqcha yoqilg'i hisobdan chiqarilgan." : ''}`,
          action: WB,
          evidence: {
            ...dailyKmEvidence(c, w.vehicleId, w.actualDeparture, w.actualReturn,
              `Varaqa ${w.number}: odometr ${fmtNum(w.departureOdometer)} → ${fmtNum(w.returnOdometer)} = ${fmtNum(dist)} km. GPS kunlar bo'yicha (jami ${fmtNum(gps)} km):`),
            refs: undefined,
          },
        }))
      }
      return out
    },
  },
  {
    key: 'waybills.fuel_vs_records', no: 110, category: 'waybills', name: "Varaqadagi yoqilg'i yozuvlarga mos emas",
    run: (c) => {
      const out: Finding[] = []
      for (const w of c.s.waybills) {
        if (w.status !== 'completed' || w.createdAt < c.ago(60) || w.fuelIssued <= 0 || !w.actualDeparture) continue
        const end = w.actualReturn || w.actualDeparture
        const fills = (c.fuelByV.get(w.vehicleId) || [])
          .filter(r => r.date.getTime() >= w.actualDeparture!.getTime() - DAY_MS && r.date.getTime() <= end.getTime() + DAY_MS)
        const liters = fills.reduce((s, r) => s + r.liters, 0)
        if (Math.abs(liters - w.fuelIssued) <= 10 || Math.abs(liters - w.fuelIssued) / w.fuelIssued <= 0.2) continue
        out.push(c.f({
          ruleKey: 'waybills.fuel_vs_records', category: 'waybills', severity: 'warning', vehicleId: w.vehicleId, subjectKey: w.id,
          title: `${c.plate(w.vehicleId)} — ${w.number} varaqada ${fmtNum(w.fuelIssued)} L berilgan, yoqilg'i yozuvlarida esa ${fmtNum(liters)} L. Farq qayerda?`,
          detail: `Reys: ${fmtDate(w.actualDeparture)}–${fmtDate(end)}.`,
          action: WB,
          evidence: fills.length
            ? fuelEv(fills, `Varaqa ${w.number}: ${fmtNum(w.fuelIssued, 1)} L berilgan. Reys davridagi (±1 kun) yoqilg'i yozuvlari — jami ${fmtNum(liters, 1)} L:`)
            : waybillEv([w], "Reys davrida (±1 kun) birorta ham yoqilg'i yozuvi yo'q."),
        }))
      }
      return out
    },
  },
  {
    key: 'waybills.moved_without', no: 111, category: 'waybills', name: "Varaqasiz yurgan kunlar",
    run: (c) => {
      if (!usesWaybills(c) || !c.gpsCacheAlive) return []
      const out: Finding[] = []
      const from = uzDay(c.ago(30))
      for (const v of c.active) {
        const m = c.dailyKm.get(v.id)
        if (!m) continue
        const covered = new Set<string>()
        for (const w of c.waybillsByV.get(v.id) || []) {
          if (w.status === 'cancelled') continue
          const a = (w.actualDeparture || w.plannedDeparture).getTime()
          const b = (w.actualReturn || (w.status === 'active' ? c.now : w.actualDeparture || w.plannedDeparture)).getTime()
          for (let t = a; t <= b + 1; t += DAY_MS) covered.add(uzDay(new Date(t)))
          covered.add(uzDay(new Date(b)))
        }
        // Mashina umuman varaqa bilan ishlamasa — boshqa qoida emas, jim
        if (!(c.waybillsByV.get(v.id) || []).length) continue
        const days = [...m.entries()].filter(([d, km]) => d >= from && km > 20 && !covered.has(d)).map(([d]) => d).sort()
        if (days.length < 5) continue
        out.push(c.f({
          ruleKey: 'waybills.moved_without', category: 'waybills', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — 30 kunda ${days.length} kun yo'l varaqasiz yurgan. Kim va qayerga?`,
          detail: `Masalan: ${days.slice(-4).map(d => d.split('-').reverse().join('.')).join(', ')}.`,
          action: WB,
          evidence: table(['Kun', 'GPS km', "Yo'l varaqasi"], days.map(d => [d.split('-').reverse().join('.'), fmtNum(m.get(d) || 0), "yo'q"]),
            '20 km dan ko\'p yurgan, lekin hech bir varaqa qamramagan kunlar.'),
        }))
      }
      return out
    },
  },
  {
    key: 'waybills.no_mechanic', no: 112, category: 'waybills', name: 'Mexanik tasdiqlamagan varaqa',
    run: (c) => {
      const recent = c.s.waybills.filter(w => ['active', 'completed'].includes(w.status) && w.createdAt >= c.ago(30))
      const bad = recent.filter(w => !w.mechanicApproved)
      // Tashkilot mexanik tasdig'ini umuman ishlatmasa — jim
      if (!bad.length || bad.length === recent.length) return []
      return [c.f({
        ruleKey: 'waybills.no_mechanic', category: 'waybills', severity: 'warning',
        title: `${bad.length} ta reys mexanik ko'rigisiz chiqqan`,
        detail: `Masalan: ${bad.slice(0, 3).map(w => `${w.number} (${c.plate(w.vehicleId)})`).join(', ')}. Texnik nosoz mashina yo'lga chiqishi mumkin.`,
        action: WB, evidence: waybillEv(bad, `30 kundagi ${recent.length} ta varaqadan ${bad.length} tasi mexanik tasdig'isiz.`, c.plate),
      })]
    },
  },
  {
    key: 'waybills.stale_drafts', no: 113, category: 'waybills', name: 'Eski qoralama varaqalar',
    run: (c) => {
      const bad = c.s.waybills.filter(w => w.status === 'draft' && c.daysSince(w.createdAt) >= 7)
      if (!bad.length) return []
      return [c.f({
        ruleKey: 'waybills.stale_drafts', category: 'waybills', severity: 'info',
        title: `${bad.length} ta yo'l varaqasi bir haftadan beri qoralamada`,
        detail: `Reys bo'lgan bo'lsa — faollashtiring va yoping; bo'lmagan bo'lsa — bekor qiling.`,
        action: WB, evidence: waybillEv(bad, undefined, c.plate),
      })]
    },
  },
]
