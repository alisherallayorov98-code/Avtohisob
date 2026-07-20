/**
 * Telegram bot komandalari uchun ma'lumot olish helperlari.
 * Har bir komanda chatId → user → org/branch zanjiri orqali ishlaydi.
 * Multi-tenant izolatsiya: foydalanuvchi faqat o'z tashkilotidagi ma'lumotlarni ko'radi.
 *
 * Bu fayl shuningdek scheduled broadcastlar uchun ham ishlatiladi
 * (kunlik xulosa, haftalik xulosa, tasdiqlash eslatmasi).
 */
import { prisma } from '../lib/prisma'
import { sendToOrgAdminsFiltered } from './telegramBot'
import { formatTrend } from '../lib/weeklySummaryFormat'

export interface UserContext {
  userId: string
  fullName: string
  role: string
  branchId: string | null
  orgId: string | null
  orgBranchIds: string[]
}

/** chatId → UserContext (org branchlari bilan birga). Topilmasa null. */
export async function getUserContextByChat(chatId: string): Promise<UserContext | null> {
  const link = await (prisma as any).telegramLink.findUnique({
    where: { chatId },
    include: { user: { select: { id: true, fullName: true, role: true, branchId: true, isActive: true } } },
  })
  if (!link || !link.user || !link.user.isActive) return null

  const user = link.user
  let orgId: string | null = null
  let orgBranchIds: string[] = []

  if (user.branchId) {
    const branch = await (prisma as any).branch.findUnique({
      where: { id: user.branchId },
      select: { organizationId: true },
    })
    orgId = branch?.organizationId ?? user.branchId
    if (orgId) {
      const branches = await (prisma as any).branch.findMany({
        where: { OR: [{ organizationId: orgId }, { id: orgId }] },
        select: { id: true },
      })
      orgBranchIds = branches.map((b: any) => b.id as string)
      if (!orgBranchIds.includes(user.branchId)) orgBranchIds.push(user.branchId)
    }
  }

  return {
    userId: user.id,
    fullName: user.fullName,
    role: user.role,
    branchId: user.branchId,
    orgId,
    orgBranchIds,
  }
}

function fmtSom(n: number | null | undefined): string {
  if (n == null) return '0 so\'m'
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ') + ' so\'m'
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** /bugun — kechagi kun xulosasi (ta'mir, yoqilg'i, xarajat soni va summa) */
export async function buildTodaySummary(ctx: UserContext): Promise<string> {
  const now = new Date()
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0)
  const yStart = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  // (UZT taqriban: kunni UTC 00:00 bilan ko'rsatamiz, soddalik uchun)

  const where = ctx.orgBranchIds.length > 0
    ? { branchId: { in: ctx.orgBranchIds } }
    : ctx.branchId
      ? { branchId: ctx.branchId }
      : {}

  const vehicleIds = await prisma.vehicle.findMany({
    where, select: { id: true },
  }).then((vs: any[]) => vs.map(v => v.id))

  if (vehicleIds.length === 0) {
    return `📅 <b>Kecha (${fmtDate(yStart)})</b>\n\nMashinalar topilmadi.`
  }

  const [maintCount, maintSum, fuelCount, fuelAgg] = await Promise.all([
    prisma.maintenanceRecord.count({
      where: { vehicleId: { in: vehicleIds }, installationDate: { gte: yStart, lt: start } },
    }),
    prisma.maintenanceRecord.aggregate({
      where: { vehicleId: { in: vehicleIds }, installationDate: { gte: yStart, lt: start } },
      _sum: { cost: true, laborCost: true },
    }),
    prisma.fuelRecord.count({
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: yStart, lt: start } },
    }),
    prisma.fuelRecord.aggregate({
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: yStart, lt: start } },
      _sum: { amountLiters: true, cost: true },
    }),
  ])

  const maintTotal = Number(maintSum._sum?.cost || 0) + Number(maintSum._sum?.laborCost || 0)
  const fuelLitersN = Number(fuelAgg._sum?.amountLiters || 0)
  const fuelTotal = Number(fuelAgg._sum?.cost || 0)

  return [
    `📅 <b>Kecha (${fmtDate(yStart)}) xulosasi</b>`,
    '',
    `🔧 Texnik xizmat: <b>${maintCount}</b> ta — ${fmtSom(maintTotal)}`,
    `⛽ Yoqilg'i: <b>${fuelCount}</b> ta — ${fuelLitersN.toFixed(1)} litr / ${fmtSom(fuelTotal)}`,
    '',
    `<i>Bu xulosa kechagi kun bo'yicha. Bugungi to'liq ma'lumot ertaga keladi.</i>`,
  ].join('\n')
}

