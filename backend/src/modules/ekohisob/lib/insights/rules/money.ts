// A. Pul nazorati (1–19). Naqd pul yig'iladigan tizimda eng qimmat savollar.
// Hammasi admin qarori talab qiladi (tier: admin) — inspektorga avtomatik yuborilmaydi.
import type { Rule, Finding } from '../types'
import { table, fmtDate, fmtDateTime, fmtMonth, fmtUzs } from '../ctx'

/** Shu summadan katta bekor qilish — muhim */
export const BIG_VOID_UZS = 1_000_000
/** Dublikat to'lov: bir xil summa shu daqiqa ichida qayta yozilgan */
export const DUP_WINDOW_MIN = 10

export const moneyRules: Rule[] = [
  {
    key: 'money.receipt_voided', no: 1, category: 'money', name: "Kvitansiya bekor qilingan",
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.voidedReceipts
      .filter(r => r.voidedAt >= c.ago(30))
      .map((r): Finding => {
        const self = r.voidedBy && r.voidedBy === r.issuedBy
        const shortReason = !r.voidReason || r.voidReason.trim().length < 10
        const e = c.entity.get(r.entityId)
        return c.f({
          ruleKey: 'money.receipt_voided', category: 'money',
          severity: r.amount >= BIG_VOID_UZS || (self && shortReason) ? 'critical' : 'warning',
          entityId: r.entityId, subjectKey: r.id,
          title: `${r.receiptNumber} kvitansiya (${fmtUzs(r.amount)}) bekor qilindi — pul mijozga qaytarildimi?`,
          detail: `${e?.name ?? 'Tashkilot'}: ${fmtMonth(r.month)} uchun to'lov ${fmtDate(r.voidedAt)} da bekor qilingan. ` +
            `Mijoz qo'lida qog'oz kvitansiya qolgan bo'lishi mumkin.` +
            (self ? ' Kvitansiyani bergan va bekor qilgan — bitta odam.' : '') +
            (shortReason ? ' Sabab juda qisqa yozilgan.' : ''),
          impactUzs: r.amount,
          evidence: table(
            ['Maydon', 'Qiymat'],
            [
              ['Kvitansiya', r.receiptNumber], ['Summa', fmtUzs(r.amount)], ['Oy', fmtMonth(r.month)],
              ['Bergan', c.userName(r.issuedBy)], ['Berilgan vaqt', fmtDateTime(r.issuedAt)],
              ['Bekor qilgan', c.userName(r.voidedBy)], ['Bekor qilingan vaqt', fmtDateTime(r.voidedAt)],
              ['Sabab', r.voidReason || '—'],
            ],
          ),
          basis: 'Bekor qilish jurnalda yozilgan — bu fakt. Savol: pul haqiqatan qaytarildimi.',
        })
      }),
  },
  {
    key: 'money.duplicate_payment', no: 2, category: 'money', name: "Bir xil to'lov ikki marta",
    confidence: 'strong', tier: 'admin',
    run: (c) => {
      const out: Finding[] = []
      for (const [entityId, ps] of c.paymentsBy) {
        // Bitta kassa operatsiyasi (groupId) bir necha oyga bo'linadi — uni guruh sifatida olamiz
        const ops = new Map<string, { key: string; amount: number; at: Date; by: string; ids: string[] }>()
        for (const p of ps) {
          if (p.paidAt < c.ago(60)) continue
          const k = p.groupId || p.id
          const op = ops.get(k)
          if (op) { op.amount += p.amount; op.ids.push(p.id) } else ops.set(k, { key: k, amount: p.amount, at: p.paidAt, by: p.receivedBy, ids: [p.id] })
        }
        const list = [...ops.values()].sort((a, b) => a.at.getTime() - b.at.getTime())
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1], b = list[i]
          if (a.amount !== b.amount || a.by !== b.by) continue
          if (b.at.getTime() - a.at.getTime() > DUP_WINDOW_MIN * 60_000) continue
          const e = c.entity.get(entityId)
          out.push(c.f({
            ruleKey: 'money.duplicate_payment', category: 'money', severity: 'critical',
            entityId, subjectKey: `${a.key}|${b.key}`,
            title: `${e?.name ?? 'Tashkilot'} — ${fmtUzs(b.amount)} ${Math.max(1, Math.round((b.at.getTime() - a.at.getTime()) / 60_000))} daqiqa ichida ikki marta yozilgan. Ikkalasi ham haqiqiymi?`,
            detail: `${c.userName(b.by)} ikki marta bir xil summani qabul qilgan. Tasodifan qayta bosilgan bo'lsa, bittasini bekor qiling — aks holda mijozning qarzi noto'g'ri kamayadi.`,
            impactUzs: b.amount,
            evidence: table(['Vaqt', 'Summa', 'Qabul qilgan'], [
              [fmtDateTime(a.at), fmtUzs(a.amount), c.userName(a.by)],
              [fmtDateTime(b.at), fmtUzs(b.amount), c.userName(b.by)],
            ]),
            basis: "Bir xil summa, bir xil xodim, bir necha daqiqa farq — ikki yozuv bir-biriga zid bo'lishi mumkin.",
          }))
        }
      }
      return out
    },
  },
  {
    key: 'money.no_receipt', no: 3, category: 'money', name: "To'lovga kvitansiya chiqmagan",
    confidence: 'fact', tier: 'admin',
    collapse: { title: (n) => `${n} ta to'lovga kvitansiya chiqmagan — kvitansiya tizimi ishlayaptimi?`, severity: 'critical' },
    run: (c) => c.s.payments
      .filter(p => !p.hasReceipt && p.paidAt >= c.ago(60) && p.paidAt <= c.ago(0.01))
      .map(p => c.f({
        ruleKey: 'money.no_receipt', category: 'money', severity: 'warning',
        entityId: p.entityId, subjectKey: p.id,
        title: `${c.entity.get(p.entityId)?.name ?? 'Tashkilot'} — ${fmtUzs(p.amount)} to'lovga kvitansiya yo'q`,
        detail: `${fmtDateTime(p.paidAt)} da ${c.userName(p.receivedBy)} qabul qilgan (${fmtMonth(p.month)}). Mijoz pul berganini isbotlay olmaydi.`,
        impactUzs: p.amount,
        evidence: table(['Vaqt', 'Oy', 'Summa', 'Usul', 'Qabul qilgan'], [[fmtDateTime(p.paidAt), fmtMonth(p.month), fmtUzs(p.amount), p.method, c.userName(p.receivedBy)]]),
      })),
  },
  {
    key: 'money.talon_paid_no_payment', no: 4, category: 'money', name: "Talon to'langan, lekin to'lov yozuvi yo'q",
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.talons
      .filter(t => (t.paid || t.paidAmount > 0) && (!t.paymentId || !t.paymentExists) && t.createdAt >= c.ago(180))
      .map(t => {
        const paidPart = t.paid ? t.amount : Math.min(t.amount, t.paidAmount)
        return c.f({
          ruleKey: 'money.talon_paid_no_payment', category: 'money', severity: 'critical',
          entityId: t.entityId, subjectKey: t.id,
          title: `${c.entity.get(t.entityId)?.name ?? 'Tashkilot'} — talon ${fmtUzs(paidPart)} "to'landi", lekin kassada to'lov yo'q. Pul qayerda?`,
          detail: `${fmtDate(t.date)} sanali talon (${t.volume} kub) to'langan deb belgilangan, ammo unga bog'langan to'lov ${t.paymentId ? "o'chirilgan" : 'umuman yaratilmagan'}.`,
          impactUzs: paidPart,
          evidence: table(['Maydon', 'Qiymat'], [
            ['Talon sanasi', fmtDate(t.date)], ['Hajm', `${t.volume} kub`], ['Summa', fmtUzs(t.amount)],
            ["To'langan qism", fmtUzs(paidPart)], ["To'lov yozuvi", t.paymentId ? "o'chirilgan" : "yo'q"],
            ['Kiritgan', c.userName(t.createdBy)],
          ]),
        })
      }),
  },
  {
    key: 'money.charge_mismatch', no: 5, category: 'money', name: "Hisobdagi to'langan summa to'lovlarga teng emas",
    confidence: 'fact', tier: 'admin',
    collapse: { title: (n) => `${n} ta oylik hisobda "to'langan" summa haqiqiy to'lovlarga teng emas — qayta hisoblash kerak`, action: { label: 'Tashkilotlar', path: '/ekohisob/entities' } },
    run: (c) => c.s.chargeMismatches.map(m => c.f({
      ruleKey: 'money.charge_mismatch', category: 'money', severity: 'warning',
      entityId: m.entityId, subjectKey: m.month,
      title: `${c.entity.get(m.entityId)?.name ?? 'Tashkilot'} — ${fmtMonth(m.month)}: hisobda ${fmtUzs(m.chargePaid)} to'langan, to'lovlar esa ${fmtUzs(m.paymentsSum)}`,
      detail: "Qarz raqami noto'g'ri ko'rinishi mumkin. Kartochkadan hisob-kitob tarixini ochib, \"Qayta hisoblash\"ni bajaring.",
      impactUzs: Math.abs(m.chargePaid - m.paymentsSum),
      evidence: table(['Oy', 'Kutilgan', 'Hisobda to\'langan', "To'lovlar yig'indisi", 'Farq'], [[
        fmtMonth(m.month), fmtUzs(m.expected), fmtUzs(m.chargePaid), fmtUzs(m.paymentsSum), fmtUzs(m.chargePaid - m.paymentsSum),
      ]]),
    })),
  },
  {
    key: 'money.talon_underpriced', no: 6, category: 'money', name: 'Talon summasi kub × narxdan kam',
    confidence: 'guess', tier: 'admin',
    run: (c) => c.s.talons
      .filter(t => t.createdAt >= c.ago(60))
      .flatMap(t => {
        const e = c.entity.get(t.entityId)
        if (!e || e.cubicPrice <= 0) return []
        const expected = Math.round(t.volume * e.cubicPrice)
        if (t.amount >= expected - 1) return []
        return [c.f({
          ruleKey: 'money.talon_underpriced', category: 'money', severity: 'info',
          entityId: t.entityId, subjectKey: t.id,
          title: `${e.name} — talon ${fmtUzs(t.amount)}, kub × narx bo'yicha ${fmtUzs(expected)} bo'lishi kerak edi`,
          detail: `${fmtDate(t.date)}: ${t.volume} kub × ${fmtUzs(e.cubicPrice)}. Narx keyinroq o'zgargan bo'lsa — normal.`,
          impactUzs: expected - t.amount,
          evidence: table(['Hajm', 'Hozirgi kub narxi', 'Kutilgan', 'Talonda', 'Kiritgan'], [[`${t.volume} kub`, fmtUzs(e.cubicPrice), fmtUzs(expected), fmtUzs(t.amount), c.userName(t.createdBy)]]),
          basis: "Hozirgi narx bilan solishtirildi — talon yozilgan paytdagi narx boshqacha bo'lgan bo'lishi mumkin.",
        })]
      }),
  },
  {
    key: 'money.fee_lowered', no: 7, category: 'money', name: 'Oylik summa yoki kub narxi kamaytirilgan',
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.audit
      .filter(a => a.action === 'entity.update' && a.createdAt >= c.ago(60) && a.targetId)
      .flatMap(a => {
        const ch = a.details?.changes ?? {}
        const out: Finding[] = []
        for (const [field, label] of [['monthlyFee', 'Oylik summa'], ['cubicPrice', 'Kub narxi']] as const) {
          const v = ch[field]
          if (!v) continue
          const from = Number(v.from) || 0, to = Number(v.to) || 0
          if (!(from > 0 && to < from)) continue
          out.push(c.f({
            ruleKey: 'money.fee_lowered', category: 'money', severity: to === 0 ? 'critical' : 'warning',
            entityId: a.targetId, subjectKey: `${a.id}|${field}`,
            title: `${a.targetName ?? 'Tashkilot'} — ${label.toLowerCase()} ${fmtUzs(from)} dan ${fmtUzs(to)} ga tushirildi. Asos (shartnoma) bormi?`,
            detail: `${a.userName} ${fmtDateTime(a.createdAt)} da o'zgartirgan. Har oy ${fmtUzs(from - to)} kam yig'iladi.`,
            impactUzs: (from - to) * 12,
            evidence: table(['Maydon', 'Eski', 'Yangi', "O'zgartirgan", 'Vaqt'], [[label, fmtUzs(from), fmtUzs(to), a.userName, fmtDateTime(a.createdAt)]]),
            staffUserId: a.userId,
          }))
        }
        return out
      }),
  },
  {
    key: 'money.mode_to_variable', no: 8, category: 'money', name: "Belgilangan oylikdan o'zgaruvchanga o'tkazilgan",
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.audit
      .filter(a => a.action === 'entity.billing_mode' && a.createdAt >= c.ago(60) && a.targetId &&
        a.details?.from === 'monthly_fixed' && a.details?.to === 'variable')
      .map(a => c.f({
        ruleKey: 'money.mode_to_variable', category: 'money', severity: 'warning',
        entityId: a.targetId, subjectKey: a.id,
        title: `${a.targetName ?? 'Tashkilot'} — "o'zgaruvchan" rejimga o'tkazildi: endi unga qarz yozilmaydi. Sababi?`,
        detail: `${a.userName} ${fmtDateTime(a.createdAt)} da o'zgartirgan. O'zgaruvchan rejimda to'lamasa ham qarzdorlar ro'yxatiga tushmaydi.`,
        evidence: table(['Eski rejim', 'Yangi rejim', "O'zgartirgan", 'Vaqt'], [['Belgilangan oylik', "O'zgaruvchan", a.userName, fmtDateTime(a.createdAt)]]),
        staffUserId: a.userId,
      })),
  },
]
