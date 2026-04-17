/**
 * smartAlerts.ts — Aqlli ogohlantirish tizimi
 *
 * #1  Yoqilg'i sarfi anomaliyasi         (fuel.ts → createFuelRecord)
 * #2  Mashina tez-tez ta'mirlanmoqda      (maintenance.ts → createMaintenance)
 * #3  Texosmotr / sug'urta muddati        (scheduler.ts — kunlik cron)
 * #4  Ehtiyot qism narx anomaliyasi       (maintenance.ts → createMaintenance)
 * #5  Ishchi — ayni mashinada qayta ta'mirat (maintenance.ts → createMaintenance)
 * #6  Ombor minimumi ogohlantirishi       (maintenance.ts → createMaintenance, inventar kamaytirilganda)
 * #7  Yoqilg'i litr vs masofa mantiqsiz   (fuel.ts → createFuelRecord)
 * #8  Bir xil ishchi ko'p mashinada       (maintenance.ts → createMaintenance)
 *
 * Barcha funksiyalar non-blocking: .catch(() => {}) bilan chaqiriladi.
 */

import { prisma } from './prisma'
import { sendTelegramMessage } from '../services/telegramService'

// ─── Yordamchi funksiyalar ────────────────────────────────────────────────────

async function sendTelegramForOrg(branchId: string, text: string) {
  try {
    const branch = await (prisma.branch as any).findUnique({ where: { id: branchId }, select: { organizationId: true } })
    const orgId = branch?.organizationId ?? branchId
    const settings = await (prisma as any).orgSettings.findUnique({ where: { orgId } })
    if (settings?.telegramBotToken && settings?.telegramChatId) {
      await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, text)
    }
  } catch (_) { /* Telegram xatosi asosiy jarayonni to'xtatmasin */ }
}

async function getOrgRecipients(branchId: string): Promise<string[]> {
  const branch = await (prisma.branch as any).findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  })
  const orgId = branch?.organizationId ?? branchId
  const orgBranches = await (prisma.branch as any).findMany({
    where: { organizationId: orgId },
    select: { id: true },
  })
  const orgBranchIds = orgBranches.map((b: any) => b.id as string)
  const users = await prisma.user.findMany({
    where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
    select: { id: true },
  })
  return users.map(u => u.id)
}

async function createNotifications(
  recipientIds: string[],
  title: string,
  message: string,
  type: 'info' | 'warning' | 'error',
  link?: string
) {
  if (recipientIds.length === 0) return
  await (prisma.notification as any).createMany({
    data: recipientIds.map(userId => ({ userId, title, message, type, link })),
  })
}

async function getVehicleName(vehicleId: string): Promise<string> {
  const v = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { brand: true, model: true, registrationNumber: true },
  })
  return v ? `${v.brand} ${v.model} (${v.registrationNumber})` : vehicleId
}

// ─── #1 + #7: Yoqilg'i sarfi anomaliyasi ────────────────────────────────────
/**
 * Yangi yoqilg'i yozuvi qo'shilganda:
 * - Km ga nisbatan litr sarfini hisoblaydi
 * - 30 l/100km dan oshsa → darhol ogohlantirish (#7)
 * - O'rtachadan 30%+ yuqori bo'lsa → ogohlantirish (#1)
 */
