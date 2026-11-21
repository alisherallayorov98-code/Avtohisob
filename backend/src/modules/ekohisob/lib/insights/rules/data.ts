// C. Avtomatlashtirishni jimgina buzayotgan ma'lumot (40–59) va D. tizim jarayonlari (60–69).
import type { Rule, Finding } from '../types'
import { table, fmtDate, fmtDateTime, fmtMonth, fmtUzs } from '../ctx'
import { hasUsablePhone } from '../../dataHealth'
import { findDuplicateGroups } from '../../duplicateDetect'

export const DRAFT_STALE_DAYS = 7
export const SMS_FAIL_STREAK = 2

const ENT = { label: 'Tashkilotlar', path: '/ekohisob/entities' }
const SETTINGS = { label: 'Sozlamalar', path: '/ekohisob/settings' }

export const dataRules: Rule[] = [
  {
    key: 'data.debtor_no_phone', no: 40, category: 'data', name: "Qarzdorning telefoni yo'q",
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta qarzdorning telefoni yo'q yoki noto'g'ri — SMS eslatma ularga bormaydi`, action: ENT },
    run: (c) => c.active
      .filter(e => e.debt > 0 && e.debtMonths >= 1 && !hasUsablePhone(e.phone))
      .map(e => c.f({
        ruleKey: 'data.debtor_no_phone', category: 'data', severity: e.debtMonths >= 3 ? 'warning' : 'info',
        entityId: e.id, subjectKey: 'org',
        title: `${e.name} — ${fmtUzs(e.debt)} qarz, telefon raqami ${e.phone ? "noto'g'ri" : "yo'q"}. Raqamni bilasizmi?`,
        detail: 'SMS eslatma va eskalatsiya bu tashkilotga hech qachon bormaydi.',
        impactUzs: e.debt,
        evidence: table(['Telefon', 'Qarz', 'Oylar'], [[e.phone || "yo'q", fmtUzs(e.debt), e.debtMonths]]),
      })),
  },
  {
    key: 'data.sms_failing', no: 41, category: 'data', name: 'SMS ketma-ket yetib bormayapti',
    confidence: 'fact', tier: 'auto',
    run: (c) => {
      const out: Finding[] = []
      for (const [entityId, list] of c.smsBy) {
        const e = c.entity.get(entityId)
        if (!e || e.status !== 'active') continue
        const sorted = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        let streak = 0
        for (const s of sorted) { if (s.status === 'failed') streak++; else break }
        if (streak < SMS_FAIL_STREAK) continue
        out.push(c.f({
          ruleKey: 'data.sms_failing', category: 'data', severity: 'warning',
          entityId, subjectKey: 'org',
          title: `${e.name} — oxirgi ${streak} ta SMS yetib bormadi. Telefon raqami to'g'rimi?`,
          detail: `Raqam: ${e.phone || '—'}. Oxirgi xato: ${sorted[0].error || "noma'lum"}.`,
          evidence: table(['Vaqt', 'Holat', 'Xato'], sorted.slice(0, 5).map(s => [fmtDateTime(s.createdAt), s.status === 'failed' ? 'xato' : 'yuborildi', s.error || '—'])),
        }))
      }
      return out
    },
  },
  {
    key: 'data.fixed_no_fee', no: 42, category: 'data', name: 'Belgilangan oylik, summa 0',
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta tashkilot "belgilangan oylik" rejimida, lekin summasi 0 — ularga hisob yozilmaydi`, action: ENT, severity: 'critical' },
    run: (c) => c.active
      .filter(e => e.billingMode === 'monthly_fixed' && e.monthlyFee <= 0)
      .map(e => c.f({
        ruleKey: 'data.fixed_no_fee', category: 'data', severity: 'warning',
        entityId: e.id, subjectKey: 'org',
        title: `${e.name} — oylik summasi qancha?`,
        detail: "Belgilangan oylik rejimida, lekin summa 0: bu tashkilotga hech qachon hisob yozilmaydi va u qarzdorlar ro'yxatiga tushmaydi.",
        evidence: table(['Rejim', 'Oylik summa'], [['Belgilangan oylik', 0]]),
      })),
  },
  {
    key: 'data.talon_no_price', no: 43, category: 'data', name: 'Talon rejimi, kub narxi 0',
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta talon rejimidagi tashkilotda kub narxi belgilanmagan`, action: ENT },
    run: (c) => c.active
      .filter(e => e.billingMode === 'talon' && e.cubicPrice <= 0)
      .map(e => c.f({
        ruleKey: 'data.talon_no_price', category: 'data', severity: 'warning',
        entityId: e.id, subjectKey: 'org',
        title: `${e.name} — bir kub narxi qancha?`,
        detail: "Talon rejimida, lekin kub narxi 0 — talon qo'shib bo'lmaydi, xizmat pulsiz qoladi.",
        evidence: table(['Rejim', 'Kub narxi'], [['Talon', 0]]),
      })),
  },
  {
    key: 'data.draft_stale', no: 44, category: 'data', name: 'Chala tashkilot uzoq turibdi',
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta chala (to'ldirilmagan) tashkilot ${DRAFT_STALE_DAYS} kundan beri shunday turibdi`, action: ENT },
    run: (c) => c.s.entities
      .filter(e => e.status === 'draft' && e.createdAt <= c.ago(DRAFT_STALE_DAYS))
      .map(e => c.f({
        ruleKey: 'data.draft_stale', category: 'data', severity: 'info',
        entityId: e.id, subjectKey: 'org',
        title: `${e.name} ${c.daysSince(e.createdAt)} kundan beri chala — to'ldiriladimi yoki o'chiriladimi?`,
        detail: 'Chala tashkilotga hisob yozilmaydi va u hisobotlarga kirmaydi.',
        evidence: table(['Kiritilgan', 'Telefon', 'STIR', 'Koordinata'], [[fmtDate(e.createdAt), e.phone || "yo'q", e.stir || "yo'q", e.lat != null && e.lon != null ? 'bor' : "yo'q"]]),
      })),
  },
  {
    key: 'data.duplicate_stir', no: 45, category: 'data', name: 'Bir STIR bilan bir nechta tashkilot',
    confidence: 'fact', tier: 'admin',
    run: (c) => {
      const pool = c.s.entities.filter(e => e.status !== 'inactive')
      return findDuplicateGroups(pool.map(e => ({ id: e.id, name: e.name, stir: e.stir, districtId: e.districtId })))
        .filter(g => g.reason === 'stir')
        .map(g => {
          const es = g.ids.map(id => c.entity.get(id)!).filter(Boolean)
          const totalDebt = es.reduce((s, e) => s + e.debt, 0)
          return c.f({
            ruleKey: 'data.duplicate_stir', category: 'data', severity: 'warning',
            entityId: es[0]?.id ?? null, subjectKey: `stir:${g.key}`,
            title: `STIR ${g.key} bilan ${es.length} ta tashkilot bor — bitta korxona ikki marta kiritilganmi?`,
            detail: "Takror tashkilotga ikki marta hisob yoziladi yoki to'lov noto'g'ri kartochkaga tushadi.",
            impactUzs: totalDebt || undefined,
            evidence: table(['Nomi', 'Tuman', 'Holat', 'Qarz'], es.map(e => [e.name, e.districtName, e.status, fmtUzs(e.debt)]), undefined, es.map(e => e.id)),
          })
        })
    },
  },
  {
    key: 'data.debtor_no_coords', no: 46, category: 'data', name: "Qarzdorning manzili xaritada yo'q",
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta qarzdor xaritada yo'q (koordinata kiritilmagan) — marshrutga tushmaydi`, action: { label: 'Xarita', path: '/ekohisob/map' } },
    run: (c) => c.active
      .filter(e => e.debt > 0 && e.debtMonths >= 2 && (e.lat == null || e.lon == null))
      .map(e => c.f({
        ruleKey: 'data.debtor_no_coords', category: 'data', severity: 'info',
        entityId: e.id, subjectKey: 'org',
        title: `${e.name} — ${e.debtMonths} oylik qarzdor, xaritada joylashuvi yo'q`,
        detail: "Inspektor marshrutiga tushmaydi. Keyingi tashrifda botdan joylashuvni saqlang.",
        impactUzs: e.debt,
        evidence: table(['Qarz', 'Oylar', 'Koordinata'], [[fmtUzs(e.debt), e.debtMonths, "yo'q"]]),
      })),
  },
]

