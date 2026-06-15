/**
 * smartAlerts.ts — Aqlli ogohlantirish tizimi
 *
 * #1  Yoqilg'i sarfi anomaliyasi         (fuel.ts → createFuelRecord)
 * #2  Mashina tez-tez ta'mirlanmoqda      (maintenance.ts → createMaintenance)
 * #3  Texosmotr / sug'urta muddati        (scheduler.ts — kunlik cron)
 * #4  Ehtiyot qism narx anomaliyasi       (maintenance.ts → createMaintenance)
 * #5  Ishchi — ayni mashinada qayta ta'mirlash (maintenance.ts → createMaintenance)
 * #6  Ombor minimumi ogohlantirishi       (maintenance.ts → createMaintenance, inventar kamaytirilganda)
 * #7  Yoqilg'i litr vs masofa mantiqsiz   (fuel.ts → createFuelRecord)
 * #8  Bir xil ishchi ko'p mashinada       (maintenance.ts → createMaintenance)
 *
 * Barcha funksiyalar non-blocking: .catch(() => {}) bilan chaqiriladi.
 */

import { prisma } from './prisma'
import { sendToOrgAdminsFiltered } from '../services/telegramBot'

// ─── Yordamchi funksiyalar ────────────────────────────────────────────────────

// Saytning bazaviy URL — env yoki default
const SITE_BASE = process.env.SITE_URL || 'https://avtohisob.uz'

async function sendTelegramForOrg(
  branchId: string,
  alertType: string,
  vehicleId: string | null,
  text: string,
  link?: string,
) {
  try {
    const branch = await (prisma.branch as any).findUnique({ where: { id: branchId }, select: { organizationId: true } })
    const orgId = branch?.organizationId ?? branchId
    const deepLink = link ? `${SITE_BASE}${link}` : undefined
    await sendToOrgAdminsFiltered(orgId, alertType, vehicleId, branchId, text, deepLink)
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
export async function checkFuelConsumptionAnomaly(
  vehicleId: string,
  vehicleBranchId: string,
  amountLiters: number,
  currentOdometer: number,
  prevOdometer: number | null
) {
  if (!prevOdometer || prevOdometer <= 0) return
  const km = currentOdometer - prevOdometer
  if (km < 10) return

  const consumption = (amountLiters / km) * 100

  const MAX_REALISTIC = 30
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
    await sendTelegramForOrg(vehicleBranchId, 'fuelAnomaly', vehicleId,
      `⛽ <b>Yoqilg'i sarfi juda yuqori</b>\n${vName}\n${consumption.toFixed(1)} l/100km sarflangan (max: ${MAX_REALISTIC} l/100km)`,
      `/fuel?vehicleId=${vehicleId}`)
    return
  }

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
    await sendTelegramForOrg(vehicleBranchId, 'fuelAnomaly', vehicleId,
      `⛽ <b>Yoqilg'i sarfi ko'paydi</b>\n${vName}\n${consumption.toFixed(1)} l/100km (+${pct}%, o'rtacha: ${avgConsumption.toFixed(1)})`,
      `/fuel?vehicleId=${vehicleId}`)
  }
}

// ─── #2: Mashina tez-tez ta'mirlanyapti ─────────────────────────────────────
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
    await sendTelegramForOrg(vehicleBranchId, 'maintenance', vehicleId,
      `🔩 <b>Mashina tez-tez ta'mirlanmoqda</b>\n${vName}\nSo'nggi 3 oyda ${count + 1} marta ta'mirga tushdi`,
      `/maintenance?vehicleId=${vehicleId}`)
  }
}

// ─── #4: Ehtiyot qism narx anomaliyasi ──────────────────────────────────────
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
      await sendTelegramForOrg(vehicleBranchId, 'sparePart', null,
        `📦 <b>Ehtiyot qism narxi keskin oshdi</b>\n"${partName}" (+${pct}%): ${Math.round(item.unitCost).toLocaleString()} so'm (o'rtacha: ${Math.round(avg).toLocaleString()})`,
        `/maintenance`)
    }
  }
}

// ─── #5: Ishchi — ayni mashinada qayta ta'mirlash ──────────────────────────────
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
      "Takroriy ta'mirlash — bir xil usta",
      `"${vName}" mashinasini "${workerName}" ustasi so'nggi 6 oy ichida ${count + 1} marta ta'mirladi. Bir xil muammo qayta takrorlanayotgan bo'lishi mumkin.`,
      'info',
      `/maintenance?vehicleId=${vehicleId}`
    )
    await sendTelegramForOrg(vehicleBranchId, 'maintenance', vehicleId,
      `🔩 <b>Takroriy ta'mirlash</b>\n${vName}\n"${workerName}" ustasi 6 oyda ${count + 1} marta ta'mirladi`,
      `/maintenance?vehicleId=${vehicleId}`)
  }
}

// ─── #6: Ombor minimumi — FOYDALANUVCHI ILTIMOSI BILAN OLIB TASHLANDI ───────
// (Avval bu yerda checkInventoryLow funksiyasi bor edi.)