export async function checkFuelConsumptionAnomaly(
  vehicleId: string,
  vehicleBranchId: string,
  amountLiters: number,
  currentOdometer: number,
  prevOdometer: number | null
) {
  if (!prevOdometer || prevOdometer <= 0) return
  const km = currentOdometer - prevOdometer
  if (km < 10) return // Juda qisqa masofa — o'tkazib yuborish

  const consumption = (amountLiters / km) * 100 // l/100km

  const MAX_REALISTIC = 30 // l/100km — jismoniy chegara
  if (consumption > MAX_REALISTIC) {
    const vName = await getVehicleName(vehicleId)
    const recipients = await getOrgRecipients(vehicleBranchId)
    await createNotifications(
      recipients,
      "Yoqilg'i sarfi juda yuqori",
      `"${vName}" mashinasida ${km.toFixed(0)} km uchun ${consumption.toFixed(1)} l/100km sarflangan. Bu realistik darajadan (${MAX_REALISTIC} l/100km) oshdi — yoqilg'i o'g'irligini tekshiring!`,
      'warning',
      `/fuel?vehicleId=${vehicleId}`
    )
    return
  }

  // Tarixiy o'rtacha bilan solishtirish (oxirgi 10 ta to'ldirish)
  const history = await prisma.fuelRecord.findMany({
    where: { vehicleId },
    orderBy: { odometerReading: 'desc' },
    take: 12,
    select: { amountLiters: true, odometerReading: true },
  })
  if (history.length < 4) return

  let totalL = 0, totalKm = 0, count = 0
  for (let i = 0; i < history.length - 1; i++) {
    const segKm = Number(history[i].odometerReading) - Number(history[i + 1].odometerReading)
    if (segKm >= 10) {
      totalL += Number(history[i].amountLiters)
      totalKm += segKm
      count++
    }
  }
  if (totalKm <= 0 || count < 3) return

  const avgConsumption = (totalL / totalKm) * 100
  if (consumption > avgConsumption * 1.3) {
    const pct = Math.round((consumption / avgConsumption - 1) * 100)
    const vName = await getVehicleName(vehicleId)
    const recipients = await getOrgRecipients(vehicleBranchId)
    await createNotifications(
      recipients,
      "Yoqilg'i sarfi ko'paydi",
      `"${vName}" mashinasida yoqilg'i sarfi o'rtachadan ${pct}% yuqori: ${consumption.toFixed(1)} l/100km (o'rtacha: ${avgConsumption.toFixed(1)} l/100km). Dvigatel yoki yoqilg'i o'g'irligini tekshiring!`,
      'warning',
      `/fuel?vehicleId=${vehicleId}`
    )
  }
}

// ─── #2: Mashina tez-tez ta'mirlanyapti ─────────────────────────────────────
/**
 * So'nggi 3 oy ichida 3 va undan ko'p marta ta'mirlangan bo'lsa ogohlantiradi.
 */
export async function checkFrequentMaintenance(
  newRecordId: string,
  vehicleId: string,
  vehicleBranchId: string,
  installationDate: Date
) {
  const threeMonthsAgo = new Date(installationDate)
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const count = await prisma.maintenanceRecord.count({
    where: { vehicleId, id: { not: newRecordId }, installationDate: { gte: threeMonthsAgo } },
  })

  if (count >= 3) {
    const vName = await getVehicleName(vehicleId)
    const recipients = await getOrgRecipients(vehicleBranchId)
    await createNotifications(
      recipients,
      "Mashina tez-tez ta'mirlanmoqda",
      `"${vName}" mashinasi so'nggi 3 oy ichida ${count + 1} marta ta'mirga tushdi. Hisobdan chiqarishni ko'rib chiqing yoki chuqur tekshiruv o'tkazing.`,
      'warning',
      `/maintenance?vehicleId=${vehicleId}`
    )
  }
}

// ─── #4: Ehtiyot qism narx anomaliyasi ──────────────────────────────────────
/**
 * Kiritilgan narx o'rtacha tarixiy narxdan 50%+ yuqori bo'lsa ogohlantiradi.
 */
