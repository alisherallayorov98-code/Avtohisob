// E. Xodimlar (70–79). FAQAT admin ko'radi. Reyting emas — har biri aniq holat haqida savol
// (ochiq shaxsiy reyting konflikt keltiradi). Taxmin (guess) bo'yicha hech kim ayblanmaydi.
import type { Rule, Finding } from '../types'
import { table, fmtDate, fmtDateTime, haversineM } from '../ctx'

/** Tashrif qaydi tashkilotdan shuncha metrdan uzoqda yozilsa — savol */
export const VISIT_FAR_M = 1000
export const INACTIVE_DAYS = 7

const USERS = { label: 'Foydalanuvchilar', path: '/ekohisob/admin/users' }

export const staffRules: Rule[] = [
  {
    key: 'staff.no_bot', no: 70, category: 'staff', name: 'Inspektor botga ulanmagan',
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.users
      .filter(u => u.isActive && u.role === 'inspector' && !u.botLinked && u.createdAt <= c.ago(2))
      .map(u => ({
        ruleKey: 'staff.no_bot', category: 'staff', severity: 'warning',
        entityId: null, subjectKey: u.id,
        title: `${u.fullName} Telegram botga ulanmagan — dalada to'lov va tashrifni qanday yozyapti?`,
        detail: "Bot orqali tasdiqli to'lov, tashrif qaydi va robot savollari yuboriladi. Foydalanuvchilar bo'limidan ulanish kodini bering.",
        action: USERS,
        evidence: table(['Xodim', "Qo'shilgan", 'Tumanlar'], [[u.fullName, fmtDate(u.createdAt), u.districtIds.length]]),
        staffUserId: u.id,
      } satisfies Finding)),
  },
  {
    key: 'staff.no_district', no: 71, category: 'staff', name: 'Xodimga tuman biriktirilmagan',
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.users
      .filter(u => u.isActive && (u.role === 'inspector' || u.role === 'supervisor') && u.districtIds.length === 0)
      .map(u => ({
        ruleKey: 'staff.no_district', category: 'staff', severity: 'warning',
        entityId: null, subjectKey: u.id,
        title: `${u.fullName} (${u.role === 'supervisor' ? 'boshliq' : 'inspektor'}) — tuman biriktirilmagan, tizimda hech narsa ko'rmaydi`,
        detail: "Tuman doirasi qoidasi: tumani yo'q xodim bo'sh ro'yxat ko'radi.",
        action: USERS,
        staffUserId: u.id,
      } satisfies Finding)),
  },
  {
    key: 'staff.visit_far', no: 72, category: 'staff', name: 'Tashrif qaydi tashkilotdan uzoqda yozilgan',
    confidence: 'guess', tier: 'admin',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.s.visits) {
        if (v.createdAt < c.ago(30) || v.lat == null || v.lon == null) continue
        const e = c.entity.get(v.entityId)
        if (!e || e.lat == null || e.lon == null) continue
        const m = haversineM(v.lat, v.lon, e.lat, e.lon)
        if (m < VISIT_FAR_M) continue
        out.push(c.f({
          ruleKey: 'staff.visit_far', category: 'staff', severity: m >= 5000 ? 'warning' : 'info',
          entityId: e.id, subjectKey: v.id,
          title: `${e.name} — tashrif qaydi tashkilotdan ${(m / 1000).toFixed(1)} km uzoqda yozilgan`,
          detail: `${c.userName(v.userId)}, ${fmtDateTime(v.createdAt)}. Tashkilot koordinatasi noto'g'ri bo'lishi ham mumkin — xulosadan oldin xodimdan so'rang.`,
          evidence: table(['Xodim', 'Vaqt', 'Masofa', 'Tashkilot koordinatasi', 'Qayd koordinatasi'], [[
            c.userName(v.userId), fmtDateTime(v.createdAt), `${Math.round(m)} m`,
            `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`, `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`,
          ]]),
          basis: "Faqat GPS nuqtalari solishtirildi. Tashkilot joylashuvi xato kiritilgan bo'lishi mumkin — bu taxmin.",
          staffUserId: v.userId,
        }))
      }
      return out
    },
  },
  {
    key: 'staff.inactive_inspector', no: 73, category: 'staff', name: 'Inspektor bir haftadan beri hech narsa kiritmagan',
    confidence: 'fact', tier: 'admin',
    run: (c) => c.s.users
      .filter(u => u.isActive && u.role === 'inspector' && u.districtIds.length > 0 && u.createdAt <= c.ago(INACTIVE_DAYS))
      .filter(u => !u.lastActivityAt || u.lastActivityAt < c.ago(INACTIVE_DAYS))
      .map(u => ({
        ruleKey: 'staff.inactive_inspector', category: 'staff', severity: 'info',
        entityId: null, subjectKey: u.id,
        title: `${u.fullName} ${u.lastActivityAt ? `${c.daysSince(u.lastActivityAt)} kundan beri` : 'hech qachon'} to'lov, tashrif yoki tashkilot kiritmagan — ta'tildami?`,
        detail: "Ta'tilda yoki kasal bo'lsa — normal. Aks holda uning tumanidagi qarzdorlar bilan hech kim ishlamayapti.",
        action: USERS,
        evidence: table(['Xodim', 'Oxirgi faollik', 'Tumanlar'], [[u.fullName, u.lastActivityAt ? fmtDateTime(u.lastActivityAt) : 'yo\'q', u.districtIds.length]]),
        staffUserId: u.id,
      } satisfies Finding)),
  },
]