// ─── #3: Texosmotr / sug'urta muddati tugayapti (scheduler) ─────────────────
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

    const addDocAlert = async (expiry: Date, docLabel: string, alertType: string) => {
      const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      const title = `${docLabel} muddati tugayapti`
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

      // Telegram — alert type bo'yicha filtrlangan
      const icon = alertType === 'insurance' ? '🛡' : '🔧'
      await sendTelegramForOrg(v.branchId, alertType, v.id,
        `🚗 <b>${vName}</b>\n${icon} ${docLabel}: <b>${daysLeft} kun</b> qoldi`,
        `/vehicles/${v.id}`)
    }

    if (v.insuranceExpiry) await addDocAlert(new Date(v.insuranceExpiry), "Sug'urta", 'insurance')
    if (v.techInspectionExpiry) await addDocAlert(new Date(v.techInspectionExpiry), 'Texosmotr', 'techInspection')

    if (notifData.length > 0) {
      await (prisma.notification as any).createMany({ data: notifData })
    }
  }
}

// ─── Motor moyi muddati: o'tib ketgan / yaqinlashgan mashinalar ──────────────
// Har kuni cron orqali ishlaydi. Moy almashtirish vaqti yetgan/o'tgan mashinalar
// uchun ilovada bildirishnoma (qo'ng'iroq) + Telegram yuboradi. Kunlik dedup.
export async function checkOilChangeOverdue() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayEnd = new Date(today)
  todayEnd.setHours(23, 59, 59, 999)

  // Org sozlamalarini bir martada yuklab, map ga solamiz (default interval/ogohlantirish)
  const allSettings = await (prisma as any).orgSettings.findMany({
    select: { orgId: true, oilIntervalKm: true, oilWarningKm: true },
  }).catch(() => [] as any[])
  const settingsMap = new Map<string, { intervalKm: number; warningKm: number }>()
  for (const s of allSettings) {
    settingsMap.set(s.orgId, { intervalKm: s.oilIntervalKm ?? 7000, warningKm: s.oilWarningKm ?? 500 })
  }

  const vehicles = await (prisma.vehicle as any).findMany({
    where: {
      status: 'active',
      serviceIntervals: { some: { serviceType: 'oil_change' } },
    },
    select: {
      id: true, brand: true, model: true, registrationNumber: true,
      branchId: true, mileage: true, oilIntervalKm: true,
      branch: { select: { organizationId: true } },
      serviceIntervals: {
        where: { serviceType: 'oil_change' },
        take: 1,
        select: { lastServiceKm: true, nextDueKm: true },
      },
    },
  })

  for (const v of vehicles) {
    const currentKm = Number(v.mileage)
    if (currentKm <= 0) continue  // odometr noma'lum — hisob ishonchsiz

    const interval = (v.serviceIntervals as any[])[0]
    if (!interval) continue

    const orgId = v.branch?.organizationId ?? v.branchId
    const def = settingsMap.get(orgId) ?? { intervalKm: 7000, warningKm: 500 }
    const effectiveIntervalKm = v.oilIntervalKm ?? def.intervalKm

    // nextDueKm ni jonli hisoblaymiz (eski saqlangan qiymatga tayanmaymiz)
    const nextDueKm = interval.lastServiceKm != null
      ? Number(interval.lastServiceKm) + effectiveIntervalKm
      : (interval.nextDueKm != null ? Number(interval.nextDueKm) : null)
    if (nextDueKm == null) continue

    let status: 'overdue' | 'due_soon' | null = null
    if (currentKm >= nextDueKm) status = 'overdue'
    else if (currentKm >= nextDueKm - def.warningKm) status = 'due_soon'
    if (!status) continue

    const recipients = await getOrgRecipients(v.branchId)
    if (recipients.length === 0) continue

    const vName = `${v.brand} ${v.model} (${v.registrationNumber})`
    const overdueKm = currentKm - nextDueKm  // >=0 o'tgan, <0 qolgan
    const title = status === 'overdue'
      ? `Moy almashtirish muddati o'tdi: ${v.registrationNumber}`
      : `Moy almashtirish vaqti yaqin: ${v.registrationNumber}`

    // Kunlik dedup — shu mashina uchun bugun yuborilgan bo'lsa qaytamiz
    const alreadySent = await (prisma.notification as any).findFirst({
      where: { userId: recipients[0], title, createdAt: { gte: today, lte: todayEnd } },
    })
    if (alreadySent) continue

    const message = status === 'overdue'
      ? `"${vName}" motor moyi almashtirilishi kerak edi — belgilangan kilometrdan ${overdueKm.toLocaleString()} km o'tib ketdi. Tezroq almashtiring!`
      : `"${vName}" motor moyi almashtirishga ${Math.abs(overdueKm).toLocaleString()} km qoldi. Rejalashtiring.`

    const notifData = recipients.map(userId => ({
      userId,
      title,
      message,
      type: status === 'overdue' ? 'error' : 'warning',
      link: '/oil-change',
    }))
    await (prisma.notification as any).createMany({ data: notifData })

    // Telegram — 'oilChange' turi (TelegramAdmin sozlamasida mavjud toggle bilan boshqariladi)
    const icon = status === 'overdue' ? '🛢🔴' : '🛢🟡'
    const tgLine = status === 'overdue'
      ? `${overdueKm.toLocaleString()} km o'tib ketdi`
      : `${Math.abs(overdueKm).toLocaleString()} km qoldi`
    await sendTelegramForOrg(v.branchId, 'oilChange', v.id,
      `🚗 <b>${vName}</b>\n${icon} Motor moyi: <b>${tgLine}</b>`,
      '/oil-change')
  }
}

// ─── #8: Bir xil ishchi ko'p mashinada ───────────────────────────────────────
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
    await sendTelegramForOrg(vehicleBranchId, 'maintenance', null,
      `🔩 <b>Usta juda ko'p mashina ta'mirladi</b>\n"${workerName}" — ${records.length + 1} ta mashina (1 oyda)`,
      `/maintenance`)
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
