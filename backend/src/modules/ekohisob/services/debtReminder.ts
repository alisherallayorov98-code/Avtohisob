import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import { computeEntityDebt } from '../lib/debtMath'
import { uzNum as fmt } from '../lib/dateFormat'

/**
 * Har inspektorga (botga ulangan) o'z tumanidagi ko'p oy qarzdor tashkilotlar
 * haqida Telegram eslatma yuboradi. Scheduler (haftalik) chaqiradi.
 * Faqat monthly_fixed tashkilotlar — ochiq/qisman charge soni >= minMonths.
 */
export async function sendDebtRemindersToInspectors(minMonths = 2): Promise<void> {
  try {
    // Botga ulangan inspektorlar (chatId bor)
    const links = await (prisma as any).ekoHisobBotLink.findMany({
      include: {
        user: {
          select: {
            id: true, fullName: true, orgId: true, isActive: true, role: true,
            districts: { select: { districtId: true } },
          },
        },
      },
    })

    for (const link of links) {
      const user = link.user
      if (!user || !user.isActive) continue
      const districtIds = user.districts.map((d: any) => d.districtId)
      if (districtIds.length === 0) continue

      // Shu tumanlardagi qarzdor tashkilotlar — belgilangan oylik VA talon rejimi.
      // Ilgari faqat monthly_fixed olinardi: talon mijozlarining qarzi inspektorga
      // hech qachon eslatilmasdi.
      const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: {
          orgId: user.orgId,
          status: 'active',
          billingMode: { in: ['monthly_fixed', 'talon'] },
          districtId: { in: districtIds },
        },
        select: {
          id: true, name: true, monthlyFee: true, billingMode: true,
          mahalla: { select: { name: true } },
          charges: { where: { status: { in: ['open', 'partial'] } }, select: { month: true, expectedAmount: true, paidAmount: true } },
          talons: { where: { paid: false }, select: { date: true, amount: true, paid: true } },
        },
      })

      const debtors = entities
        .map((e: any) => {
          const d = computeEntityDebt({
            billingMode: e.billingMode,
            charges: e.charges,
            talons: e.talons,
          })
          return {
            name: e.name,
            mahalla: e.mahalla?.name,
            months: d.debtMonths,
            debt: d.totalDebt,
            mode: e.billingMode,
          }
        })
        .filter((d: any) => d.months >= minMonths)
        .sort((a: any, b: any) => b.debt - a.debt)

      if (debtors.length === 0) continue

      const top = debtors.slice(0, 15)
      const totalDebt = debtors.reduce((s: number, d: any) => s + d.debt, 0)
      let msg = `🔔 <b>Qarzdorlik eslatmasi</b>\n\n`
      msg += `Tumaningizda <b>${debtors.length}</b> ta tashkilot ${minMonths}+ oy qarzdor.\n`
      msg += `Jami qarz: <b>${fmt(totalDebt)} so'm</b>\n\n`
      top.forEach((d: any, i: number) => {
        const mh = d.mahalla ? ` [${d.mahalla}]` : ''
        const tag = d.mode === 'talon' ? ' 📋' : ''
        msg += `${i + 1}. ${d.name}${mh}${tag} — ${d.months} oy, ${fmt(d.debt)} so'm\n`
      })
      if (debtors.length > 15) msg += `\n...va yana ${debtors.length - 15} ta`
      msg += `\n\n📍 Joylashuv yuborib, borib gaplashing.`

      await sendEkoMessage(link.chatId, msg)
    }
    console.log(`[EkoDebtReminder] ${links.length} inspektorga eslatma tekshirildi`)
  } catch (e: any) {
    console.error('[EkoDebtReminder] xato:', e?.message ?? e)
  }
}
