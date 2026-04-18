import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../lib/prisma'

/**
 * Markaziy Telegram bot — butun SaaS uchun bitta bot.
 *
 * Ulash oqimi:
 *  1. Admin Settings'da "Telegram ulash" bosadi → server TelegramLinkToken yaratadi
 *  2. User https://t.me/<bot>?start=<token> havolasini bosadi
 *  3. Bot `/start <token>` qabul qilib, chatId ni user'ga bog'laydi (TelegramLink)
 *  4. Bir admin bir nechta qurilmada ulashi mumkin — har birida alohida token/deep-link
 *
 * Ogohlantirish yuborish:
 *  - sendToUser(userId, text)         — bitta admin'ning barcha qurilmalariga
 *  - sendToOrgAdmins(orgId, text)     — orgdagi barcha admin/branch_manager'larning hamma qurilmalariga
 */

let bot: TelegramBot | null = null
let botUsername: string | null = null

export function isBotEnabled(): boolean {
  return bot !== null
}

export function getBotUsername(): string | null {
  return botUsername
}

/** Serverga birinchi ishga tushganda chaqiriladi. Token yo'q bo'lsa — bot ishlamaydi (warn). */
export async function initTelegramBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn("ℹ️  TELEGRAM_BOT_TOKEN belgilanmagan — Telegram bot o'chirilgan holatda.")
    return
  }

  try {
    bot = new TelegramBot(token, { polling: true })
    const me = await bot.getMe()
    botUsername = me.username ?? null
    console.log(`✅ Telegram bot ishga tushdi: @${botUsername}`)
    registerHandlers(bot)
  } catch (err: any) {
    console.error('❌ Telegram bot ishga tushmadi:', err?.message ?? err)
    bot = null
  }
}

