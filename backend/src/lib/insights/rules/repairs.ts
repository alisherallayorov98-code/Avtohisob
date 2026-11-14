// G. Ta'mir sifati va xarajat (79–98)
// Olib tashlangan (2026-11, foydalanuvchi qarori — eski mashina tez-tez ta'mirlanishi tabiiy, shovqin):
//   #80 usta bir mashinani tez-tez ta'mirlaydi, #81 xarajat odatdagidan 3 baravar,
//   #89 qism narxi o'rtachadan qimmat, #93 3 oyda 5+ ta'mir. Raqamlar boshqa qoidaga berilmaydi.
import type { Rule, Finding, MaintSnap } from '../types'
import { DAY_MS, fmtDate, fmtNum, fmtUzs, maintText, maintTotal, median, type Ctx } from '../context'
import { isConsumable, isBrakePads, isTimingBelt, isBattery, isClutch } from '../keywords'

const MAINT = { label: "Ta'mirlar", path: '/maintenance' }
const approved = (c: Ctx, vid: string) => (c.maintByV.get(vid) || []).filter(m => m.status === 'approved')

/** Kalit so'z bo'yicha oxirgi almashtirish va inson shkalasidagi masofa */
function partWear(c: Ctx, vid: string, test: (t: string) => boolean): { last: MaintSnap | null; firstKm: number | null; lastKnownKm: number } {
  const recs = approved(c, vid)
  const hits = recs.filter(m => test(maintText(m)))
  const kms = recs.map(m => m.mileage).filter((x): x is number => !!x)
  return { last: hits[hits.length - 1] || null, firstKm: kms.length ? Math.min(...kms) : null, lastKnownKm: c.humanKm(vid) }
}

function wearRule(no: number, key: string, name: string, test: (t: string) => boolean, limitKm: number, label: string, severity: 'warning' | 'info'): Rule {
  return {
    key, no, category: 'repairs', name,
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const { last, firstKm, lastKnownKm } = partWear(c, v.id, test)
        if (last?.mileage) {
          const driven = lastKnownKm - last.mileage
          if (driven <= limitKm) continue
          out.push(c.f({
            ruleKey: key, category: 'repairs', severity, vehicleId: v.id,
            title: `${v.plate} — ${label} ${fmtNum(driven)} km'dan beri almashtirilmagan. Tekshirildimi?`,
            detail: `Oxirgi almashtirish ${fmtDate(last.date)}, ${fmtNum(last.mileage)} km. Tavsiya: har ${fmtNum(limitKm)} km.`,
            action: MAINT,
          }))
        } else if (!last && firstKm != null && lastKnownKm - firstKm > limitKm) {
          out.push(c.f({
            ruleKey: key, category: 'repairs', severity: 'info', vehicleId: v.id,
            title: `${v.plate} — ${label} hech almashtirilganmi?`,
            detail: `Ta'mir tarixida ${fmtNum(lastKnownKm - firstKm)} km davomida ${label} almashtirilgani yozilmagan.`,
            action: MAINT,
          }))
        }
      }
      return out
    },
  }
}