/** /muddat — yaqin 30 kun ichida muddati tugaydigan sug'urta/texosmotrlar */
export async function buildExpiringDocs(ctx: UserContext): Promise<string> {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  const where: any = ctx.orgBranchIds.length > 0
    ? { branchId: { in: ctx.orgBranchIds } }
    : ctx.branchId ? { branchId: ctx.branchId } : {}

  const vehicles = await prisma.vehicle.findMany({
    where: {
      ...where,
      status: 'active',
      OR: [
        { insuranceExpiry: { lte: in30, gte: today } },
        { techInspectionExpiry: { lte: in30, gte: today } },
      ],
    },
    select: {
      id: true, brand: true, model: true, registrationNumber: true,
      insuranceExpiry: true, techInspectionExpiry: true,
    },
    take: 30,
  })

  if (vehicles.length === 0) {
    return '✅ <b>Yaqin 30 kun ichida muddati tugaydigan hujjatlar yo\'q.</b>'
  }

  const lines: string[] = ['📋 <b>Yaqin 30 kun ichida muddati tugaydigan hujjatlar</b>', '']

  for (const v of vehicles) {
    const items: string[] = []
    if (v.insuranceExpiry && v.insuranceExpiry <= in30 && v.insuranceExpiry >= today) {
      const days = Math.ceil((v.insuranceExpiry.getTime() - today.getTime()) / 86400000)
      items.push(`🛡 Sug'urta — <b>${days}</b> kun (${fmtDate(v.insuranceExpiry)})`)
    }
    if (v.techInspectionExpiry && v.techInspectionExpiry <= in30 && v.techInspectionExpiry >= today) {
      const days = Math.ceil((v.techInspectionExpiry.getTime() - today.getTime()) / 86400000)
      items.push(`🔧 Texosmotr — <b>${days}</b> kun (${fmtDate(v.techInspectionExpiry)})`)
    }
    if (items.length > 0) {
      lines.push(`🚗 <b>${v.registrationNumber}</b> — ${v.brand} ${v.model}`)
      items.forEach(it => lines.push(`   ${it}`))
    }
  }

  if (lines.length === 2) {
    return '✅ <b>Yaqin 30 kun ichida muddati tugaydigan hujjatlar yo\'q.</b>'
  }
  return lines.join('\n')
}

/** /balans — bu oy umumiy xarajatlar */
export async function buildMonthBalance(ctx: UserContext): Promise<string> {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthName = now.toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })

  const where: any = ctx.orgBranchIds.length > 0
    ? { branchId: { in: ctx.orgBranchIds } }
    : ctx.branchId ? { branchId: ctx.branchId } : {}

  const vehicleIds = await prisma.vehicle.findMany({
    where, select: { id: true },
  }).then((vs: any[]) => vs.map(v => v.id))

  if (vehicleIds.length === 0) {
    return `💰 <b>${monthName}</b>\n\nMashinalar topilmadi.`
  }

  const [maint, fuel] = await Promise.all([
    prisma.maintenanceRecord.aggregate({
      where: { vehicleId: { in: vehicleIds }, installationDate: { gte: monthStart, lte: now } },
      _sum: { cost: true, laborCost: true },
      _count: true,
    }),
    prisma.fuelRecord.aggregate({
      where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: monthStart, lte: now } },
      _sum: { cost: true, amountLiters: true },
      _count: true,
    }),
  ])

  const maintTotal = Number(maint._sum?.cost || 0) + Number(maint._sum?.laborCost || 0)
  const fuelTotal = Number(fuel._sum?.cost || 0)
  const total = maintTotal + fuelTotal
  const maintCnt = (maint as any)._count ?? 0
  const fuelCnt = (fuel as any)._count ?? 0

  return [
    `💰 <b>${monthName} — xarajatlar</b>`,
    '',
    `🔧 Texnik xizmat: ${fmtSom(maintTotal)} <i>(${maintCnt} ta)</i>`,
    `⛽ Yoqilg'i: ${fmtSom(fuelTotal)} <i>(${fuelCnt} ta, ${Number(fuel._sum?.amountLiters || 0).toFixed(0)} litr)</i>`,
    '',
    `<b>JAMI: ${fmtSom(total)}</b>`,
  ].join('\n')
}