export const systemRules: Rule[] = [
  {
    key: 'system.charges_missing', no: 60, category: 'system', name: 'Joriy oy hisoblari yaratilmagan',
    confidence: 'fact', tier: 'admin',
    run: (c) => {
      if (!c.s.fullScope || c.day < 3 || c.s.missingCharges.length === 0) return []
      const es = c.s.missingCharges.map(id => c.entity.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof c.entity.get>>[]
      if (es.length === 0) return []
      const sum = es.reduce((s, e) => s + e.monthlyFee, 0)
      return [{
        ruleKey: 'system.charges_missing', category: 'system', severity: 'critical',
        entityId: null, subjectKey: c.month,
        title: `${fmtMonth(c.month)} uchun ${es.length} ta tashkilotga oylik hisob yozilmagan — ${fmtUzs(sum)} qarzga tushmagan`,
        detail: "Avtomatik hisob yaratish (har kuni 07:00) bu tashkilotlarni o'tkazib yuborgan. Hisobotda yig'im foizi noto'g'ri chiqadi.",
        action: ENT,
        impactUzs: sum,
        evidence: table(['Tashkilot', 'Tuman', 'Oylik summa'], es.slice(0, 100).map(e => [e.name, e.districtName, fmtUzs(e.monthlyFee)]),
          es.length > 100 ? `Birinchi 100 tasi, jami ${es.length} ta.` : undefined, es.slice(0, 100).map(e => e.id)),
      }]
    },
  },
  {
    key: 'system.auto_sms_not_run', no: 61, category: 'system', name: 'Avto-SMS bu oy ishlamagan',
    confidence: 'fact', tier: 'admin',
    run: (c) => {
      const o = c.s.org
      if (!c.s.fullScope || !o.smsAutoEnabled || c.day <= o.smsAutoDay + 1 || o.smsAutoLastMonth === c.month) return []
      return [{
        ruleKey: 'system.auto_sms_not_run', category: 'system', severity: 'warning',
        entityId: null, subjectKey: c.month,
        title: `Avtomatik SMS eslatma ${o.smsAutoDay}-sanada ishlashi kerak edi — ${fmtMonth(c.month)} da hali to'liq ishlamagan`,
        detail: 'Sabab: SMS limiti tugagan, Eskiz sozlanmagan yoki server xatosi. Sozlamalar va SMS jurnalini tekshiring.',
        action: SETTINGS,
        evidence: table(['Maydon', 'Qiymat'], [['Belgilangan kun', o.smsAutoDay], ['Bugun', c.day], ['Oxirgi to\'liq ishlagan oy', fmtMonth(o.smsAutoLastMonth)]]),
      }]
    },
  },
  {
    key: 'system.sms_limit', no: 62, category: 'system', name: 'SMS limiti tugayapti',
    confidence: 'fact', tier: 'admin',
    run: (c) => {
      const o = c.s.org
      if (!c.s.fullScope || o.smsLimit <= 0 || o.smsUsedThisMonth < o.smsLimit * 0.8) return []
      const over = o.smsUsedThisMonth >= o.smsLimit
      return [{
        ruleKey: 'system.sms_limit', category: 'system', severity: over ? 'critical' : 'warning',
        entityId: null, subjectKey: c.month,
        title: over
          ? `Bu oygi SMS limiti tugadi (${o.smsUsedThisMonth} / ${o.smsLimit}) — eslatmalar to'xtadi`
          : `SMS limitining ${Math.round((o.smsUsedThisMonth / o.smsLimit) * 100)}% ishlatildi (${o.smsUsedThisMonth} / ${o.smsLimit})`,
        detail: 'Limit tugasa avto-SMS va eskalatsiya xabarlari oy oxirigacha yuborilmaydi.',
        action: SETTINGS,
        evidence: table(['Ishlatilgan', 'Limit'], [[o.smsUsedThisMonth, o.smsLimit]]),
      }]
    },
  },
  {
    key: 'system.kpi_not_closed', no: 63, category: 'system', name: "O'tgan oy KPI yopilmagan",
    confidence: 'fact', tier: 'admin',
    run: (c) => {
      const o = c.s.org
      if (!c.s.fullScope || !o.kpiConfigured || c.day < 5 || o.prevKpiStatus === 'closed') return []
      return [{
        ruleKey: 'system.kpi_not_closed', category: 'system', severity: 'info',
        entityId: null, subjectKey: c.month,
        title: "O'tgan oy KPI natijalari yopilmagan — bonus hisoblanmagan",
        detail: 'Oy yopilmaguncha natijalar o\'zgarib turadi va xodimlar bonusini bilmaydi.',
        action: { label: 'KPI', path: '/ekohisob/kpi' },
      }]
    },
  },
]
