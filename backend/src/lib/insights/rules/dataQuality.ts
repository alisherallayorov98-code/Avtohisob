// K. Ma'lumot to'liqligi (120–126)
import type { Rule, Finding, VehicleSnap } from '../types'
import { fmtDate, fmtUzs, uzDay, maintTotal } from '../context'
import { normalizePlate, isSoldNote } from '../keywords'

const card = (v: VehicleSnap) => ({ label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` })

export const dataRules: Rule[] = [
  {
    key: 'data.bad_year', no: 120, category: 'data', name: "Yil yoki xarid sanasi noto'g'ri",
    run: (c) => {
      const yearNow = new Date(c.now.getTime() + 5 * 3600 * 1000).getUTCFullYear()
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const problems: string[] = []
        if (v.year < 1970 || v.year > yearNow + 1) problems.push(`ishlab chiqarilgan yil ${v.year}`)
        if (v.purchaseDate && v.purchaseDate > c.now) problems.push(`xarid sanasi kelajakda (${fmtDate(v.purchaseDate)})`)
        if (v.purchaseDate && v.year >= 1970 && new Date(v.purchaseDate.getTime() + 5 * 3600 * 1000).getUTCFullYear() < v.year - 1) {
          problems.push(`ishlab chiqarilishidan oldin sotib olingan (${fmtDate(v.purchaseDate)}, ${v.year}-yil)`)
        }
        if (!problems.length) continue
        out.push(c.f({
          ruleKey: 'data.bad_year', category: 'data', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — mashina ma'lumotlari to'g'rimi?`,
          detail: `${problems.join('; ')}. Amortizatsiya va yosh bo'yicha tahlil noto'g'ri chiqadi.`,
          action: card(v),
        }))
      }
      return out
    },
  },
  {
    key: 'data.duplicate_plate', no: 121, category: 'data', name: 'Takroriy davlat raqami',
    run: (c) => {
      const groups = new Map<string, VehicleSnap[]>()
      for (const v of c.vehicles) {
        const k = normalizePlate(v.plate)
        if (k) groups.set(k, [...(groups.get(k) || []), v])
      }
      return [...groups.values()].filter(g => g.length > 1).map(g => c.f({
        ruleKey: 'data.duplicate_plate', category: 'data', severity: 'warning', vehicleId: g[0].id, subjectKey: normalizePlate(g[0].plate),
        title: `"${g.map(v => v.plate).join('" va "')}" — bitta mashina ikki marta kiritilganmi?`,
        detail: `Yozuvlar ikkiga bo'linib ketadi: yoqilg'i biriga, ta'mir boshqasiga tushadi. Ortiqchasini arxivlang.`,
        action: { label: 'Mashinalar', path: '/vehicles' },
      }))
    },
  },
  {
    key: 'data.ghost_vehicle', no: 122, category: 'data', name: 'Mashina tizimda, lekin yozuvlar yo\'q',
    run: (c) => c.active
      .filter(v => c.daysSince(v.createdAt) >= 30)
      .filter(v => !(c.fuelByV.get(v.id) || []).length && !(c.maintByV.get(v.id) || []).length
        && !c.dailyKm.has(v.id) && !(c.expensesByV.get(v.id) || []).length && !(c.serviceByV.get(v.id) || []).length)
      .map(v => c.f({
        ruleKey: 'data.ghost_vehicle', category: 'data', severity: 'info', vehicleId: v.id,
        title: `${v.plate} — bu mashina ishlatiladimi?`,
        detail: `${fmtDate(v.createdAt)} dan beri birorta yoqilg'i, ta'mir, xarajat yoki GPS yozuvi yo'q. Ishlatilmasa — "Nofaol" qiling (tarif mashina soniga bog'liq).`,
        action: card(v),
        quick: { kind: 'vehicle_status', suggest: 'inactive' },
      })),
  },
  {
    key: 'data.placeholder_model', no: 123, category: 'data', name: "Marka/model bo'sh yoki test",
    run: (c) => c.vehicles
      .filter(v => {
        const t = `${v.brand} ${v.model}`.trim().toLowerCase()
        return !v.brand.trim() || !v.model.trim() || /(^|\s)(test|тест|xxx|asd|qwe)(\s|$)/.test(t) || /^[-.\s0]+$/.test(t)
      })
      .map(v => c.f({
        ruleKey: 'data.placeholder_model', category: 'data', severity: 'info', vehicleId: v.id,
        title: `${v.plate} — markasi va modeli qanday?`,
        detail: `Hozir: "${v.brand} ${v.model}". Model bo'yicha solishtirish (sarf, moy intervali) bu mashinani hisobga olmaydi.`,
        action: card(v),
      })),
  },
  {
    key: 'data.sold_but_active', no: 124, category: 'data', name: 'Izohda "sotilgan", holati faol',
    run: (c) => c.vehicles
      .filter(v => v.status !== 'inactive' && v.notes && isSoldNote(v.notes))
      .map(v => c.f({
        ruleKey: 'data.sold_but_active', category: 'data', severity: 'warning', vehicleId: v.id,
        title: `${v.plate} — sotilgan/hisobdan chiqarilgan bo'lsa, nega hali faol?`,
        detail: `Izoh: "${v.notes!.slice(0, 120)}". Faol mashinalar tarif va hisobotlarga kiradi.`,
        action: card(v),
        quick: { kind: 'vehicle_status', suggest: 'inactive' },
      })),
  },
  {
    key: 'data.duplicate_records', no: 125, category: 'data', name: 'Bir kunda bir xil ikki yozuv (dublikat)',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles) {
        const seenF = new Map<string, number>()
        for (const r of (c.fuelByV.get(v.id) || []).filter(r => r.date >= c.ago(90))) {
          const k = `${uzDay(r.date)}|${r.liters}|${r.cost}`
          seenF.set(k, (seenF.get(k) || 0) + 1)
        }
        for (const [k, n] of seenF) {
          if (n < 2) continue
          const [day, liters, cost] = k.split('|')
          out.push(c.f({
            ruleKey: 'data.duplicate_records', category: 'data', severity: 'warning', vehicleId: v.id, subjectKey: `fuel|${k}`,
            title: `${v.plate} — ${day.split('-').reverse().join('.')} da bir xil yoqilg'i yozuvi ${n} marta. Dublikatmi?`,
            detail: `${liters} L, ${fmtUzs(Number(cost))}. Ikki marta kiritilgan bo'lsa — sarf va xarajat ${n} barobar ko'rinadi.`,
            action: { label: "Yoqilg'i yozuvlari", path: '/fuel' }, impactUzs: Number(cost) * (n - 1),
          }))
        }
        const seenM = new Map<string, number>()
        for (const m of (c.maintByV.get(v.id) || []).filter(m => m.date >= c.ago(90) && maintTotal(m) > 0)) {
          const k = `${uzDay(m.date)}|${maintTotal(m)}|${m.parts.map(p => p.sparePartId).sort().join(',')}`
          seenM.set(k, (seenM.get(k) || 0) + 1)
        }
        for (const [k, n] of seenM) {
          if (n < 2) continue
          const [day, total] = k.split('|')
          out.push(c.f({
            ruleKey: 'data.duplicate_records', category: 'data', severity: 'warning', vehicleId: v.id, subjectKey: `maint|${k}`,
            title: `${v.plate} — ${day.split('-').reverse().join('.')} da bir xil ta'mir ${n} marta kiritilgan. Dublikatmi?`,
            detail: `Har biri ${fmtUzs(Number(total))}, qismlar bir xil.`,
            action: { label: "Ta'mirlar", path: '/maintenance' }, impactUzs: Number(total) * (n - 1),
          }))
        }
      }
      return out
    },
  },
  {
    key: 'data.branch_no_manager', no: 126, category: 'data', name: "Filialda mas'ul yo'q",
    run: (c) => {
      // Tashkilot filial mas'ulini umuman belgilamasa — jim
      if (!c.s.branches.some(b => b.managerId)) return []
      const withVehicles = new Set(c.active.map(v => v.branchId))
      return c.s.branches.filter(b => !b.managerId && withVehicles.has(b.id)).map(b => c.f({
        ruleKey: 'data.branch_no_manager', category: 'data', severity: 'info', subjectKey: b.id,
        title: `"${b.name}" filialiga mas'ul kim?`,
        detail: `Filialda faol mashinalar bor, lekin mas'ul shaxs belgilanmagan.`,
        action: { label: 'Filiallar', path: '/branches' },
      }))
    },
  },
]