/** /kutmoqda — tasdiqlash kutmoqda bo'lgan yozuvlar (faqat admin/manager uchun) */
export async function buildPendingApprovals(ctx: UserContext): Promise<string> {
  const isApprover = ['admin', 'super_admin', 'manager'].includes(ctx.role)
  if (!isApprover) {
    return 'ℹ️ Tasdiqlash kutmoqda bo\'lgan yozuvlar faqat admin/manager uchun.'
  }

  const where: any = ctx.orgBranchIds.length > 0
    ? { vehicle: { branchId: { in: ctx.orgBranchIds } } }
    : ctx.branchId ? { vehicle: { branchId: ctx.branchId } } : {}

  const [maintPending, returnPending] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where: { ...where, status: 'pending_approval' },
      include: { vehicle: { select: { registrationNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    (prisma as any).sparePartReturn.count({
      where: { status: 'pending', ...(ctx.orgBranchIds.length > 0 ? { branchId: { in: ctx.orgBranchIds } } : {}) },
    }).catch(() => 0),
  ])

  if (maintPending.length === 0 && returnPending === 0) {
    return '✅ <b>Tasdiqlash kutmoqda bo\'lgan yozuv yo\'q!</b>'
  }

  const lines: string[] = ['📋 <b>Tasdiqlash kutmoqda</b>', '']

  if (maintPending.length > 0) {
    lines.push(`🔧 <b>Texnik xizmat: ${maintPending.length}</b>${maintPending.length === 10 ? '+ ta' : ' ta'}`)
    maintPending.slice(0, 5).forEach((m: any) => {
      const total = Number(m.cost || 0) + Number(m.laborCost || 0)
      lines.push(`   • ${m.vehicle?.registrationNumber || '—'} — ${fmtSom(total)}`)
    })
    if (maintPending.length > 5) lines.push(`   ... va yana ${maintPending.length - 5} ta`)
    lines.push('')
  }

  if (returnPending > 0) {
    lines.push(`🔁 <b>Ehtiyot qism qaytarish: ${returnPending} ta</b>`)
    lines.push('')
  }

  lines.push('<i>Saytda Texnik xizmat bo\'limidan tasdiqlashingiz mumkin.</i>')
  return lines.join('\n')
}

/** /mashinalar — foydalanuvchining faol mashinalari ro'yxati */
export async function buildVehiclesList(ctx: UserContext): Promise<string> {
  const where: any = ctx.orgBranchIds.length > 0
    ? { branchId: { in: ctx.orgBranchIds } }
    : ctx.branchId ? { branchId: ctx.branchId } : {}

  const vehicles = await prisma.vehicle.findMany({
    where: { ...where, status: 'active' },
    select: {
      id: true, brand: true, model: true, registrationNumber: true,
      mileage: true, insuranceExpiry: true, techInspectionExpiry: true,
    },
    orderBy: { registrationNumber: 'asc' },
    take: 30,
  })

  if (vehicles.length === 0) {
    return '🚗 Faol mashina topilmadi.'
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const lines: string[] = [`🚗 <b>Faol mashinalar (${vehicles.length})</b>`, '']

  vehicles.forEach((v: any, i: number) => {
    const km = Number(v.mileage || 0)
    let warning = ''
    if (v.insuranceExpiry) {
      const days = Math.ceil((new Date(v.insuranceExpiry).getTime() - today.getTime()) / 86400000)
      if (days < 0) warning = ' 🛡⚠'
      else if (days <= 30) warning = ' 🛡⏰'
    }
    if (!warning && v.techInspectionExpiry) {
      const days = Math.ceil((new Date(v.techInspectionExpiry).getTime() - today.getTime()) / 86400000)
      if (days < 0) warning = ' 🔧⚠'
      else if (days <= 30) warning = ' 🔧⏰'
    }
    lines.push(`${i + 1}. <b>${v.registrationNumber}</b>${warning}`)
    lines.push(`   ${v.brand} ${v.model} · ${km.toLocaleString()} km`)
  })

  if (vehicles.length === 30) {
    lines.push('')
    lines.push('<i>Birinchi 30 ta ko\'rsatildi.</i>')
  }
  return lines.join('\n')
}

// ─── SCHEDULED BROADCASTS (cron tomonidan chaqiriladi) ─────────────────────

/** Har tashkilot uchun branch IDlari ro'yxatini topadi */
async function getAllOrgs(): Promise<Array<{ orgId: string; branchIds: string[] }>> {
  const branches = await (prisma as any).branch.findMany({
    select: { id: true, organizationId: true },
  })
  const orgMap = new Map<string, string[]>()
  for (const b of branches) {
    const orgId = b.organizationId ?? b.id
    if (!orgMap.has(orgId)) orgMap.set(orgId, [])
    orgMap.get(orgId)!.push(b.id)
  }
  return Array.from(orgMap.entries()).map(([orgId, branchIds]) => ({ orgId, branchIds }))
}

/** Kunlik xulosa — har kuni 08:00 da org admin/branch_manager'larga jo'natiladi */
export async function broadcastDailySummary(): Promise<void> {
  const orgs = await getAllOrgs()
  const now = new Date()
  const yStart = new Date(now); yStart.setUTCHours(0, 0, 0, 0)
  yStart.setTime(yStart.getTime() - 24 * 60 * 60 * 1000)
  const yEnd = new Date(yStart.getTime() + 24 * 60 * 60 * 1000)
  const yDate = yStart.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' })

  for (const org of orgs) {
    try {
      const vehicleIds = await prisma.vehicle.findMany({
        where: { branchId: { in: org.branchIds } },
        select: { id: true },
      }).then((vs: any[]) => vs.map(v => v.id))
      if (vehicleIds.length === 0) continue

      const [maintCount, maintSum, fuelCount, fuelAgg] = await Promise.all([
        prisma.maintenanceRecord.count({
          where: { vehicleId: { in: vehicleIds }, installationDate: { gte: yStart, lt: yEnd } },
        }),
        prisma.maintenanceRecord.aggregate({
          where: { vehicleId: { in: vehicleIds }, installationDate: { gte: yStart, lt: yEnd } },
          _sum: { cost: true, laborCost: true },
        }),
        prisma.fuelRecord.count({
          where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: yStart, lt: yEnd } },
        }),
        prisma.fuelRecord.aggregate({
          where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: yStart, lt: yEnd } },
          _sum: { amountLiters: true, cost: true },
        }),
      ])

      // Hech qanday faollik bo'lmasa, xabar yubormaymiz
      if (maintCount === 0 && fuelCount === 0) continue

      const maintTotal = Number(maintSum._sum?.cost || 0) + Number(maintSum._sum?.laborCost || 0)
      const fuelLitersN = Number(fuelAgg._sum?.amountLiters || 0)
      const fuelTotal = Number(fuelAgg._sum?.cost || 0)

      const text = [
        `📅 <b>Kechagi (${yDate}) xulosa</b>`,
        '',
        `🔧 Texnik xizmat: <b>${maintCount}</b> ta — ${fmtSom(maintTotal)}`,
        `⛽ Yoqilg'i: <b>${fuelCount}</b> ta — ${fuelLitersN.toFixed(1)} litr / ${fmtSom(fuelTotal)}`,
        '',
        `<i>/balans — bu oy umumiy</i>`,
      ].join('\n')

      await sendToOrgAdminsFiltered(org.orgId, 'dailySummary', null, null, text)
    } catch (err: any) {
      console.error(`[Telegram] Daily summary org=${org.orgId}:`, err?.message)
    }
  }
}

