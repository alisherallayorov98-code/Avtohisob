// D. GPS va harakat (47–58)
import type { Rule, Finding } from '../types'
import { DAY_MS, fmtDate, fmtNum, median, uzDay } from '../context'

const GPS = { label: 'GPS bo\'limi', path: '/gps' }
const card = (id: string) => ({ label: 'Mashina kartochkasi', path: `/vehicles/${id}` })

export const gpsRules: Rule[] = [
  {
    key: 'gps.not_linked', no: 47, category: 'gps', name: "Mashina GPS'ga bog'lanmagan",
    run: (c) => {
      if (!c.s.org.gpsConnected) return []
      return c.active.filter(v => !c.isGpsLinked(v)).map(v => c.f({
        ruleKey: 'gps.not_linked', category: 'gps', severity: 'warning', vehicleId: v.id,
        title: `${v.plate} — GPS trekeri bormi? Tizimga bog'lanmagan`,
        detail: `GPS ulangan, lekin bu mashina hech bir trekerga bog'lanmagan — km, sarf va moy nazorati qo'lda qoladi.`,
        action: GPS,
      }))
    },
  },
  {
    key: 'gps.no_signal', no: 48, category: 'gps', name: "GPS signal 3+ kun yo'q",
    run: (c) => {
      if (!c.s.org.gpsConnected) return []
      const out: Finding[] = []
      for (const v of c.active) {
        if (!v.lastGpsSignal) continue
        const days = c.daysSince(v.lastGpsSignal)
        if (days < 3) continue
        out.push(c.f({
          ruleKey: 'gps.no_signal', category: 'gps', severity: days >= 7 ? 'critical' : 'warning', vehicleId: v.id,
          title: `${v.plate} — ${days} kundan beri GPS signal yo'q. Treker o'chirilganmi?`,
          detail: `Oxirgi signal: ${fmtDate(v.lastGpsSignal)}. Mashina ta'mirda bo'lsa holatini "Ta'mirda" qiling; ishlayotgan bo'lsa — treker uzilgan yoki ataylab o'chirilgan.`,
          action: GPS,
        }))
      }
      return out
    },
  },
  {
    key: 'gps.connection_error', no: 49, category: 'gps', name: 'GPS ulanish xatosi yoki token tugayapti',
    run: (c) => {
      const o = c.s.org
      if (!o.gpsConnected) return []
      const out: Finding[] = []
      if (o.gpsSyncError) out.push(c.f({
        ruleKey: 'gps.connection_error', category: 'gps', severity: 'critical', subjectKey: 'error',
        title: 'GPS server bilan ulanish xato beryapti',
        detail: `Oxirgi xato: ${o.gpsSyncError.slice(0, 160)}. Probeg va km yangilanmayapti.`,
        action: GPS,
      }))
      if (o.gpsTokenExpiresAt && o.gpsTokenExpiresAt.getTime() - c.now.getTime() < 7 * DAY_MS) out.push(c.f({
        ruleKey: 'gps.connection_error', category: 'gps', severity: 'warning', subjectKey: 'token',
        title: `GPS token ${fmtDate(o.gpsTokenExpiresAt)} da tugaydi`,
        detail: `Token muddati tugasa barcha GPS ma'lumotlari to'xtaydi. Parol saqlangan bo'lmasa — qayta ulang.`,
        action: GPS,
      }))
      return out
    },
  },
  {
    key: 'gps.cache_gap', no: 50, category: 'gps', name: "Kunlik km keshi to'lmayapti",
    run: (c) => {
      if (!c.s.org.gpsConnected || c.gpsCacheAlive) return []
      return [c.f({
        ruleKey: 'gps.cache_gap', category: 'gps', severity: 'warning',
        title: "GPS kunlik km'lari nega yangilanmayapti?",
        detail: c.gpsCacheTo
          ? `Kunlik km keshidagi oxirgi kun: ${c.gpsCacheTo.split('-').reverse().join('.')}. Sarf tahlili va GPS qoidalari eskirgan ma'lumotda ishlaydi.`
          : `Kunlik km keshi bo'sh — GPS bo'limida tarixni (backfill) ishga tushiring.`,
        action: GPS,
      })]
    },
  },
  {
    key: 'gps.idle_14d', no: 51, category: 'gps', name: '14 kun 0 km (ishlamayapti)',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        if (!v.lastGpsSignal || c.daysSince(v.lastGpsSignal) >= 3) continue
        const km = c.kmBetween(v.id, c.ago(14), c.now)
        if (km == null || km > 5) continue
        out.push(c.f({
          ruleKey: 'gps.idle_14d', category: 'gps', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — 14 kundan beri joyidan qo'zg'almagan. Nega ishlamayapti?`,
          detail: `GPS signal bor, lekin harakat yo'q. Buzuq bo'lsa holatini "Ta'mirda", keraksiz bo'lsa "Nofaol" qiling — xarajat va KPI hisobi to'g'rilanadi.`,
          action: card(v.id),
        }))
      }
      return out
    },
  },
  {
    key: 'gps.moving_in_maintenance', no: 52, category: 'gps', name: "Holati \"ta'mirda\", lekin yurmoqda",
    run: (c) => c.vehicles
      .filter(v => v.status === 'maintenance')
      .map(v => ({ v, km: c.kmBetween(v.id, c.ago(7), c.now) }))
      .filter(x => x.km != null && x.km > 50)
      .map(({ v, km }) => c.f({
        ruleKey: 'gps.moving_in_maintenance', category: 'gps', severity: 'warning', vehicleId: v.id,
        title: `${v.plate} — "ta'mirda" deb turibdi, lekin 7 kunda ${fmtNum(km!)} km yurgan. Holat yangilanmaganmi?`,
        detail: `Ta'mirdan chiqqan bo'lsa holatini "Faol" qiling.`,
        action: card(v.id),
      })),
  },
  {
    key: 'gps.moving_inactive', no: 53, category: 'gps', name: 'Holati "nofaol", lekin yurmoqda',
    run: (c) => c.vehicles
      .filter(v => v.status === 'inactive')
      .map(v => ({ v, km: c.kmBetween(v.id, c.ago(7), c.now) }))
      .filter(x => x.km != null && x.km > 50)
      .map(({ v, km }) => c.f({
        ruleKey: 'gps.moving_inactive', category: 'gps', severity: 'critical', vehicleId: v.id,
        title: `${v.plate} — "nofaol" mashina 7 kunda ${fmtNum(km!)} km yurgan. Kim haydayapti?`,
        detail: `Hisobdan chiqarilgan yoki to'xtatilgan mashina ishlatilmoqda — ruxsatsiz foydalanish bo'lishi mumkin.`,
        action: GPS,
      })),
  },
  {
    key: 'gps.km_spike', no: 54, category: 'gps', name: "Bir kunda g'ayrioddiy ko'p km",
    run: (c) => {
      if (!c.gpsCacheAlive) return []
      const out: Finding[] = []
      const since = uzDay(c.ago(14))
      for (const v of c.active) {
        const m = c.dailyKm.get(v.id)
        if (!m || m.size < 10) continue
        const med = median([...m.values()])
        const limit = Math.max(500, med * 3)
        for (const [day, km] of m) {
          if (day < since || km <= limit) continue
          out.push(c.f({
            ruleKey: 'gps.km_spike', category: 'gps', severity: 'info', vehicleId: v.id, subjectKey: day,
            title: `${v.plate} — ${day.split('-').reverse().join('.')} da ${fmtNum(km)} km yurgan. Qayerga borgan?`,
            detail: `Odatiy kunlik masofa ~${fmtNum(med)} km. Rejadagi reys bo'lmasa — yo'l varaqasi va marshrutni tekshiring.`,
            action: GPS,
          }))
        }
      }
      return out
    },
  },
  {
    key: 'gps.mileage_stale', no: 55, category: 'gps', name: "Probeg 30 kun yangilanmagan (GPS'siz)",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        if (c.isGpsLinked(v)) continue
        const dates = [
          ...(c.fuelByV.get(v.id) || []).filter(r => r.odometer > 0).map(r => r.date),
          ...(c.maintByV.get(v.id) || []).filter(m => m.mileage).map(m => m.date),
        ]
        const last = dates.sort((a, b) => b.getTime() - a.getTime())[0]
        if (last && c.daysSince(last) < 30) continue
        if (!last && c.daysSince(v.createdAt) < 30) continue
        out.push(c.f({
          ruleKey: 'gps.mileage_stale', category: 'gps', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — hozirgi probeg qancha?`,
          detail: `${last ? `Oxirgi marta ${fmtDate(last)} da` : 'Hech qachon'} probeg kiritilgan. GPS yo'q — moy va xizmat muddatlari eskirgan probegda hisoblanmoqda.`,
          action: card(v.id),
        }))
      }
      return out
    },
  },
  {
    key: 'gps.sunday_use', no: 56, category: 'gps', name: 'Yakshanba kunlari muntazam yuradi',
    run: (c) => {
      if (!c.gpsCacheAlive) return []
      // Oxirgi 8 ta yakshanba
      const sundays: string[] = []
      for (let i = 1; i <= 60 && sundays.length < 8; i++) {
        const d = new Date(c.now.getTime() - i * DAY_MS + 5 * 3600 * 1000)
        if (d.getUTCDay() === 0) sundays.push(d.toISOString().slice(0, 10))
      }
      if (!c.gpsCacheFrom || sundays[sundays.length - 1] < c.gpsCacheFrom) return []
      const hits = new Map<string, number>()
      for (const v of c.active) {
        const m = c.dailyKm.get(v.id)
        if (!m) continue
        const n = sundays.filter(d => (m.get(d) || 0) > 30).length
        if (n > 0) hits.set(v.id, n)
      }
      const linked = c.active.filter(v => c.isGpsLinked(v)).length
      const regular = [...hits.entries()].filter(([, n]) => n >= 5)
      // Yakshanba ish kuni bo'lgan tashkilot (masalan chiqindi tashish) — jim
      if (!linked || regular.length > linked * 0.5) return []
      return regular.map(([vid, n]) => c.f({
        ruleKey: 'gps.sunday_use', category: 'gps', severity: 'info', vehicleId: vid,
        title: `${c.plate(vid)} — oxirgi 8 yakshanbaning ${n} tasida ishlagan. Shaxsiy maqsadda ishlatilmayaptimi?`,
        detail: `Boshqa mashinalar yakshanba odatda turadi. Navbatchilik rejasi bo'lmasa — haydovchidan so'rang.`,
        action: GPS,
      }))
    },
  },
  {
    key: 'gps.km_drop', no: 57, category: 'gps', name: "Oylik km 40%+ kamaygan",
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.active) {
        const cur = c.kmBetween(v.id, c.ago(30), c.now)
        const prev = c.kmBetween(v.id, c.ago(60), c.ago(30))
        if (cur == null || prev == null || prev < 1000 || cur > prev * 0.6) continue
        out.push(c.f({
          ruleKey: 'gps.km_drop', category: 'gps', severity: 'info', vehicleId: v.id,
          title: `${v.plate} — bu oy ${Math.round((1 - cur / prev) * 100)}% kam yurdi. Nima bo'ldi?`,
          detail: `Oxirgi 30 kun: ${fmtNum(cur)} km, oldingi 30 kun: ${fmtNum(prev)} km. Nosozlik, haydovchi yo'qligi yoki ish kamayganmi?`,
          action: GPS,
        }))
      }
      return out
    },
  },
  {
    key: 'gps.underused', no: 58, category: 'gps', name: "Eng kam ishlatiladigan mashinalar",
    run: (c) => {
      const rows = c.active
        .map(v => ({ v, km: c.kmBetween(v.id, c.ago(30), c.now) }))
        .filter((x): x is { v: typeof x.v; km: number } => x.km != null)
      if (rows.length < 10) return []
      const med = median(rows.map(r => r.km))
      if (med < 500) return []
      const sorted = [...rows].sort((a, b) => a.km - b.km)
      const bottom = sorted.slice(0, Math.max(1, Math.floor(rows.length * 0.1)))
      return bottom
        .filter(r => r.km < med * 0.3)
        .map(r => c.f({
          ruleKey: 'gps.underused', category: 'gps', severity: 'info', vehicleId: r.v.id,
          title: `${r.v.plate} — bu mashina kerakmi? Avtoparkda eng kam ishlatilganlardan`,
          detail: `30 kunda ${fmtNum(r.km)} km (avtopark medianasi ${fmtNum(med)} km). Qayta taqsimlash yoki sotish xarajatni kamaytiradi.`,
          action: card(r.v.id),
        }))
    },
  },
]