function registerHandlers(b: TelegramBot) {
  // /start <token> — qurilmani admin'ga bog'lash
  b.onText(/^\/start(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = String(msg.chat.id)
    const token = match?.[1]

    if (!token) {
      await b.sendMessage(chatId,
        '👋 <b>AutoHisob Telegram bot</b>\n\n' +
        "Ulash uchun saytdagi Settings → 'Telegram ulash' bo'limidan havolani oling va shu yerga qayta keling.",
        { parse_mode: 'HTML' })
      return
    }

    try {
      const record = await (prisma as any).telegramLinkToken.findUnique({
        where: { token },
        include: { user: { select: { id: true, fullName: true, role: true } } },
      })

      if (!record) {
        await b.sendMessage(chatId, "❌ Ulash tokeni topilmadi yoki noto'g'ri.")
        return
      }
      if (record.usedAt) {
        await b.sendMessage(chatId, '❌ Bu havola allaqachon ishlatilgan. Sozlamalardan yangi havola oling.')
        return
      }
      if (new Date() > new Date(record.expiresAt)) {
        await b.sendMessage(chatId, "❌ Havola muddati tugagan. Sozlamalardan yangi havola oling.")
        return
      }

      // Shu chatId allaqachon biror userga bog'langanmi?
      const existing = await (prisma as any).telegramLink.findUnique({ where: { chatId } })
      if (existing) {
        if (existing.userId === record.userId) {
          await b.sendMessage(chatId, "ℹ️ Bu qurilma allaqachon shu hisobga ulangan.")
        } else {
          // Eskisini almashtiramiz (bir qurilma 1 account'ga)
          await (prisma as any).telegramLink.update({
            where: { chatId },
            data: { userId: record.userId, lastActiveAt: new Date() },
          })
          await b.sendMessage(chatId, `✅ Qurilma ${record.user.fullName}'ga ulandi (avvalgi hisob olib tashlandi).`)
        }
      } else {
        const firstName = msg.from?.first_name ?? ''
        const lastName = msg.from?.last_name ? ` ${msg.from.last_name}` : ''
        const autoLabel = (firstName + lastName).trim() || null
        await (prisma as any).telegramLink.create({
          data: { userId: record.userId, chatId, deviceLabel: autoLabel, lastActiveAt: new Date() },
        })
        await b.sendMessage(chatId,
          `✅ <b>Ulanish muvaffaqiyatli!</b>\n\n` +
          `Salom, ${record.user.fullName}. AutoHisob ogohlantirishlari shu yerga keladi.\n\n` +
          `Buyruqlar:\n/status — ulangan qurilmalar\n/unlink — ajratish`,
          { parse_mode: 'HTML' })
      }

      await (prisma as any).telegramLinkToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      })
    } catch (err: any) {
      console.error('[TelegramBot] /start xatosi:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Ichki xato. Keyinroq urinib ko\'ring.')
    }
  })

  // /unlink — shu qurilmani ajratish
  b.onText(/^\/unlink$/, async (msg) => {
    const chatId = String(msg.chat.id)
    try {
      const link = await (prisma as any).telegramLink.findUnique({ where: { chatId } })
      if (!link) {
        await b.sendMessage(chatId, 'ℹ️ Bu qurilma hech qaysi hisobga ulanmagan.')
        return
      }
      await (prisma as any).telegramLink.delete({ where: { chatId } })
      await b.sendMessage(chatId, "✅ Ajratildi. Endi bu qurilmaga ogohlantirishlar kelmaydi.")
    } catch (err: any) {
      console.error('[TelegramBot] /unlink xatosi:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Ichki xato.')
    }
  })

  // /status — shu userning barcha ulangan qurilmalari
  b.onText(/^\/status$/, async (msg) => {
    const chatId = String(msg.chat.id)
    try {
      const link = await (prisma as any).telegramLink.findUnique({
        where: { chatId },
        include: { user: { select: { id: true, fullName: true } } },
      })
      if (!link) {
        await b.sendMessage(chatId, 'ℹ️ Bu qurilma ulanmagan. /start <token> orqali ulashingiz mumkin.')
        return
      }
      const allLinks = await (prisma as any).telegramLink.findMany({
        where: { userId: link.userId },
        orderBy: { linkedAt: 'asc' },
      })
      const lines = [
        `👤 <b>${link.user.fullName}</b>`,
        `Ulangan qurilmalar: ${allLinks.length} ta`,
        '',
        ...allLinks.map((l: any, i: number) => {
          const label = l.deviceLabel || 'Qurilma'
          const thisOne = l.chatId === chatId ? ' (shu qurilma)' : ''
          return `${i + 1}. ${label}${thisOne}`
        }),
      ]
      await b.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err: any) {
      console.error('[TelegramBot] /status xatosi:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Ichki xato.')
    }
  })

  b.on('polling_error', (err: any) => {
    console.error('[TelegramBot] polling xatosi:', err?.message ?? err)
  })
}

/** Bitta userning barcha qurilmalariga xabar yuboradi. Xato bo'lsa — jarayonni to'xtatmaydi. */
export async function sendToUser(userId: string, text: string): Promise<number> {
  if (!bot) return 0
  try {
    const links = await (prisma as any).telegramLink.findMany({
      where: { userId },
      select: { chatId: true },
    })
    let sent = 0
    for (const l of links) {
      try {
        await bot.sendMessage(l.chatId, text, { parse_mode: 'HTML' })
        sent++
      } catch (err: any) {
        // Foydalanuvchi botni bloklagan bo'lsa — linkni o'chiramiz
        if (err?.response?.body?.error_code === 403) {
          await (prisma as any).telegramLink.delete({ where: { chatId: l.chatId } }).catch(() => {})
        }
      }
    }
    return sent
  } catch {
    return 0
  }
}