/** Haftalik xulosa — har dushanba 08:00 da */
export async function broadcastWeeklySummary(): Promise<void> {
  const orgs = await getAllOrgs()
  const now = new Date()
  const wkEnd = new Date(now); wkEnd.setUTCHours(0, 0, 0, 0)
  const wkStart = new Date(wkEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
  const prevStart = new Date(wkStart.getTime() - 7 * 24 * 60 * 60 * 1000) // o'tgan hafta (taqqoslash uchun)
  const dateRange = `${fmtDate(wkStart)} — ${fmtDate(new Date(wkEnd.getTime() - 86400000))}`
  // "Diqqat talab qiladi" bo'limi uchun — 14 kun ichida tugaydigan hujjatlar
  const in14Days = new Date(wkEnd.getTime() + 14 * 24 * 60 * 60 * 1000)

  for (const org of orgs) {
    try {
      const vehicleIds = await prisma.vehicle.findMany({
        where: { branchId: { in: org.branchIds } },
        select: { id: true },
      }).then((vs: any[]) => vs.map(v => v.id))
      if (vehicleIds.length === 0) continue

      const [maint, fuel, prevMaint, prevFuel, overdueService, expiringDocs] = await Promise.all([
        prisma.maintenanceRecord.aggregate({
          where: { vehicleId: { in: vehicleIds }, installationDate: { gte: wkStart, lt: wkEnd } },
          _sum: { cost: true, laborCost: true },
          _count: true,
        }),
        prisma.fuelRecord.aggregate({
          where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: wkStart, lt: wkEnd } },
          _sum: { amountLiters: true, cost: true },
          _count: true,
        }),
        // O'tgan hafta (taqqoslash uchun — faqat summalar)
        prisma.maintenanceRecord.aggregate({
          where: { vehicleId: { in: vehicleIds }, installationDate: { gte: prevStart, lt: wkStart } },
          _sum: { cost: true, laborCost: true },
        }),
        prisma.fuelRecord.aggregate({
          where: { vehicleId: { in: vehicleIds }, refuelDate: { gte: prevStart, lt: wkStart } },
          _sum: { cost: true },
        }),
        // Diqqat: muddati o'tgan xizmatlar (moy/filtr) soni
        (prisma as any).serviceInterval.count({
          where: { vehicleId: { in: vehicleIds }, status: 'overdue' },
        }),
        // Diqqat: 14 kun ichida tugaydigan sug'urta/texosmotr soni
        prisma.vehicle.count({
          where: {
            id: { in: vehicleIds }, status: 'active',
            OR: [
              { insuranceExpiry: { lte: in14Days, gte: wkEnd } },
              { techInspectionExpiry: { lte: in14Days, gte: wkEnd } },
            ],
          },
        }),
      ])

      const maintCnt = (maint as any)._count ?? 0
      const fuelCnt = (fuel as any)._count ?? 0
      const attentionCount = overdueService + expiringDocs
      // Harakat kerak bo'lmasa VA hafta bo'sh bo'lsa — yubormaymiz (shovqin qilmaymiz)
      if (maintCnt === 0 && fuelCnt === 0 && attentionCount === 0) continue

      const maintTotal = Number(maint._sum?.cost || 0) + Number(maint._sum?.laborCost || 0)
      const fuelTotal = Number(fuel._sum?.cost || 0)
      const fuelLiters = Number(fuel._sum?.amountLiters || 0)
      const total = maintTotal + fuelTotal

      const prevTotal = Number(prevMaint._sum?.cost || 0) + Number(prevMaint._sum?.laborCost || 0)
        + Number(prevFuel._sum?.cost || 0)
      const trend = formatTrend(total, prevTotal)

      const lines = [
        `📊 <b>Haftalik xulosa</b>`,
        `<i>${dateRange}</i>`,
        '',
        `🔧 Texnik xizmat: <b>${maintCnt}</b> ta — ${fmtSom(maintTotal)}`,
        `⛽ Yoqilg'i: <b>${fuelCnt}</b> ta — ${fuelLiters.toFixed(0)} litr / ${fmtSom(fuelTotal)}`,
        '',
        `<b>JAMI xarajat: ${fmtSom(total)}</b>`,
      ]
      if (trend) lines.push(`<i>${trend}</i>`)

      // "Diqqat talab qiladi" — faqat harakat kerak bo'lganda ko'rsatiladi
      if (attentionCount > 0) {
        lines.push('', '⚠️ <b>Diqqat talab qiladi:</b>')
        if (overdueService > 0) lines.push(`• Moy/filtr muddati o'tgan: <b>${overdueService}</b> ta mashina`)
        if (expiringDocs > 0) lines.push(`• 14 kun ichida hujjat tugaydi: <b>${expiringDocs}</b> ta mashina`)
      }

      await sendToOrgAdminsFiltered(org.orgId, 'weeklySummary', null, null, lines.join('\n'))
    } catch (err: any) {
      console.error(`[Telegram] Weekly summary org=${org.orgId}:`, err?.message)
    }
  }
}

/** Tasdiqlash kutmoqda eslatmasi — har kuni 09:00 da */
export async function broadcastPendingApprovals(): Promise<void> {
  const orgs = await getAllOrgs()

  for (const org of orgs) {
    try {
      const pendingCount = await prisma.maintenanceRecord.count({
        where: {
          status: 'pending_approval',
          vehicle: { branchId: { in: org.branchIds } },
        },
      })
      if (pendingCount === 0) continue

      const text = [
        `🔔 <b>Tasdiqlashga kutmoqda: ${pendingCount} ta texnik xizmat</b>`,
        '',
        `Saytda <i>Texnik xizmat</i> bo'limidan tasdiqlashingiz mumkin.`,
        `/kutmoqda — batafsil ro'yxat`,
      ].join('\n')

      await sendToOrgAdminsFiltered(org.orgId, 'pendingApproval', null, null, text)
    } catch (err: any) {
      console.error(`[Telegram] Pending approvals org=${org.orgId}:`, err?.message)
    }
  }
}
