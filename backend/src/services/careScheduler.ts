import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { sendCareMessage } from './careBot'

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

function reminderText(taskName: string, desc: string | null, reg: string, count: number): string {
  const again = count > 0 ? `\n\n🔁 Bu ${count + 1}-eslatma — hali bajarilmagan.` : ''
  return (
    `🔧 <b>Texnik parvarish eslatmasi</b>\n\n` +
    `🚗 <b>${reg}</b>\n` +
    `📋 ${taskName}` +
    (desc ? `\n📝 ${desc}` : '') +
    `\n\nBajargach shu yerga <b>rasm yoki video</b> yuboring.` +
    again
  )
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

  // 2) Ish vaqti (08:00–18:00) — bajarilmaganlarga eslatma
  if (hour >= 8 && hour <= 18) {
    const pendings = await (prisma as any).vehicleCareSubmission.findMany({
      where: { dueDate: today, status: 'pending', driverChatId: { not: null } },
    })
    for (const s of pendings) {
      const task = tasks.find((t: any) => t.id === s.taskId)
      if (!task) continue
      const vehicle = await (prisma as any).vehicle.findUnique({
        where: { id: s.vehicleId },
        select: { registrationNumber: true },
      })
      const ok = await sendCareMessage(
        s.driverChatId,
        reminderText(task.name, task.description, vehicle?.registrationNumber || '', s.reminderCount),
      )
      if (ok) {
        await (prisma as any).vehicleCareSubmission.update({
          where: { id: s.id },
          data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
        })
      }
    }
  }

  // 3) 18:00 dan keyin — bugungi bajarilmaganlar "missed"
  if (hour >= 19) {
    await (prisma as any).vehicleCareSubmission.updateMany({
      where: { dueDate: today, status: 'pending' },
      data: { status: 'missed' },
    })
  }
}

export function startCareScheduler(): void {
  // Har soatning boshida (xx:00) — UZT ichkarida hisoblanadi
  cron.schedule('0 * * * *', () => {
    runCareReminders().catch((err) => console.error('[CareScheduler] xato:', err?.message ?? err))
  })
  console.log('🔧 Texnik parvarish scheduler ishga tushdi (har soat, 08:00–18:00 UZT eslatma)')
}
