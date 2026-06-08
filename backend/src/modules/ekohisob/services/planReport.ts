import { prisma } from '../../../lib/prisma'
import { sendEkoMessage } from '../../../services/ekoFieldBot'
import { entityProgress } from '../controllers/plans'

/**
 * Supervisor botiga plan bajarilishi hisoboti yuboradi.
 * - 'evening' (kun oxiri): bugungi natija
 * - 'morning' (yangi kun): kechagi natija
 * Scheduler (cron) chaqiradi.
 */
export async function sendPlanReports(when: 'evening' | 'morning'): Promise<void> {
  try {
    // Sana: kun oxiri — bugun; ertalab — kecha
    const d = new Date()
    if (when === 'morning') d.setUTCDate(d.getUTCDate() - 1)
    const dateStr = d.toISOString().slice(0, 10)
    const dateObj = new Date(dateStr + 'T00:00:00.000Z')

    // Botga ulangan supervisorlar
    const supervisors = await (prisma as any).ekoHisobUser.findMany({
      where: { role: 'supervisor', isActive: true, botLink: { isNot: null } },
      include: { botLink: { select: { chatId: true } }, districts: { select: { districtId: true } } },
    })

    for (const sup of supervisors) {
      const districtIds = sup.districts.map((x: any) => x.districtId)
      if (districtIds.length === 0) continue

      const inspectors = await (prisma as any).ekoHisobUser.findMany({
        where: { orgId: sup.orgId, role: 'inspector', isActive: true, districts: { some: { districtId: { in: districtIds } } } },
        select: { id: true, fullName: true }, orderBy: { fullName: 'asc' },
      })
      if (inspectors.length === 0) continue

      const plans = await (prisma as any).ekoHisobPlan.findMany({
        where: { orgId: sup.orgId, date: dateObj, type: 'new_entity' },
      })
      const planMap = new Map<string, any>(plans.map((p: any) => [p.inspectorId, p]))

      const lines: string[] = []
      let anyPlan = false
      for (const insp of inspectors) {
        const done = await entityProgress(sup.orgId, insp.id, dateStr)
        const plan = planMap.get(insp.id)
        if (plan) {
          anyPlan = true
          const reached = done >= plan.targetCount
          lines.push(`${reached ? '✅' : '⚠️'} ${insp.fullName}: ${done}/${plan.targetCount}`)
        } else if (done > 0) {
          lines.push(`• ${insp.fullName}: ${done} ta (plansiz)`)
        }
      }
      if (lines.length === 0) continue

      const title = when === 'evening'
        ? `📋 <b>Kun yakuni — ${dateStr}</b>\nInspektorlar plan bajarilishi:`
        : `📋 <b>Kechagi natija — ${dateStr}</b>\nInspektorlar plan bajarilishi:`
      const footer = when === 'morning' && anyPlan
        ? '\n\n💡 Bugun uchun yangi plan berishni unutmang ("📋 Plan berish").'
        : ''

      await sendEkoMessage(sup.botLink.chatId, `${title}\n━━━━━━━━━━━━━━\n${lines.join('\n')}${footer}`)
    }
  } catch (err: any) {
    console.error('sendPlanReports error:', err?.message ?? err)
  }
}