export const repairRules: Rule[] = [
  {
    key: 'repairs.repeat_part', no: 79, category: 'repairs', name: 'Bir xil detal tez orada qayta almashtirilgan',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const seen = new Map<string, { date: Date; name: string; worker: string | null }>()
        for (const m of approved(c, v.id).filter(m => m.date >= c.ago(365))) {
          for (const p of m.parts) {
            if (!p.sparePartId || isConsumable(p.name)) continue
            const prev = seen.get(p.sparePartId)
            if (prev && m.date.getTime() - prev.date.getTime() <= c.t.repeatPartDays * DAY_MS && m.date.getTime() - prev.date.getTime() > DAY_MS) {
              out.push(c.f({
                ruleKey: 'repairs.repeat_part', category: 'repairs', severity: 'warning', vehicleId: v.id, subjectKey: `${p.sparePartId}|${m.id}`,
                title: `${v.plate} — "${p.name}" ${Math.round((m.date.getTime() - prev.date.getTime()) / DAY_MS)} kunda ikkinchi marta almashtirildi. Nega tez buzildi?`,
                detail: `${fmtDate(prev.date)}${prev.worker ? ` (${prev.worker})` : ''} va ${fmtDate(m.date)}${m.workerName ? ` (${m.workerName})` : ''}. ` +
                  `Sifatsiz qism, noto'g'ri o'rnatish yoki qism aslida o'rnatilmaganmi?`,
                action: MAINT, impactUzs: p.unitCost * p.qty,
                evidence: {
                  columns: ['Sana', 'Qism', 'Usta', 'Narx'],
                  rows: [[fmtDate(prev.date), prev.name, prev.worker || '—', '—'], [fmtDate(m.date), p.name, m.workerName || '—', fmtNum(p.unitCost * p.qty)]],
                },
              }))
            }
            seen.set(p.sparePartId, { date: m.date, name: p.name, worker: m.workerName })
          }
        }
      }
      return out
    },
  },
  {
    key: 'repairs.no_mileage', no: 82, category: 'repairs', name: "Ta'mirda probeg kiritilmagan",
    collapse: { title: (n) => `${n} ta mashinada ta'mirlar probegsiz kiritilmoqda`, action: MAINT },
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const ms = approved(c, v.id).filter(m => m.date >= c.ago(90) && !m.mileage)
        if (!ms.length) continue
        out.push(c.f({
          ruleKey: 'repairs.no_mileage', category: 'repairs', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — ${ms.length} ta ta'mir qaysi probegda bo'lgan?`,
          detail: `Probegsiz ta'mirdan detal qancha yurganini va keyingi almashtirishni hisoblab bo'lmaydi.`,
          action: MAINT,
        }))
      }
      return out
    },
  },
  {
    key: 'repairs.pending_approval', no: 83, category: 'repairs', name: 'Tasdiqlash kutayotgan ta\'mir',
    run: (c) => c.s.pendingMaintenance
      .filter(m => m.status === 'pending_approval' && c.daysSince(m.createdAt) >= c.t.pendingApprovalDays && c.vehicle.has(m.vehicleId))
      .map(m => c.f({
        ruleKey: 'repairs.pending_approval', category: 'repairs', severity: 'warning', vehicleId: m.vehicleId, subjectKey: m.id,
        title: `${c.plate(m.vehicleId)} — ${fmtUzs(maintTotal(m))} ta'mir ${c.daysSince(m.createdAt)} kundan beri tasdiqlanmagan`,
        detail: `Kiritilgan: ${fmtDate(m.createdAt)}. Tasdiqlanmaguncha xarajat hisobotga va ombor qoldig'iga tushmaydi.`,
        action: MAINT, impactUzs: maintTotal(m),
      })),
  },
  {
    key: 'repairs.no_evidence', no: 84, category: 'repairs', name: "Katta ta'mir, rasm (dalil) yo'q",
    collapse: { title: (n) => `${n} ta mashinada katta ta'mirlar rasmsiz`, action: MAINT },
    run: (c) => {
      const out: Finding[] = []
      // Tashkilot dalil yuklashni umuman ishlatmasa — jim
      if (!c.s.maintenance.some(m => m.evidenceCount > 0)) return []
      for (const v of c.vehicles) {
        const ms = approved(c, v.id).filter(m => m.date >= c.ago(90) && maintTotal(m) >= c.t.bigRepairUzs && m.evidenceCount === 0)
        for (const m of ms) out.push(c.f({
          ruleKey: 'repairs.no_evidence', category: 'repairs', severity: 'info', vehicleId: v.id, subjectKey: m.id,
          title: `${v.plate} — ${fmtDate(m.date)} dagi ${fmtUzs(maintTotal(m))} ta'mir rostdan bajarilganmi? Rasm yo'q`,
          detail: `Katta summali ta'mirga eski qism yoki ish rasmi biriktirilmagan.`,
          action: MAINT,
        }))
      }
      return out
    },
  },
  {
    key: 'repairs.mileage_above_current', no: 85, category: 'repairs', name: "Ta'mir probegi joriy probegdan katta",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        if (c.isGpsLinked(v)) continue // GPS shkalasi farq qilishi mumkin
        for (const m of approved(c, v.id).filter(m => m.date >= c.ago(180))) {
          if (!m.mileage || m.mileage <= v.mileage + 1000) continue
          out.push(c.f({
            ruleKey: 'repairs.mileage_above_current', category: 'repairs', severity: 'info', vehicleId: v.id, subjectKey: m.id,
            title: `${v.plate} — ${fmtDate(m.date)} ta'mirida probeg ${fmtNum(m.mileage)} km. Xato emasmi?`,
            detail: `Mashinaning joriy probegi ${fmtNum(v.mileage)} km — ta'mir probegi undan katta.`,
            action: MAINT,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'repairs.future_date', no: 86, category: 'repairs', name: "Ta'mir sanasi kelajakda",
    run: (c) => c.s.maintenance
      .filter(m => m.status === 'approved' && m.date.getTime() > c.now.getTime() + DAY_MS && c.vehicle.has(m.vehicleId))
      .map(m => c.f({
        ruleKey: 'repairs.future_date', category: 'repairs', severity: 'warning', vehicleId: m.vehicleId, subjectKey: m.id,
        title: `${c.plate(m.vehicleId)} — ta'mir sanasi ${fmtDate(m.date)}. Sana xato kiritilganmi?`,
        detail: `Kelajak sanali yozuv oylik hisobotlarni buzadi.`,
        action: MAINT,
      })),
  },
  {
    key: 'repairs.unpaid', no: 87, category: 'repairs', name: "To'lanmagan ta'mir 30+ kun",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const ms = approved(c, v.id).filter(m => !m.isPaid && c.daysSince(m.date) >= 30)
        if (!ms.length) continue
        const total = ms.reduce((s, m) => s + maintTotal(m), 0)
        out.push(c.f({
          ruleKey: 'repairs.unpaid', category: 'repairs', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — ${ms.length} ta ta'mir uchun ${fmtUzs(total)} hali to'lanmagan`,
          detail: `Eng eskisi ${fmtDate(ms[0].date)}. To'langan bo'lsa — belgilang; qarz bo'lsa — kimga?`,
          action: MAINT, impactUzs: total,
        }))
      }
      return out
    },
  },
  {
    key: 'repairs.labor_heavy', no: 88, category: 'repairs', name: "Ish haqi qism narxidan 2 baravar ko'p",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        for (const m of approved(c, v.id).filter(m => m.date >= c.ago(90))) {
          if (m.laborCost < 500_000 || m.laborCost <= m.cost * 2) continue
          out.push(c.f({
            ruleKey: 'repairs.labor_heavy', category: 'repairs', severity: 'info', vehicleId: v.id, subjectKey: m.id,
            title: `${v.plate} — ${fmtDate(m.date)} da usta haqi ${fmtUzs(m.laborCost)}, qismlar esa ${fmtUzs(m.cost)}. Narx kelishilganmi?`,
            detail: `${m.workerName ? `Usta: ${m.workerName}. ` : ''}Bajarilgan ish hajmini tekshiring.`,
            action: MAINT, impactUzs: m.laborCost - m.cost * 2,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'repairs.unofficial_share_up', no: 90, category: 'repairs', name: "Norasmiy ta'mirlar ulushi oshgan",
    run: (c) => {
      const share = (from: Date, to: Date) => {
        const ms = c.s.maintenance.filter(m => m.status === 'approved' && m.date >= from && m.date < to)
        const total = ms.reduce((s, m) => s + maintTotal(m), 0)
        const unoff = ms.filter(m => !m.isOfficial).reduce((s, m) => s + maintTotal(m), 0)
        return total > 0 ? { pct: unoff / total, unoff } : null
      }
      const cur = share(c.ago(30), c.now)
      const prev = share(c.ago(60), c.ago(30))
      if (!cur || !prev || cur.pct < 0.3 || cur.pct - prev.pct < 0.15) return []
      return [c.f({
        ruleKey: 'repairs.unofficial_share_up', category: 'repairs', severity: 'warning',
        title: `Norasmiy (hujjatsiz) ta'mirlar ulushi ${Math.round(prev.pct * 100)}% dan ${Math.round(cur.pct * 100)}% ga oshdi. Nega?`,
        detail: `Oxirgi 30 kunda norasmiy ta'mir ${fmtUzs(cur.unoff)}. Buxgalteriyada asoslab bo'lmaydigan xarajat ko'paymoqda.`,
        action: MAINT,
      })]
    },
  },
  {
    key: 'repairs.old_part_debt', no: 91, category: 'repairs', name: 'Eski qism qaytarilmagan',
    run: (c) => {
      const byV = new Map<string, typeof c.s.oldDebts>()
      for (const d of c.s.oldDebts) if (c.daysSince(d.createdAt) >= 14 && c.vehicle.has(d.vehicleId)) byV.set(d.vehicleId, [...(byV.get(d.vehicleId) || []), d])
      return [...byV.entries()].map(([vid, ds]) => c.f({
        ruleKey: 'repairs.old_part_debt', category: 'repairs', severity: 'warning', vehicleId: vid,
        title: `${c.plate(vid)} — ${ds.length} ta eski qism qaytarilmagan. Qism haqiqatan almashtirilganmi?`,
        detail: `${ds.slice(0, 3).map(d => `"${d.partName}" (${d.workerName})`).join(', ')}. Eng eskisi ${fmtDate(ds[0].createdAt)}.`,
        action: MAINT,
      }))
    },
  },
  {
    key: 'repairs.driven_no_repairs', no: 92, category: 'repairs', name: "Ko'p yurgan, ta'mir yozilmagan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const km = c.kmBetween(v.id, c.ago(120), c.now)
        if (km == null || km < 10_000) continue
        if ((c.maintByV.get(v.id) || []).some(m => m.date >= c.ago(120))) continue
        out.push(c.f({
          ruleKey: 'repairs.driven_no_repairs', category: 'repairs', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — 4 oyda ${fmtNum(km)} km yurdi, birorta ta'mir yo'q. Ta'mirlar kiritilmayaptimi?`,
          detail: `Bunday yurishda odatda moy, filtr, kolodka kabi ishlar bo'ladi. Tashqarida pulga qilinib, tizimga kiritilmagan bo'lishi mumkin.`,
          action: MAINT,
          evidence: {
            note: `Oxirgi ta'mir yozuvi: ${fmtDate((c.maintByV.get(v.id) || []).slice(-1)[0]?.date)}.`,
            columns: ['Oy', 'GPS km'],
            rows: [0, 1, 2, 3].map(mo => [`${fmtDate(c.ago(30 * (mo + 1)))}–${fmtDate(c.ago(30 * mo))}`, fmtNum(c.kmBetween(v.id, c.ago(30 * (mo + 1)), c.ago(30 * mo)) || 0)]),
          },
        }))
      }
      return out
    },
  },
  {
    key: 'repairs.cost_per_km_top', no: 94, category: 'repairs', name: '1 km xarajati eng yuqori',
    run: (c) => {
      const rows: Array<{ id: string; perKm: number; total: number; km: number }> = []
      for (const v of c.active) {
        const km = c.kmBetween(v.id, c.ago(90), c.now)
        if (km == null || km < 1000) continue
        const maint = approved(c, v.id).filter(m => m.date >= c.ago(90)).reduce((s, m) => s + maintTotal(m), 0)
        const fuel = (c.fuelByV.get(v.id) || []).filter(r => r.date >= c.ago(90)).reduce((s, r) => s + r.cost, 0)
        const exp = (c.expensesByV.get(v.id) || []).filter(e => e.date >= c.ago(90)).reduce((s, e) => s + e.amount, 0)
        const total = maint + fuel + exp
        if (total > 0) rows.push({ id: v.id, perKm: total / km, total, km })
      }
      if (rows.length < 10) return []
      const med = median(rows.map(r => r.perKm))
      const top = [...rows].sort((a, b) => b.perKm - a.perKm).slice(0, Math.max(1, Math.floor(rows.length * 0.1)))
      return top.filter(r => r.perKm > med * 1.5).map(r => c.f({
        ruleKey: 'repairs.cost_per_km_top', category: 'repairs', severity: 'info', vehicleId: r.id,
        title: `${c.plate(r.id)} — 1 km ${fmtNum(r.perKm)} so'mga tushmoqda (avtopark o'rtachasi ${fmtNum(med)}). Eng qimmat mashinalardan`,
        detail: `3 oyda ${fmtNum(r.km)} km, jami xarajat ${fmtUzs(r.total)} (yoqilg'i + ta'mir + boshqa).`,
        action: { label: 'Mashina kartochkasi', path: `/vehicles/${r.id}` }, impactUzs: (r.perKm - med) * r.km,
      }))
    },
  },
  wearRule(95, 'repairs.brake_pads', 'Tormoz kolodkasi 50 000 km almashtirilmagan', isBrakePads, 50_000, 'tormoz kolodkasi', 'warning'),
  wearRule(96, 'repairs.timing_belt', 'GRM tasmasi 90 000 km almashtirilmagan', isTimingBelt, 90_000, 'GRM tasmasi', 'info'),
  {
    key: 'repairs.battery', no: 97, category: 'repairs', name: 'Akkumulyator 3 yildan beri almashtirilmagan',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const ms = approved(c, v.id)
        if (!ms.length || c.daysSince(ms[0].date) < 3 * 365) continue
        const last = ms.filter(m => isBattery(maintText(m))).pop()
        if (last && c.daysSince(last.date) < 3 * 365) continue
        out.push(c.f({
          ruleKey: 'repairs.battery', category: 'repairs', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — akkumulyator ${last ? `${fmtDate(last.date)} dan beri` : '3 yildan ortiq'} almashtirilmagan. Qishga tayyormi?`,
          detail: `Akkumulyatorning o'rtacha xizmat muddati 3–4 yil.`,
          action: MAINT,
        }))
      }
      return out
    },
  },
  {
    key: 'repairs.clutch_repeat', no: 98, category: 'repairs', name: 'Mufta 6 oyda 2 marta',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const ms = approved(c, v.id).filter(m => m.date >= c.ago(180) && isClutch(maintText(m)))
        if (ms.length < 2) continue
        out.push(c.f({
          ruleKey: 'repairs.clutch_repeat', category: 'repairs', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — stseplenie yarim yilda ${ms.length} marta almashtirildi. Haydovchi uslubini tekshirdingizmi?`,
          detail: `Sanalar: ${ms.map(m => fmtDate(m.date)).join(', ')}. Odatda mufta 100 000+ km yuradi.`,
          action: MAINT, impactUzs: ms.reduce((s, m) => s + maintTotal(m), 0),
        }))
      }
      return out
    },
  },
]
