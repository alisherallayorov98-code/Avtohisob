import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { sendCareMessage } from './careBot'
import { sendToUser } from './telegramBot'

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

// Date|string -> 'YYYY-MM-DD'
function ds(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

// Bitta mashina uchun bugun belgilangan vazifalar bo'yicha yozuv ochadi (yo'q bo'lsa).
// Bot (rasm yuborilganda) va nazorat paneli darrov ko'rsatishi uchun ishlatiladi.
export async function ensureSubmissionsForVehicle(vehicleId: string): Promise<void> {
  const now = uzNow()
  const weekday = now.getUTCDay()
  const today = uzDateOnly(now)
  const vehicle = await (prisma as any).vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, branchId: true, mileage: true, branch: { select: { organizationId: true } } },
  })
  const orgId = vehicle?.branch?.organizationId
  if (!orgId) return
  const currentKm = Number(vehicle.mileage || 0)
  const driver = await (prisma as any).vehicleCareDriver.findUnique({ where: { vehicleId } })
  const tasks = await (prisma as any).vehicleCareTask.findMany({ where: { organizationId: orgId, isActive: true } })
  for (const task of tasks) {
    if (task.scope === 'branch' && task.branchId !== vehicle.branchId) continue
    if (task.scope === 'vehicles' && !(task.vehicleIds || []).includes(vehicleId)) continue

    if (task.triggerType === 'mileage') {
      const interval = Number(task.intervalKm || 0)
      if (interval <= 0) continue
      // Holat (oxirgi bajarilgan/boshlang'ich km). Birinchi marta — joriy km'dan boshlanadi.
      let state = await (prisma as any).vehicleCareMileageState.findUnique({
        where: { taskId_vehicleId: { taskId: task.id, vehicleId } },
      })
      if (!state) {
        state = await (prisma as any).vehicleCareMileageState.create({
          data: { taskId: task.id, vehicleId, lastKm: currentKm },
        })
        continue // birinchi marta — retroaktiv triggermaymiz
      }
      if (currentKm - Number(state.lastKm) >= interval) {
        // Allaqachon ochiq (bajarilmagan) yozuv bo'lsa — yangisini ochmaymiz
        const open = await (prisma as any).vehicleCareSubmission.findFirst({
          where: { taskId: task.id, vehicleId, status: { notIn: ['done', 'skipped'] } },
        })
        if (!open) {
          await (prisma as any).vehicleCareSubmission.create({
            data: {
              organizationId: orgId, taskId: task.id, vehicleId, dueDate: today,
              status: 'pending', driverChatId: driver?.chatId ?? null, triggerKm: currentKm,
            },
          }).catch(() => {}) // unique (kun) — bir kunda ikki marta ochilmasin
        }
      }
      continue
    }

    // weekly
    if (!Array.isArray(task.weekdays) || !task.weekdays.includes(weekday)) continue
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
  const today = uzDateOnly(now)

  // 1) Yozuvlarni ochamiz — har haydovchili mashina uchun (weekly bugun + mileage interval)
  const tasks = await (prisma as any).vehicleCareTask.findMany({ where: { isActive: true } })
  const drivers = await (prisma as any).vehicleCareDriver.findMany({ select: { vehicleId: true } })
  for (const d of drivers) {
    await ensureSubmissionsForVehicle(d.vehicleId).catch(() => {})
  }

  // 2) Ish vaqti (08:00–18:00) — har haydovchiga BITTA xabar (hamma vazifa ro'yxati)
  //    (bugungi + kechikkanlar; skip qilinganlar chiqarib tashlanadi)
  if (hour >= 8 && hour <= 18) {
    const pendings = await (prisma as any).vehicleCareSubmission.findMany({
      where: { dueDate: { lte: today }, status: { notIn: ['done', 'skipped'] }, driverChatId: { not: null } },
      orderBy: { dueDate: 'asc' },
    })
    // Haydovchi (chatId) bo'yicha guruhlaymiz
    const byChat: Record<string, any[]> = {}
    for (const s of pendings) {
      if (!tasks.find((t: any) => t.id === s.taskId)) continue // o'chirilgan vazifa
      ;(byChat[s.driverChatId] ||= []).push(s)
    }
    // Mashina raqamlari
    const vIds = [...new Set(pendings.map((s: any) => s.vehicleId))]
    const vehicles = vIds.length ? await (prisma as any).vehicle.findMany({
      where: { id: { in: vIds } }, select: { id: true, registrationNumber: true },
    }) : []
    const regMap: Record<string, string> = Object.fromEntries(vehicles.map((v: any) => [v.id, v.registrationNumber]))

    for (const [chatId, subs] of Object.entries(byChat)) {
      const lines = subs.map((s: any) => {
        const task = tasks.find((t: any) => t.id === s.taskId)
        const overdue = new Date(s.dueDate).getTime() < today.getTime()
        const reg = regMap[s.vehicleId] || ''
        return `• ${reg} — ${task?.name || 'Vazifa'}${overdue ? ` ⚠️(kechikkan ${ds(s.dueDate)})` : ''}`
      })
      const text =
        `🔧 <b>Texnik parvarish — bajarilmagan vazifalar (${subs.length}):</b>\n\n` +
        lines.join('\n') +
        `\n\nHar biri uchun shu yerga <b>rasm yoki video</b> yuboring. Bajarilmaguncha eslatib turaman.`
      const ok = await sendCareMessage(chatId, text)
      if (ok) {
        await (prisma as any).vehicleCareSubmission.updateMany({
          where: { id: { in: subs.map((s: any) => s.id) } },
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

// Kunlik xulosa: org admin -> butun tashkilot; filial boshlig'i -> faqat o'z filiali
async function sendCareDailySummary(today: Date): Promise<void> {
  const activeTasks = await (prisma as any).vehicleCareTask.findMany({
    where: { isActive: true }, select: { organizationId: true },
  })
  const orgIds = [...new Set(activeTasks.map((t: any) => t.organizationId))] as string[]

  for (const orgId of orgIds) {
    const todaySubs = await (prisma as any).vehicleCareSubmission.findMany({
      where: { organizationId: orgId, dueDate: today, status: { not: 'skipped' } },
    })
    const overdue = await (prisma as any).vehicleCareSubmission.findMany({
      where: { organizationId: orgId, dueDate: { lt: today }, status: { notIn: ['done', 'skipped'] } },
      orderBy: { dueDate: 'asc' },
    })
    if (todaySubs.length === 0 && overdue.length === 0) continue

    // Tegishli mashinalarning raqami + filiali
    const vIds = [...new Set([...todaySubs, ...overdue].map((s: any) => s.vehicleId))]
    const vehicles = await (prisma as any).vehicle.findMany({
      where: { id: { in: vIds } }, select: { id: true, registrationNumber: true, branchId: true },
    })
    const vMap: Record<string, any> = Object.fromEntries(vehicles.map((v: any) => [v.id, v]))

    // Org branchlari
    const orgBranches = await (prisma as any).branch.findMany({
      where: { OR: [{ organizationId: orgId }, { id: orgId }] }, select: { id: true },
    })
    const orgBranchIds = orgBranches.map((b: any) => b.id)

    // Xulosa matnini quradi (branchId berilsa — faqat shu filial)
    const build = (branchId: string | null): string | null => {
      const inScope = (s: any) => branchId ? vMap[s.vehicleId]?.branchId === branchId : true
      const tday = todaySubs.filter(inScope)
      const odue = overdue.filter(inScope)
      if (tday.length === 0 && odue.length === 0) return null
      const doneToday = tday.filter((s: any) => s.status === 'done').length
      const notDone = tday.filter((s: any) => s.status !== 'done')
      let text = `🔧 <b>Texnik parvarish — kunlik xulosa</b>\n📅 ${ds(today)}\n\n`
      text += `✅ Bugun bajardi: <b>${doneToday}</b> / ${tday.length}`
      if (notDone.length) {
        text += `\n\n⏳ <b>Bugun bajarmaganlar (${notDone.length}):</b>\n`
        text += notDone.slice(0, 25).map((s: any) => `• ${vMap[s.vehicleId]?.registrationNumber || '—'}`).join('\n')
        if (notDone.length > 25) text += `\n…va yana ${notDone.length - 25} ta`
      }
      if (odue.length) {
        text += `\n\n🔴 <b>Kechikkan — hali bajarilmagan (${odue.length}):</b>\n`
        text += odue.slice(0, 25).map((s: any) => {
          const days = Math.max(1, Math.round((today.getTime() - new Date(s.dueDate).getTime()) / 86400000))
          return `• ${vMap[s.vehicleId]?.registrationNumber || '—'} — ${days} kun`
        }).join('\n')
        if (odue.length > 25) text += `\n…va yana ${odue.length - 25} ta`
      }
      return text
    }

    const orgText = build(null)

    // Foydalanuvchilar: admin -> butun org; branch_manager -> o'z filiali
    const users = await (prisma as any).user.findMany({
      where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
      select: { id: true, role: true, branchId: true },
    })
    for (const u of users) {
      const text = u.role === 'admin' ? orgText : build(u.branchId)
      if (text) await sendToUser(u.id, text)
    }
  }
}

export function startCareScheduler(): void {
  // Har soatning boshida (xx:00) — UZT ichkarida hisoblanadi
  cron.schedule('0 * * * *', () => {
    runCareReminders().catch((err) => console.error('[CareScheduler] xato:', err?.message ?? err))
  })
  console.log('🔧 Texnik parvarish scheduler ishga tushdi (har soat, 08:00–18:00 UZT eslatma)')
}
