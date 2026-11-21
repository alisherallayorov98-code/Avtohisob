// B. Qarz undirish (20–39). Ko'pchiligini robot tuman inspektoriga o'zi yuboradi (tier: auto).
import type { Rule, Finding } from '../types'
import { table, fmtDate, fmtDateTime, fmtMonth, fmtUzs, DAY_MS } from '../ctx'
import { findBrokenPromises } from '../../visitMath'
import { findStoppedPaying } from '../../paymentBehavior'

/** E'tiborsiz qarzdor: shuncha kunda na tashrif, na SMS, na to'lov */
export const UNTOUCHED_DAYS = 30
/** Ketma-ket buzilgan va'dalar — admin qarori */
export const REPEAT_PROMISES = 3

export const collectionRules: Rule[] = [
  {
    key: 'collection.promise_broken', no: 20, category: 'collection', name: "Va'da qilingan sana o'tdi, to'lov yo'q",
    confidence: 'fact', tier: 'auto',
    run: (c) => {
      const promises = c.s.visits
        .filter(v => v.kind === 'promised' && v.promisedDate && c.entity.get(v.entityId)?.status === 'active')
        .map(v => ({ id: v.id, entityId: v.entityId, promisedDate: v.promisedDate!, createdAt: v.createdAt }))
      const broken = findBrokenPromises(promises, c.s.payments.map(p => ({ entityId: p.entityId, paidAt: p.paidAt })), c.today)
      return broken
        .filter(b => b.daysOverdue >= 1)
        .map(b => {
          const e = c.entity.get(b.entityId)!
          const v = c.s.visits.find(x => x.id === b.visitId)!
          return c.f({
            ruleKey: 'collection.promise_broken', category: 'collection',
            severity: b.daysOverdue >= 7 ? 'critical' : 'warning',
            entityId: b.entityId, subjectKey: b.visitId,
            title: `${e.name} ${fmtDate(b.promisedDate)} da to'lashga va'da bergan edi — ${b.daysOverdue} kun o'tdi, to'lov yo'q`,
            detail: `${c.userName(v.userId)} yozgan.${e.debt > 0 ? ` Qarz: ${fmtUzs(e.debt)} (${e.debtMonths} oy).` : ''} Qayta boring yoki qo'ng'iroq qiling.`,
            impactUzs: e.debt,
            evidence: table(['Va\'da yozilgan', 'Va\'da sanasi', 'Yozgan', 'Joriy qarz'], [[
              fmtDateTime(v.createdAt), fmtDate(b.promisedDate), c.userName(v.userId), fmtUzs(e.debt),
            ]]),
          })
        })
    },
  },
  {
    key: 'collection.promise_repeated', no: 21, category: 'collection', name: "Qayta-qayta buzilgan va'dalar",
    confidence: 'fact', tier: 'admin',
    run: (c) => {
      const out: Finding[] = []
      for (const e of c.active) {
        const vs = (c.visitsBy.get(e.id) ?? []).filter(v => v.kind === 'promised' && v.promisedDate && v.createdAt >= c.ago(90))
        if (vs.length < REPEAT_PROMISES) continue
        const pays = c.paymentsBy.get(e.id) ?? []
        // Va'da sanasi o'tgan va undan keyin (va'da berilgandan beri) to'lov bo'lmagan va'dalar
        const broken = vs.filter(v => v.promisedDate! < c.today && !pays.some(p => p.paidAt >= v.createdAt))
        if (broken.length < REPEAT_PROMISES) continue
        out.push(c.f({
          ruleKey: 'collection.promise_repeated', category: 'collection', severity: 'warning',
          entityId: e.id, subjectKey: 'org',
          title: `${e.name} 90 kunda ${broken.length} marta va'da berib to'lamadi — keyingi qadam (ogohlantirish xati, qora ro'yxat)?`,
          detail: `Qarz: ${fmtUzs(e.debt)} (${e.debtMonths} oy). Yana va'da yozish foyda bermayapti.`,
          impactUzs: e.debt,
          evidence: table(['Yozilgan', 'Va\'da sanasi', 'Yozgan'], broken.map(v => [fmtDateTime(v.createdAt), fmtDate(v.promisedDate), c.userName(v.userId)])),
        }))
      }
      return out
    },
  },
  {
    key: 'collection.stopped_paying', no: 22, category: 'collection', name: "To'lashni to'xtatgan mijoz",
    confidence: 'strong', tier: 'auto',
    run: (c) => {
      if (c.s.evalMonths.length < 4) return []
      const cands = [...c.s.paidMonths.entries()]
        .filter(([id]) => c.entity.get(id)?.status === 'active')
        .map(([entityId, v]) => ({ entityId, months: c.s.evalMonths, paidMonths: new Set(v.months), avgPayment: v.avg }))
      return findStoppedPaying(cands, { minGap: 2, minHistory: 3 }).map(r => {
        const e = c.entity.get(r.entityId)!
        return c.f({
          ruleKey: 'collection.stopped_paying', category: 'collection',
          severity: r.gapMonths >= 4 ? 'critical' : 'warning',
          entityId: r.entityId, subjectKey: r.lastPaidMonth ?? 'none',
          title: `${e.name} ${r.paidBeforeGap} oy muntazam to'lab, ${r.gapMonths} oydan beri to'lamayapti — nima bo'ldi?`,
          detail: `Oxirgi to'lov: ${fmtMonth(r.lastPaidMonth)}. Biznes yopilganmi, boshqa firmaga o'tganmi yoki xizmatdan norozimi? Erta aniqlansa qaytarish oson.`,
          impactUzs: r.estimatedLoss,
          evidence: table(['Oxirgi to\'langan oy', 'To\'lamagan oylar', 'Avval to\'lagan oylar', "O'rtacha to'lov", "Taxminiy yo'qotish"], [[
            fmtMonth(r.lastPaidMonth), r.gapMonths, r.paidBeforeGap, fmtUzs(r.avgPayment), fmtUzs(r.estimatedLoss),
          ]]),
          basis: "To'lov tarixi (bir necha oy muntazam, keyin uzilish) bo'yicha — sababini faqat joyida bilish mumkin.",
        })
      })
    },
  },
  {
    key: 'collection.critical_untouched', no: 23, category: 'collection', name: "3+ oylik qarzdor bilan hech kim ishlamayapti",
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta 3+ oylik qarzdor bilan ${UNTOUCHED_DAYS} kunda hech kim ishlamagan`, severity: 'critical' },
    run: (c) => {
      const since = c.ago(UNTOUCHED_DAYS)
      return c.active
        .filter(e => e.debt > 0 && e.debtMonths >= 3)
        .filter(e => !(c.visitsBy.get(e.id) ?? []).some(v => v.createdAt >= since))
        .filter(e => !(c.smsBy.get(e.id) ?? []).some(s => s.status === 'sent' && s.createdAt >= since))
        .filter(e => !(c.paymentsBy.get(e.id) ?? []).some(p => p.paidAt >= since))
        .map(e => {
          const lastVisit = (c.visitsBy.get(e.id) ?? []).reduce<Date | null>((m, v) => (!m || v.createdAt > m ? v.createdAt : m), null)
          return c.f({
            ruleKey: 'collection.critical_untouched', category: 'collection', severity: 'critical',
            entityId: e.id, subjectKey: 'org',
            title: `${e.name} — ${e.debtMonths} oylik qarz (${fmtUzs(e.debt)}), ${UNTOUCHED_DAYS} kunda na tashrif, na SMS bo'lgan`,
            detail: `Eng eski qarz oyi: ${fmtMonth(e.oldestDebtMonth)}. Oxirgi tashrif: ${lastVisit ? fmtDate(lastVisit) : "hech qachon"}.`,
            impactUzs: e.debt,
            evidence: table(['Qarz', 'Oylar', 'Eng eski oy', 'Oxirgi tashrif', 'Telefon'], [[fmtUzs(e.debt), e.debtMonths, fmtMonth(e.oldestDebtMonth), lastVisit ? fmtDate(lastVisit) : 'yo\'q', e.phone || "yo'q"]]),
          })
        })
    },
  },
  {
    key: 'collection.variable_never_paid', no: 24, category: 'collection', name: "O'zgaruvchan rejim: hech qachon to'lamagan",
    confidence: 'fact', tier: 'auto',
    collapse: { title: (n) => `${n} ta "o'zgaruvchan" rejimdagi tashkilot hech qachon to'lamagan — qarz ham hisoblanmaydi`, action: { label: 'Tashkilotlar', path: '/ekohisob/entities' } },
    run: (c) => c.active
      .filter(e => e.billingMode === 'variable' && !c.s.everPaid.has(e.id) && e.createdAt <= c.ago(60))
      .map(e => c.f({
        ruleKey: 'collection.variable_never_paid', category: 'collection', severity: 'warning',
        entityId: e.id, subjectKey: 'org',
        title: `${e.name} ${Math.floor((c.now.getTime() - e.createdAt.getTime()) / DAY_MS)} kundan beri ro'yxatda, bir marta ham to'lamagan`,
        detail: `"O'zgaruvchan" rejimda qarz yozilmaydi — u qarzdorlar ro'yxatida ham ko'rinmaydi. Oylik summa belgilansinmi yoki tashkilot ishlamayaptimi?`,
        evidence: table(['Kiritilgan', 'Rejim', "To'lovlar"], [[fmtDate(e.createdAt), "O'zgaruvchan", 0]]),
      })),
  },
  {
    key: 'collection.blacklist_suggested', no: 25, category: 'collection', name: "Qora ro'yxatga tavsiya qilingan, qaror yo'q",
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.blacklistSuggested
      .filter(x => {
        const e = c.entity.get(x.entityId)
        return e && e.status === 'active' && e.debt > 0 && c.daysSince(x.at) >= 7
      })
      .map(x => {
        const e = c.entity.get(x.entityId)!
        return c.f({
          ruleKey: 'collection.blacklist_suggested', category: 'collection', severity: 'warning',
          entityId: e.id, subjectKey: 'org',
          title: `${e.name} ${c.daysSince(x.at)} kun oldin qora ro'yxatga tavsiya qilingan — qaror qabul qilinmagan`,
          detail: `Qarz: ${fmtUzs(e.debt)} (${e.debtMonths} oy). Qora ro'yxatga qo'shing yoki to'lov rejasi tuzing.`,
          impactUzs: e.debt,
          evidence: table(['Tavsiya sanasi', 'Qarz', 'Oylar'], [[fmtDate(x.at), fmtUzs(e.debt), e.debtMonths]]),
        })
      }),
  },
  {
    key: 'collection.blacklist_no_debt', no: 26, category: 'collection', name: "Qora ro'yxatda, lekin qarzi yo'q",
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.blacklist
      .filter(b => b.status === 'active')
      .flatMap(b => {
        const e = c.entity.get(b.entityId)
        if (!e || e.status !== 'blacklisted' || e.debt > 0) return []
        return [c.f({
          ruleKey: 'collection.blacklist_no_debt', category: 'collection', severity: 'info',
          entityId: e.id, subjectKey: 'org',
          title: `${e.name} qora ro'yxatda, lekin qarzi to'liq yopilgan — ro'yxatdan chiqarilsinmi?`,
          detail: `${fmtDate(b.addedAt)} dan beri qora ro'yxatda. Qarz yo'q bo'lsa xizmatni tiklash mumkin.`,
          action: { label: "Qora ro'yxat", path: '/ekohisob/blacklist' },
          evidence: table(["Qo'shilgan", 'Qarz'], [[fmtDate(b.addedAt), fmtUzs(0)]]),
        })]
      }),
  },
]