/**
 * Orgdagi foydalanuvchilarga alertType, vehicleId va vehicleBranchId bo'yicha filtrlangan xabar yuboradi.
 * Har bir userning TelegramNotificationPref tekshiriladi:
 *  - alertType o'chirilgan → o'tkaziladi
 *  - branchIds to'ldirilgan va vehicleBranchId unda yo'q → o'tkaziladi
 *  - vehicleIds to'ldirilgan va vehicleId unda yo'q → o'tkaziladi
 *  - pref yo'q → hamma alert yoqilgan
 */
export async function sendToOrgAdminsFiltered(
  orgId: string,
  alertType: string,
  vehicleId: string | null,
  vehicleBranchId: string | null,
  text: string
): Promise<number> {
  if (!bot) return 0
  try {
    const orgBranches = await (prisma.branch as any).findMany({
      where: { OR: [{ organizationId: orgId }, { id: orgId }] },
      select: { id: true },
    })
    const orgBranchIds = orgBranches.map((b: any) => b.id as string)
    if (orgBranchIds.length === 0) return 0

    const users = await prisma.user.findMany({
      where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
      select: { id: true },
    })
    if (users.length === 0) return 0
    const userIds = users.map(u => u.id)

    const prefs = await (prisma as any).telegramNotificationPref.findMany({
      where: { userId: { in: userIds } },
    })
    const prefMap = new Map(prefs.map((p: any) => [p.userId, p]))

    const eligibleUserIds = userIds.filter(userId => {
      const pref = prefMap.get(userId) as any
      if (!pref) return true
      if (pref[alertType] === false) return false
      if (vehicleBranchId && pref.branchIds?.length > 0 && !pref.branchIds.includes(vehicleBranchId)) return false
      if (vehicleId && pref.vehicleIds?.length > 0 && !pref.vehicleIds.includes(vehicleId)) return false
      return true
    })
    if (eligibleUserIds.length === 0) return 0

    const links = await (prisma as any).telegramLink.findMany({
      where: { userId: { in: eligibleUserIds } },
      select: { chatId: true },
    })

    let sent = 0
    for (const l of links) {
      try {
        await bot.sendMessage(l.chatId, text, { parse_mode: 'HTML' })
        sent++
      } catch (err: any) {
        if (err?.response?.body?.error_code === 403) {
          await (prisma as any).telegramLink.delete({ where: { chatId: l.chatId } }).catch(() => {})
        }
      }
    }
    return sent
  } catch (err: any) {
    console.error('[TelegramBot] sendToOrgAdminsFiltered xatosi:', err?.message ?? err)
    return 0
  }
}

/** Orgdagi barcha admin/branch_manager'larning har bir qurilmasiga xabar yuboradi. */
export async function sendToOrgAdmins(orgId: string, text: string): Promise<number> {
  if (!bot) return 0
  try {
    // Org branchlari
    const orgBranches = await (prisma.branch as any).findMany({
      where: { OR: [{ organizationId: orgId }, { id: orgId }] },
      select: { id: true },
    })
    const orgBranchIds = orgBranches.map((b: any) => b.id as string)
    if (orgBranchIds.length === 0) return 0

    // Admin/branch_manager userlar
    const users = await prisma.user.findMany({
      where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
      select: { id: true },
    })
    const userIds = users.map(u => u.id)
    if (userIds.length === 0) return 0

    // Barcha ulangan qurilmalar
    const links = await (prisma as any).telegramLink.findMany({
      where: { userId: { in: userIds } },
      select: { chatId: true },
    })

    let sent = 0
    for (const l of links) {
      try {
        await bot.sendMessage(l.chatId, text, { parse_mode: 'HTML' })
        sent++
      } catch (err: any) {
        if (err?.response?.body?.error_code === 403) {
          await (prisma as any).telegramLink.delete({ where: { chatId: l.chatId } }).catch(() => {})
        }
      }
    }
    return sent
  } catch (err: any) {
    console.error('[TelegramBot] sendToOrgAdmins xatosi:', err?.message ?? err)
    return 0
  }
}
