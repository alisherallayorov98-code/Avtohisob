// Javobni robot tekshiradi. Filialga yuborilgan savol yo'qolganda (ma'lumot kiritildi),
// so'rov darhol yopilmaydi: avval kiritilgan yozuvlar boshqa manbalar bilan solishtiriladi —
// GPS probegi, ombor chiqimi, hujjat (chek/rasm), sana, summa. Bittasidan o'tmasa ham
// so'rov "shubhali" bo'lib admin qaroriga tushadi. PURE: faqat Snapshot'dan o'qiydi.

import type { Snapshot, VehicleSnap } from './types'
import { DAY_MS, fmtDate, fmtNum, fmtUzs, uzDay } from './context'
import { BIG_MONEY_UZS } from './triage'

export interface VerifyCheck { ok: boolean; text: string }
export interface VerifyResult { ok: boolean; checks: VerifyCheck[] }
export interface VerifyInput { ruleKey: string; vehicleId: string | null; sentAt: Date }

/**
 * Bu savollar "ish bajarilganmi?" deb so'raydi — javob faqat YANGI yozuv bo'lishi mumkin.
 * Yangi yozuvsiz yo'qolsa (interval, norma, holat o'zgartirilgan) — shubhali.
 */
export const NEEDS_RECORD = new Set<string>([
  'service.oil_overdue_km', 'service.oil_overdue_days', 'service.oil_history_empty', 'service.oil_maint_not_recorded',
  'service.no_anchor', 'service.no_oil_interval',
  'engine.parts_without_passport', 'engine.high_mileage_no_passport', 'engine.fuel_system_without_passport',
  'engine.next_service_passed', 'engine.no_oil_after_overhaul', 'engine.gearbox_no_interval',
  'repairs.battery', 'repairs.driven_no_repairs', 'repairs.old_part_debt',
  'documents.critical_inspection_no_repair', 'documents.brakes_not_fixed', 'documents.monthly_inspection_missing',
])

/** Orqa sana bilan kiritish shundan ko'p bo'lsa — tekshiriladi */
const BACKDATE_DAYS = 7
/** Yozuv "yangi" deb hisoblanadi: savol yuborilgandan keyin kiritilgan bo'lsa */
const CLOCK_SKEW_MS = 5 * 60 * 1000

interface NewRecord {
  label: string
  date: Date
  createdAt: Date | null
  km: number | null
  cost: number
  /** undefined — bu turdagi yozuvda hujjat tushunchasi yo'q */
  hasDoc?: boolean
  isOil: boolean
  /** Shu yozuvning o'zi ombordan qism chiqargan (moy uchun) */
  fromWarehouse: boolean
}

function collectNewRecords(s: Snapshot, vid: string, since: number): NewRecord[] {
  const isNew = (createdAt: Date | null | undefined, date: Date) =>
    createdAt ? createdAt.getTime() >= since : date.getTime() >= since - DAY_MS
  const out: NewRecord[] = []
  for (const m of [...s.maintenance, ...s.pendingMaintenance]) {
    if (m.vehicleId !== vid || !isNew(m.createdAt, m.date)) continue
    out.push({
      label: `${fmtDate(m.date)} dagi ta'mir`, date: m.date, createdAt: m.createdAt, km: m.mileage,
      cost: m.cost + m.laborCost, hasDoc: m.evidenceCount > 0, isOil: m.isOil,
      fromWarehouse: m.parts.some(p => !!p.sparePartId),
    })
  }
  for (const r of s.serviceRecords) {
    if (r.vehicleId !== vid || !isNew(r.createdAt, r.date)) continue
    out.push({
      label: `${fmtDate(r.date)} dagi ${r.serviceType === 'oil_change' ? 'moy almashtirish' : 'xizmat'} yozuvi`,
      date: r.date, createdAt: r.createdAt ?? null, km: r.km || null, cost: r.cost,
      isOil: r.serviceType === 'oil_change', fromWarehouse: false,
    })
  }
  for (const e of s.engine) {
    if (e.vehicleId !== vid || !isNew(e.createdAt, e.date)) continue
    out.push({ label: `${fmtDate(e.date)} dagi dvigatel yozuvi`, date: e.date, createdAt: e.createdAt ?? null, km: e.mileage || null, cost: e.cost, isOil: false, fromWarehouse: false })
  }
  for (const f of s.fuel) {
    if (f.vehicleId !== vid || !isNew(f.createdAt, f.date)) continue
    out.push({ label: `${fmtDate(f.date)} dagi yoqilg'i quyish`, date: f.date, createdAt: f.createdAt ?? null, km: f.odometer || null, cost: f.cost, hasDoc: f.hasReceipt, isOil: false, fromWarehouse: false })
  }
  for (const i of s.inspections) {
    if (i.vehicleId !== vid || i.date.getTime() < since - DAY_MS) continue
    out.push({ label: `${fmtDate(i.date)} dagi texnik tekshiruv`, date: i.date, createdAt: null, km: null, cost: 0, isOil: false, fromWarehouse: false })
  }
  return out
}

/**
 * GPS bo'yicha o'sha kundagi taxminiy probeg: hozirgi probeg − keyingi kunlardagi GPS km yig'indisi.
 * GPS ishlamasa yoki kesh o'sha kunni qamramasa — null (tekshirib bo'lmaydi).
 */
