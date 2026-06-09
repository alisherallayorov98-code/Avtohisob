import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { sendCareMessage } from './careBot'
import { sendToOrgAdmins } from './telegramBot'

// Texnik parvarish eslatmalari (bosqich 3).
// Har soat ishlaydi; faqat ish vaqti 08:00–18:00 (UZT) da eslatma yuboradi.
// Belgilangan kun kelganda har bir (vazifa, mashina) uchun yozuv ochadi,
// haydovchiga eslatma yuboradi; isbot (rasm/video) kelmaguncha har soat takrorlaydi.
// 18:00 dan keyin bajarilmaganlar "missed" bo'ladi.

const UZT_OFFSET_MS = 5 * 60 * 60 * 1000

// UZT bo'yicha hozirgi vaqt (UTC ga +5 surilgan Date)
function uzNow(): Date {
  return new Date(Date.now() + UZT_OFFSET_MS)
}

// UZT sanasini faqat-sana (00:00 UTC) Date sifatida — @db.Date bilan solishtirish uchun
function uzDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// Vazifa qamroviga (scope) qarab mashinalar ro'yxati
async function vehiclesForTask(task: any): Promise<any[]> {
  const baseWhere: any = { branch: { organizationId: task.organizationId } }
  if (task.scope === 'branch' && task.branchId) {
    baseWhere.branchId = task.branchId
  } else if (task.scope === 'vehicles') {
    if (!Array.isArray(task.vehicleIds) || task.vehicleIds.length === 0) return []
    baseWhere.id = { in: task.vehicleIds }
  }
  return (prisma as any).vehicle.findMany({
    where: baseWhere,
    select: { id: true, registrationNumber: true, branchId: true },
  })
}

function reminderText(taskName: string, desc: string | null, reg: string, count: number, overdue = false): string {
  const head = overdue
    ? `⚠️ <b>MUDDATI O'TGAN — hali bajarilmagan!</b>`
    : `🔧 <b>Texnik parvarish eslatmasi</b>`
  const again = count > 0 ? `\n\n🔁 Bu ${count + 1}-eslatma — bajarilmaguncha to'xtamaydi.` : ''
  return (
    `${head}\n\n` +
    `🚗 <b>${reg}</b>\n` +
    `📋 ${taskName}` +
    (desc ? `\n📝 ${desc}` : '') +
    `\n\nBajargach shu yerga <b>rasm yoki video</b> yuboring.` +
    again
  )
}

// Bitta mashina uchun bugun belgilangan vazifalar bo'yicha yozuv ochadi (yo'q bo'lsa).
// Bot (rasm yuborilganda) va nazorat paneli darrov ko'rsatishi uchun ishlatiladi.
export async function ensureSubmissionsForVehicle(vehicleId: string): Promise<void> {
  const now = uzNow()
  const weekday = now.getUTCDay()
  const today = uzDateOnly(now)
  const vehicle = await (prisma as any).vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, branchId: true, branch: { select: { organizationId: true } } },
  })
  const orgId = vehicle?.branch?.organizationId
  if (!orgId) return
  const driver = await (prisma as any).vehicleCareDriver.findUnique({ where: { vehicleId } })
  const tasks = await (prisma as any).vehicleCareTask.findMany({ where: { organizationId: orgId, isActive: true } })
  for (const task of tasks) {
    if (!Array.isArray(task.weekdays) || !task.weekdays.includes(weekday)) continue
    if (task.scope === 'branch' && task.branchId !== vehicle.branchId) continue
    if (task.scope === 'vehicles' && !(task.vehicleIds || []).includes(vehicleId)) continue
    await (prisma as any).vehicleCareSubmission.upsert({
      where: { taskId_vehicleId_dueDate: { taskId: task.id, vehicleId, dueDate: today } },
      create: {
        organizationId: orgId, taskId: task.id, vehicleId, dueDate: today,
        status: 'pending', driverChatId: driver?.chatId ?? null,
      },
      update: { driverChatId: driver?.chatId ?? null },
    })
  }
}

