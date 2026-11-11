import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import { loadEntityDebts } from './entityDebtLoader'
import { uzNum as fmt } from '../lib/dateFormat'
import { isInSendWindow } from '../lib/smsBudget'
import { uztParts } from '../lib/uzt'

interface Debtor { name: string; mahalla?: string; months: number; debt: number; mode: string }

/**
 * Tuman to'plami uchun qarzdorlar ro'yxati (bir marta hisoblanadi, kesh bilan).
 * Faqat monthly_fixed va talon rejimi, faol tashkilotlar, minMonths+ oy qarz.
 */
async function loadDebtors(orgId: string, districtIds: string[], minMonths: number): Promise<Debtor[]> {
  const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
    where: {
      orgId,
      status: 'active',
      billingMode: { in: ['monthly_fixed', 'talon'] },
      districtId: { in: districtIds },
    },
    select: {
      id: true, name: true, monthlyFee: true, billingMode: true,
      mahalla: { select: { name: true } },
    },
  })
  // Kanonik qarz — BITTA SQL (hisobot/kartochka bilan bir xil)
  const debts = await loadEntityDebts(entities, orgId)
  return entities
    .map((e: any): Debtor => {
      const d = debts.get(e.id)!
      return { name: e.name, mahalla: e.mahalla?.name, months: d.debtMonths, debt: d.totalDebt, mode: e.billingMode }
    })
    .filter((d: Debtor) => d.months >= minMonths)
    .sort((a: Debtor, b: Debtor) => b.debt - a.debt)
}

/**
 * Har inspektorga/boshliqqa (botga ulangan) o'z tumanidagi ko'p oy qarzdor tashkilotlar
 * haqida Telegram eslatma yuboradi. Scheduler (haftalik) chaqiradi.
 *
 * - Rol: inspektor va boshliq — FAQAT o'z tumanlari (ekoScope qoidasi); tumani yo'q — hech narsa.
 * - Bitta tumanga bir nechta xodim biriktirilgan bo'lsa ro'yxat BIR marta hisoblanadi.
 * - Bitta Telegram xatosi (yoki hisoblash xatosi) butun yuborishni to'xtatmaydi.
 * - Faqat 10:00–18:00 UZT oynasida.
 */
export async function sendDebtRemindersToInspectors(minMonths = 2, now: Date = new Date()): Promise<void> {
  if (!isInSendWindow(uztParts(now)!.hour)) {
    console.log('[EkoDebtReminder] yuborish oynasidan (10–18 UZT) tashqari, o\'tkazildi')
    return
  }
  let links: any[]
  try {
    links = await (prisma as any).ekoHisobBotLink.findMany({
      include: {
        user: {
          select: {
            id: true, fullName: true, orgId: true, isActive: true, role: true,
            districts: { select: { districtId: true } },
          },
        },
      },
    })
  } catch (e: any) {
    console.error('[EkoDebtReminder] ulanishlarni o\'qib bo\'lmadi:', e?.message ?? e)
    return
  }

  const cache = new Map<string, Promise<Debtor[]>>()
  let delivered = 0, failed = 0

  for (const link of links) {
    try {
      const user = link.user
      if (!user || !user.isActive) continue
      if (user.role !== 'inspector' && user.role !== 'supervisor') continue
      const districtIds: string[] = [...new Set<string>(user.districts.map((d: any) => d.districtId))].sort()
      if (districtIds.length === 0) continue

      const key = `${user.orgId}|${districtIds.join(',')}`
      let pending = cache.get(key)
      if (!pending) {
        pending = loadDebtors(user.orgId, districtIds, minMonths)
        cache.set(key, pending)
      }
      const debtors = await pending
      if (debtors.length === 0) continue

      const top = debtors.slice(0, 15)
      const totalDebt = debtors.reduce((s, d) => s + d.debt, 0)
      let msg = `🔔 <b>Qarzdorlik eslatmasi</b>\n\n`
      msg += `Tumaningizda <b>${debtors.length}</b> ta tashkilot ${minMonths}+ oy qarzdor.\n`
      msg += `Jami qarz: <b>${fmt(totalDebt)} so'm</b>\n\n`
      top.forEach((d, i) => {
        const mh = d.mahalla ? ` [${d.mahalla}]` : ''
        const tag = d.mode === 'talon' ? ' 📋' : ''
        msg += `${i + 1}. ${d.name}${mh}${tag} — ${d.months} oy, ${fmt(d.debt)} so'm\n`
      })
      if (debtors.length > 15) msg += `\n...va yana ${debtors.length - 15} ta`
      msg += `\n\n📍 Joylashuv yuborib, borib gaplashing.`

      const ok = await sendEkoMessage(link.chatId, msg)
      if (ok) delivered++; else failed++
    } catch (e: any) {
      failed++
      console.error(`[EkoDebtReminder] link=${link?.id ?? '?'} xato:`, e?.message ?? e)
    }
  }
  console.log(`[EkoDebtReminder] ${links.length} ulanish: ${delivered} yuborildi, ${failed} xato`)
}