export async function checkPartPriceAnomaly(
  vehicleBranchId: string,
  items: Array<{ sparePartId: string; unitCost: number }>
) {
  for (const item of items) {
    if (item.unitCost <= 0) continue

    const history = await prisma.maintenanceRecord.findMany({
      where: { items: { some: { sparePartId: item.sparePartId, unitCost: { gt: 0 } } } },
      include: {
        items: {
          where: { sparePartId: item.sparePartId, unitCost: { gt: 0 } },
          select: { unitCost: true },
        },
      },
      orderBy: { installationDate: 'desc' },
      take: 10,
    })

    const allCosts = history.flatMap(r => r.items.map(i => Number(i.unitCost)))
    if (allCosts.length < 3) continue

    const avg = allCosts.reduce((s, c) => s + c, 0) / allCosts.length
    if (item.unitCost > avg * 1.5) {
      const pct = Math.round((item.unitCost / avg - 1) * 100)
      const sparePart = await prisma.sparePart.findUnique({
        where: { id: item.sparePartId },
        select: { name: true },
      })
      const partName = sparePart?.name || "Noma'lum qism"
      const recipients = await getOrgRecipients(vehicleBranchId)
      await createNotifications(
        recipients,
        'Ehtiyot qism narxi keskin oshdi',
        `"${partName}" narxi o'rtachadan ${pct}% yuqori kiritildi: ${Math.round(item.unitCost).toLocaleString()} so'm (o'rtacha: ${Math.round(avg).toLocaleString()} so'm). Tekshiring!`,
        'warning',
        `/maintenance`
      )
    }
  }
}

// ─── #5: Ishchi — ayni mashinada qayta ta'mirat ──────────────────────────────
/**
 * Bir xil usta bir mashinani so'nggi 6 oy ichida 3+ marta ta'mirlagan bo'lsa ogohlantiradi.
 */
export async function checkWorkerRepeatOnVehicle(
  newRecordId: string,
  vehicleId: string,
  vehicleBranchId: string,
  workerName: string | null | undefined,
  installationDate: Date
) {
  if (!workerName?.trim()) return

  const sixMonthsAgo = new Date(installationDate)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const count = await prisma.maintenanceRecord.count({
    where: {
      vehicleId,
      workerName,
      id: { not: newRecordId },
      installationDate: { gte: sixMonthsAgo },
    },
  })

  if (count >= 2) {
    const vName = await getVehicleName(vehicleId)
    const recipients = await getOrgRecipients(vehicleBranchId)
    await createNotifications(
      recipients,
      "Takroriy ta'mirat — bir xil usta",
      `"${vName}" mashinasini "${workerName}" ustasi so'nggi 6 oy ichida ${count + 1} marta ta'mirladi. Bir xil muammo qayta takrorlanayotgan bo'lishi mumkin.`,
      'info',
      `/maintenance?vehicleId=${vehicleId}`
    )
  }
}

// ─── #6: Ombor minimumi ogohlantirishi ───────────────────────────────────────
/**
 * Inventar kamaytirilgandan so'ng, qolgan miqdor reorderLevel dan past tushsa ogohlantiradi.
 */
export async function checkInventoryLow(
  warehouseId: string,
  sparePartId: string,
  vehicleBranchId: string
) {
  const inv = await (prisma.inventory as any).findUnique({
    where: { sparePartId_warehouseId: { sparePartId, warehouseId } },
    include: { sparePart: { select: { name: true } } },
  })
  if (!inv) return
  if (inv.quantityOnHand > inv.reorderLevel) return

  const partName = inv.sparePart?.name || "Noma'lum qism"
  const recipients = await getOrgRecipients(vehicleBranchId)
  await createNotifications(
    recipients,
    'Ombor minimumi — buyurtma bering',
    `"${partName}" omborda ${inv.quantityOnHand} ta qoldi (minimum daraja: ${inv.reorderLevel} ta). Yangi buyurtma berish vaqti!`,
    'info',
    `/inventory?warehouseId=${warehouseId}`
  )
}

// ─── #3: Texosmotr / sug'urta muddati tugayapti (scheduler) ─────────────────
/**
 * Kunlik cron tomonidan chaqiriladi.
 * 30 kun va 7 kun qolganda ogohlantirish yaratadi. Bir kunda bir marta.
 */