export function gpsOdometerAt(s: Snapshot, v: VehicleSnap, date: Date): { km: number; driven: number } | null {
  if (!v.gpsUnitName || !v.lastGpsSignal) return null
  if (s.now.getTime() - v.lastGpsSignal.getTime() > 3 * DAY_MS) return null
  const day = uzDay(date)
  const rows = s.dailyKm.filter(x => x.vehicleId === v.id)
  if (!rows.length || !rows.some(x => x.day <= day)) return null
  const driven = rows.filter(x => x.day > day).reduce((sum, x) => sum + x.km, 0)
  return { km: v.mileage - driven, driven }
}

export function verifyResolution(input: VerifyInput, s: Snapshot): VerifyResult {
  const checks: VerifyCheck[] = []
  const v = input.vehicleId ? s.vehicles.find(x => x.id === input.vehicleId) : undefined
  const records = v ? collectNewRecords(s, v.id, input.sentAt.getTime() - CLOCK_SKEW_MS) : []

  if (!records.length) {
    if (NEEDS_RECORD.has(input.ruleKey)) {
      const why = v && v.status !== 'active'
        ? ` Mashina holati "${v.status}" ga o'zgartirilgan — shuning uchun savol yo'qolgan bo'lishi mumkin.`
        : ' Sozlama (interval, norma, probeg) o\'zgartirilgan bo\'lishi mumkin.'
      checks.push({ ok: false, text: `Savol yo'qoldi, lekin shu mashinaga yangi yozuv kiritilmagan.${why}` })
    } else {
      checks.push({ ok: true, text: "Mavjud ma'lumot tuzatildi (bu turdagi savol uchun yangi yozuv shart emas)." })
    }
    return { ok: checks.every(c => c.ok), checks }
  }

  const orgUsesWarehouseOil = s.maintenance.some(m =>
    m.isOil && m.parts.some(p => !!p.sparePartId) && s.now.getTime() - m.date.getTime() <= 180 * DAY_MS)

  for (const r of records) {
    // 1. Probeg: hozirgidan katta bo'lmasin, GPS bo'yicha o'sha kunga mos kelsin
    let gpsConfirmed = false
    if (v && r.km && r.km > 0) {
      if (r.km > v.mileage + 1000) {
        checks.push({ ok: false, text: `${r.label}: probeg ${fmtNum(r.km)} km — mashinaning hozirgi probegidan (${fmtNum(v.mileage)} km) katta.` })
      } else {
        const g = gpsOdometerAt(s, v, r.date)
        if (g) {
          const tol = Math.max(1500, g.driven * 0.15)
          if (Math.abs(r.km - g.km) > tol) {
            checks.push({ ok: false, text: `${r.label}: yozuvda ${fmtNum(r.km)} km, GPS bo'yicha o'sha kuni taxminan ${fmtNum(Math.max(0, g.km))} km bo'lgan.` })
          } else {
            gpsConfirmed = true
            checks.push({ ok: true, text: `${r.label}: probeg GPS bilan mos (${fmtNum(r.km)} km).` })
          }
        }
      }
    }

    // 2. Orqa sana: GPS tasdiqlamasa — shubhali (eng ko'p uchraydigan "yopib qo'yish" usuli)
    if (r.createdAt) {
      const lag = Math.floor((r.createdAt.getTime() - r.date.getTime()) / DAY_MS)
      if (lag > BACKDATE_DAYS) {
        checks.push(gpsConfirmed
          ? { ok: true, text: `${r.label}: ${fmtDate(r.createdAt)} da ${lag} kun orqa sana bilan kiritilgan, lekin GPS probegi tasdiqlaydi.` }
          : { ok: false, text: `${r.label}: ${fmtDate(r.createdAt)} da kiritilgan, sanasi esa ${lag} kun oldinga qo'yilgan. GPS bilan tasdiqlab bo'lmadi.` })
      }
    }

    // 3. Moy ombordan chiqarilganmi (faqat tashkilot odatda moyni ombordan chiqarsa)
    if (r.isOil && orgUsesWarehouseOil && v) {
      const issued = r.fromWarehouse || [...s.maintenance, ...s.pendingMaintenance].some(m =>
        m.vehicleId === v.id && m.isOil && m.parts.some(p => !!p.sparePartId)
        && Math.abs(m.date.getTime() - r.date.getTime()) <= 7 * DAY_MS)
      checks.push(issued
        ? { ok: true, text: `${r.label}: moy ombordan chiqarilgan.` }
        : { ok: false, text: `${r.label}: moy ombordan chiqarilmagan (boshqa mashinalarda odatda ombordan chiqariladi).` })
    }

    // 4. Katta summa — har doim admin ko'zidan o'tadi
    if (r.cost >= BIG_MONEY_UZS) {
      const doc = r.hasDoc === false ? ', chek/rasm biriktirilmagan' : ''
      checks.push({ ok: false, text: `${r.label}: summa ${fmtUzs(r.cost)}${doc} — katta xarajatni admin ko'rishi shart.` })
    }
  }

  if (!checks.length) checks.push({ ok: true, text: `Yangi yozuv kiritildi: ${records.map(r => r.label).join(', ')}.` })
  return { ok: checks.every(c => c.ok), checks }
}

export function verifyMessage(r: VerifyResult): string {
  const head = r.ok ? '🤖 Robot tekshirdi — tasdiqlandi:' : "🤖 Robot tasdiqlamadi — admin ko'rib chiqadi:"
  return [head, ...r.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.text}`)].join('\n')
}
