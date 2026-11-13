// F. Shinalar (70–78)
import type { Rule, Finding, TireSnap } from '../types'
import { fmtDate, fmtNum, fmtUzs, type Ctx } from '../context'

const TIRES = { label: 'Shinalar', path: '/tires' }
const usesTires = (c: Ctx) => c.s.tires.length > 0 || c.s.tireTrackingVehicleIds.length > 0
const installed = (c: Ctx) => c.s.tires.filter(t => t.status === 'installed' && t.vehicleId && c.vehicle.has(t.vehicleId))

export const tireRules: Rule[] = [
  {
    key: 'tires.none', no: 70, category: 'tires', name: "Mashinaga shina biriktirilmagan",
    collapse: { title: (n) => `${n} ta mashinada shina hisobi yuritilmayapti`, action: TIRES },
    run: (c) => {
      if (!usesTires(c)) return []
      const tracked = new Set(c.s.tireTrackingVehicleIds)
      return c.active
        .filter(v => !tracked.has(v.id) && !(c.tiresByV.get(v.id) || []).some(t => t.status === 'installed'))
        .map(v => c.f({
          ruleKey: 'tires.none', category: 'tires', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — qaysi shinalarda yuribdi?`,
          detail: `Shina biriktirilmagan — yeyilish normasi va haydovchidan ushlab qolish nazorati ishlamaydi.`,
          action: TIRES,
        }))
    },
  },
  {
    key: 'tires.over_norm', no: 71, category: 'tires', name: 'Shina normasi oshgan',
    run: (c) => {
      const out: Finding[] = []
      for (const t of installed(c)) {
        const v = c.vehicle.get(t.vehicleId!)!
        if (t.installedMileageKm == null) continue
        const used = v.mileage - t.installedMileageKm
        if (used <= 0 || used > 500_000 || used <= t.standardMileageKm) continue
        out.push(c.f({
          ruleKey: 'tires.over_norm', category: 'tires', severity: used > t.standardMileageKm * 1.2 ? 'warning' : 'info', vehicleId: v.id, subjectKey: t.id,
          title: `${v.plate} — ${t.position || ''} shina (${t.serial}) normadan ${fmtNum(used - t.standardMileageKm)} km oshdi. Holati tekshirildimi?`,
          detail: `O'rnatilgandan beri ${fmtNum(used)} km, norma ${fmtNum(t.standardMileageKm)} km. Protektorni o'lchang.`,
          action: TIRES,
        }))
      }
      return out
    },
  },
  {
    key: 'tires.no_install_km', no: 72, category: 'tires', name: "O'rnatish probegi kiritilmagan",
    collapse: { title: (n) => `${n} ta shinada o'rnatish probegi yo'q`, action: TIRES },
    run: (c) => installed(c).filter(t => t.installedMileageKm == null).map(t => c.f({
      ruleKey: 'tires.no_install_km', category: 'tires', severity: 'info', vehicleId: t.vehicleId, subjectKey: t.id,
      title: `${c.plate(t.vehicleId!)} — ${t.serial} shina qaysi probegda o'rnatilgan?`,
      detail: `Probeg kiritilmagan — shina qancha yurganini hisoblab bo'lmaydi.`,
      action: TIRES,
    })),
  },
  {
    key: 'tires.early_removal', no: 73, category: 'tires', name: 'Erta yechilgan, ushlab qolish yozilmagan',
    run: (c) => {
      const deducted = new Set(c.s.tireDeductions.map(d => d.tireId))
      return c.s.tires
        .filter(t => ['returned', 'written_off', 'damaged'].includes(t.status) && t.removedDate && t.removedDate >= c.ago(180))
        .filter(t => t.actualMileageUsed != null && t.actualMileageUsed < t.standardMileageKm * 0.5 && !deducted.has(t.id))
        .map(t => {
          const remaining = t.standardMileageKm - (t.actualMileageUsed || 0)
          const loss = t.standardMileageKm > 0 ? (t.purchasePrice / t.standardMileageKm) * remaining : 0
          return c.f({
            ruleKey: 'tires.early_removal', category: 'tires', severity: 'warning', vehicleId: t.vehicleId, subjectKey: t.id,
            title: `${t.serial} shina ${fmtNum(t.actualMileageUsed || 0)} km'da yechildi (norma ${fmtNum(t.standardMileageKm)}). Aybdor kim?`,
            detail: `Yechilgan: ${fmtDate(t.removedDate)}. Ushlab qolish hisoblanmagan — yo'qotish ~${fmtUzs(loss)}.`,
            action: TIRES, impactUzs: loss,
          })
        })
    },
  },
  {
    key: 'tires.deduction_unsettled', no: 74, category: 'tires', name: 'Ushlab qolish undirilmagan',
    run: (c) => c.s.tireDeductions
      .filter(d => !d.isSettled && c.daysSince(d.createdAt) >= 30)
      .map(d => c.f({
        ruleKey: 'tires.deduction_unsettled', category: 'tires', severity: 'warning', vehicleId: d.vehicleId && c.vehicle.has(d.vehicleId) ? d.vehicleId : null, subjectKey: d.id,
        title: `Shina uchun ${fmtUzs(d.amount)} ushlab qolish ${c.daysSince(d.createdAt)} kundan beri undirilmagan`,
        detail: `Hisoblangan: ${fmtDate(d.createdAt)}. Undirilgan bo'lsa — "undirildi" deb belgilang.`,
        action: TIRES, impactUzs: d.amount,
      })),
  },
  {
    key: 'tires.stale_stock', no: 75, category: 'tires', name: 'Omborda 180+ kun yotgan shina',
    run: (c) => {
      const stale = c.s.tires.filter(t => t.status === 'in_stock' && c.daysSince(t.purchaseDate) >= 180)
      if (!stale.length) return []
      const value = stale.reduce((s, t) => s + t.purchasePrice, 0)
      return [c.f({
        ruleKey: 'tires.stale_stock', category: 'tires', severity: 'info',
        title: `Omborda ${stale.length} ta shina yarim yildan beri yotibdi. Nega o'rnatilmayapti?`,
        detail: `Muzlagan pul: ${fmtUzs(value)}. Shina eskiradi (rezina 5 yilda qotadi) — avval shularni ishlating.`,
        action: TIRES, impactUzs: value,
      })]
    },
  },
  {
    key: 'tires.old_dot', no: 76, category: 'tires', name: '5 yildan eski shina',
    run: (c) => {
      const out: Finding[] = []
      const year = new Date(c.now.getTime() + 5 * 3600 * 1000).getUTCFullYear()
      for (const t of installed(c)) {
        const m = (t.dotCode || '').match(/(\d{2})(\d{2})$/)
        if (!m) continue
        const y = 2000 + Number(m[2])
        if (y > year || year - y < 5) continue
        out.push(c.f({
          ruleKey: 'tires.old_dot', category: 'tires', severity: 'warning', vehicleId: t.vehicleId, subjectKey: t.id,
          title: `${c.plate(t.vehicleId!)} — ${t.serial} shina ${y}-yilda ishlab chiqarilgan. Xavfsizmi?`,
          detail: `${year - y} yoshda (DOT ${t.dotCode}). Eski rezina yorilib ketishi mumkin.`,
          action: TIRES,
        }))
      }
      return out
    },
  },
  {
    key: 'tires.position_conflict', no: 77, category: 'tires', name: 'Bitta pozitsiyada 2 ta shina',
    run: (c) => {
      const out: Finding[] = []
      const byKey = new Map<string, TireSnap[]>()
      for (const t of installed(c)) {
        if (!t.position) continue
        const k = `${t.vehicleId}|${t.position}`
        byKey.set(k, [...(byKey.get(k) || []), t])
      }
      for (const [k, ts] of byKey) {
        if (ts.length < 2) continue
        const vid = k.split('|')[0]
        out.push(c.f({
          ruleKey: 'tires.position_conflict', category: 'tires', severity: 'warning', vehicleId: vid, subjectKey: ts[0].position!,
          title: `${c.plate(vid)} — "${ts[0].position}" joyida ${ts.length} ta shina turibdi. Qaysi biri yechilgan?`,
          detail: `Seriyalar: ${ts.map(t => t.serial).join(', ')}. Eskisi yechilgan deb belgilanmagan.`,
          action: TIRES,
        }))
      }
      return out
    },
  },
  {
    key: 'tires.zero_price', no: 78, category: 'tires', name: 'Shina narxi 0',
    run: (c) => {
      const zero = c.s.tires.filter(t => t.purchasePrice <= 0 && t.status !== 'written_off')
      if (!zero.length) return []
      return [c.f({
        ruleKey: 'tires.zero_price', category: 'tires', severity: 'info',
        title: `${zero.length} ta shina narxsiz kiritilgan`,
        detail: `Narxsiz shinada erta yechilganda haydovchidan ushlab qolish 0 chiqadi.`,
        action: TIRES,
      })]
    },
  },
]