export async function runCareReminders(): Promise<void> {
  const now = uzNow()
  const hour = now.getUTCHours()       // UZT soati
  const weekday = now.getUTCDay()      // UZT hafta kuni 0..6
  const today = uzDateOnly(now)

  // 1) Bugun belgilangan vazifalar uchun yozuvlar ochamiz (faqat haydovchisi bor mashinaga)
  const tasks = await (prisma as any).vehicleCareTask.findMany({ where: { isActive: true } })
  for (const task of tasks) {
    if (!Array.isArray(task.weekdays) || !task.weekdays.includes(weekday)) continue
    const vehicles = await vehiclesForTask(task)
    for (const v of vehicles) {
      const driver = await (prisma as any).vehicleCareDriver.findUnique({ where: { vehicleId: v.id } })
      if (!driver) continue
      await (prisma as any).vehicleCareSubmission.upsert({
        where: { taskId_vehicleId_dueDate: { taskId: task.id, vehicleId: v.id, dueDate: today } },
        create: {
          organizationId: task.organizationId,
          taskId: task.id,
          vehicleId: v.id,
          dueDate: today,
          status: 'pending',
          driverChatId: driver.chatId,
        },
        update: { driverChatId: driver.chatId },
      })
    }
  }

  // 2) Ish vaqti (08:00–18:00) — bajarilmagan HAMMA vazifaga eslatma
  //    (bugungi + o'tib ketgan/kechikkanlar ham — bajarilmaguncha to'xtamaydi)
  if (hour >= 8 && hour <= 18) {
    const pendings = await (prisma as any).vehicleCareSubmission.findMany({
      where: { dueDate: { lte: today }, status: { not: 'done' }, driverChatId: { not: null } },
      orderBy: { dueDate: 'asc' },
    })
    for (const s of pendings) {
      const task = tasks.find((t: any) => t.id === s.taskId)
      if (!task) continue // faol bo'lmagan/o'chirilgan vazifa — eslatilmaydi
      const vehicle = await (prisma as any).vehicle.findUnique({
        where: { id: s.vehicleId },
        select: { registrationNumber: true },
      })
      const overdue = new Date(s.dueDate).getTime() < today.getTime()
      const ok = await sendCareMessage(
        s.driverChatId,
        reminderText(task.name, task.description, vehicle?.registrationNumber || '', s.reminderCount, overdue),
      )
      if (ok) {
        await (prisma as any).vehicleCareSubmission.update({
          where: { id: s.id },
          data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
        })
      }
    }
  }

  // Eslatma: "missed" deb yopib qo'ymaymiz — vazifa bajarilmaguncha pending qoladi.
  // Nazorat panelida o'tib ketganlar qizil "kechikkan" sifatida ko'rinadi.

  // 3) 18:00 (UZT) — adminlarga kunlik xulosa + kechikkanlar eskalatsiyasi
  if (hour === 18) {
    await sendCareDailySummary(today).catch((err) =>
      console.error('[CareScheduler] kunlik xulosa xatosi:', err?.message ?? err))
  }
}

// Adminlarga (asosiy bot orqali) kunlik xulosa: bugun bajarmaganlar + kechikkanlar
async function sendCareDailySummary(today: Date): Promise<void> {
  const ds = (d: Date) => d.toISOString().slice(0, 10)
  const activeTasks = await (prisma as any).vehicleCareTask.findMany({
    where: { isActive: true }, select: { organizationId: true },
  })
  const orgIds = [...new Set(activeTasks.map((t: any) => t.organizationId))] as string[]

  for (const orgId of orgIds) {
    const todaySubs = await (prisma as any).vehicleCareSubmission.findMany({
      where: { organizationId: orgId, dueDate: today },
    })
    const overdue = await (prisma as any).vehicleCareSubmission.findMany({
      where: { organizationId: orgId, dueDate: { lt: today }, status: { not: 'done' } },
      orderBy: { dueDate: 'asc' },
    })
    if (todaySubs.length === 0 && overdue.length === 0) continue

    const doneToday = todaySubs.filter((s: any) => s.status === 'done').length
    const notDoneToday = todaySubs.filter((s: any) => s.status !== 'done')

    const vIds = [...new Set([...notDoneToday, ...overdue].map((s: any) => s.vehicleId))]
    const vehicles = await (prisma as any).vehicle.findMany({
      where: { id: { in: vIds } }, select: { id: true, registrationNumber: true },
    })
    const regMap: Record<string, string> = Object.fromEntries(vehicles.map((v: any) => [v.id, v.registrationNumber]))

    let text = `🔧 <b>Texnik parvarish — kunlik xulosa</b>\n📅 ${ds(today)}\n\n`
    text += `✅ Bugun bajardi: <b>${doneToday}</b> / ${todaySubs.length}`
    if (notDoneToday.length) {
      text += `\n\n⏳ <b>Bugun bajarmaganlar (${notDoneToday.length}):</b>\n`
      text += notDoneToday.slice(0, 25).map((s: any) => `• ${regMap[s.vehicleId] || '—'}`).join('\n')
      if (notDoneToday.length > 25) text += `\n…va yana ${notDoneToday.length - 25} ta`
    }
    if (overdue.length) {
      text += `\n\n🔴 <b>Kechikkan — hali bajarilmagan (${overdue.length}):</b>\n`
      text += overdue.slice(0, 25).map((s: any) => {
        const days = Math.max(1, Math.round((today.getTime() - new Date(s.dueDate).getTime()) / 86400000))
        return `• ${regMap[s.vehicleId] || '—'} — ${days} kun`
      }).join('\n')
      if (overdue.length > 25) text += `\n…va yana ${overdue.length - 25} ta`
    }
    await sendToOrgAdmins(orgId, text)
  }
}

export function startCareScheduler(): void {
  // Har soatning boshida (xx:00) — UZT ichkarida hisoblanadi
  cron.schedule('0 * * * *', () => {
    runCareReminders().catch((err) => console.error('[CareScheduler] xato:', err?.message ?? err))
  })
  console.log('🔧 Texnik parvarish scheduler ishga tushdi (har soat, 08:00–18:00 UZT eslatma)')
}