export async function checkVehicleDocumentExpiry() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const in30Days = new Date(today)
  in30Days.setDate(in30Days.getDate() + 30)
  const todayEnd = new Date(today)
  todayEnd.setHours(23, 59, 59, 999)

  const vehicles = await (prisma.vehicle as any).findMany({
    where: {
      status: 'active',
      OR: [
        { insuranceExpiry: { lte: in30Days, gte: today } },
        { techInspectionExpiry: { lte: in30Days, gte: today } },
      ],
    },
    select: {
      id: true, brand: true, model: true, registrationNumber: true,
      branchId: true, insuranceExpiry: true, techInspectionExpiry: true,
    },
  })

  for (const v of vehicles) {
    const vName = `${v.brand} ${v.model} (${v.registrationNumber})`
    const recipients = await getOrgRecipients(v.branchId)
    if (recipients.length === 0) continue

    const notifData: any[] = []

    const addDocAlert = async (expiry: Date, docLabel: string, linkSuffix: string) => {
      const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      const title = `${docLabel} muddati tugayapti`
      // Bugun allaqachon shu haqda xabar yuborilganmi?
      const alreadySent = await (prisma.notification as any).findFirst({
        where: { userId: recipients[0], title, createdAt: { gte: today, lte: todayEnd } },
      })
      if (alreadySent) return

      const type = daysLeft <= 7 ? 'error' : 'warning'
      const expiryStr = expiry.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' })
      for (const userId of recipients) {
        notifData.push({
          userId,
          title,
          message: `"${vName}" mashinasining ${docLabel.toLowerCase()} ${daysLeft} kundan keyin tugaydi (${expiryStr}). Yangilang!`,
          type,
          link: `/vehicles/${v.id}`,
        })
      }
    }

    if (v.insuranceExpiry) await addDocAlert(new Date(v.insuranceExpiry), "Sug'urta", 'insurance')
    if (v.techInspectionExpiry) await addDocAlert(new Date(v.techInspectionExpiry), 'Texosmotr', 'tech')

    if (notifData.length > 0) {
      await (prisma.notification as any).createMany({ data: notifData })
      // Telegram ga ham yuborish
      const msgLines: string[] = [`🚗 <b>${vName}</b>`]
      if (v.insuranceExpiry) {
        const d = Math.ceil((new Date(v.insuranceExpiry).getTime() - today.getTime()) / 86400000)
        if (d <= 30) msgLines.push(`🛡 Sug'urta: <b>${d} kun</b> qoldi`)
      }
      if (v.techInspectionExpiry) {
        const d = Math.ceil((new Date(v.techInspectionExpiry).getTime() - today.getTime()) / 86400000)
        if (d <= 30) msgLines.push(`🔧 Texosmotr: <b>${d} kun</b> qoldi`)
      }
      await sendTelegramForOrg(v.branchId, msgLines.join('\n'))
    }
  }
}

// ─── #8: Bir xil ishchi ko'p mashinada ───────────────────────────────────────
/**
 * Bir usta so'nggi 1 oy ichida 5 ta va undan ko'p turli mashinani ta'mirlagan bo'lsa ogohlantiradi.
 * (Hisob-kitoblarni shishirish belgisi bo'lishi mumkin)
 */
export async function checkWorkerHighVolume(
  newRecordId: string,
  vehicleBranchId: string,
  workerName: string | null | undefined,
  installationDate: Date
) {
  if (!workerName?.trim()) return

  const oneMonthAgo = new Date(installationDate)
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

  const records = await prisma.maintenanceRecord.findMany({
    where: {
      workerName,
      id: { not: newRecordId },
      installationDate: { gte: oneMonthAgo },
      vehicle: { branchId: { in: await getOrgBranchIds(vehicleBranchId) } },
    },
    select: { vehicleId: true },
    distinct: ['vehicleId'],
  })

  if (records.length >= 5) {
    const recipients = await getOrgRecipients(vehicleBranchId)
    await createNotifications(
      recipients,
      "Usta juda ko'p mashina ta'mirladi",
      `"${workerName}" ustasi so'nggi 1 oy ichida ${records.length + 1} ta turli mashinani ta'mirladi. Hisob-kitoblarni tekshiring.`,
      'info',
      `/maintenance`
    )
  }
}

async function getOrgBranchIds(branchId: string): Promise<string[]> {
  const branch = await (prisma.branch as any).findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  })
  const orgId = branch?.organizationId ?? branchId
  const branches = await (prisma.branch as any).findMany({
    where: { organizationId: orgId },
    select: { id: true },
  })
  return branches.map((b: any) => b.id as string)
}
