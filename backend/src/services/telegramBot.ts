import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../lib/prisma'
import fs from 'fs'
import path from 'path'
import https from 'https'
import crypto from 'crypto'
import {
  getUserContextByChat,
  buildTodaySummary,
  buildExpiringDocs,
  buildMonthBalance,
  buildPendingApprovals,
  buildVehiclesList,
} from './telegramCommands'

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
        "Ulash uchun saytdagi <b>Settings → 'Telegram ulash'</b> bo'limidan havolani oling va shu yerga qayta keling.\n\n" +
        '/help — barcha buyruqlar ro\'yxati',
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

  // /help — barcha komandalar ro'yxati
  b.onText(/^\/help$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const helpText = [
      '🤖 <b>AutoHisob Bot — buyruqlar</b>',
      '',
      '<b>Asosiy:</b>',
      '/start &lt;token&gt; — qurilmani saytga ulash',
      '/status — ulangan qurilmalar ro\'yxati',
      '/unlink — bu qurilmani ajratish',
      '/help — shu yo\'l-yo\'riq',
      '',
      '<b>Ma\'lumot olish:</b>',
      '/bugun — kechagi kun xulosasi',
      '/muddat — yaqin 30 kun ichida muddati tugaydigan hujjatlar',
      '/balans — bu oy umumiy xarajatlar',
      '/kutmoqda — tasdiqlashga kutmoqda bo\'lgan ta\'mirlar',
      '/mashinalar — sizning faol mashinalaringiz',
      '',
      '<b>Foto-otchet:</b>',
      'Saytdan kodni ko\'chirib, bot ga rasm yuboring va kodni yozing — texnik xizmatga rasm biriktiriladi.',
    ].join('\n')
    await b.sendMessage(chatId, helpText, { parse_mode: 'HTML' })
  })

  // ── Ma'lumot olish komandalari ─────────────────────────────────────────────
  // Har biri: chatId → user kontekstini topadi → tegishli ma'lumotni qaytaradi
  // Ulanmagan chatlarda — ulashga taklif beradi.

  async function handleInfoCommand(
    chatId: string,
    builder: (ctx: any) => Promise<string>
  ) {
    try {
      const ctx = await getUserContextByChat(chatId)
      if (!ctx) {
        await b.sendMessage(chatId,
          'ℹ️ Bu qurilma hisobga ulanmagan.\n\nSaytdan havola olib /start &lt;token&gt; orqali ulang yoki /help.',
          { parse_mode: 'HTML' })
        return
      }
      const text = await builder(ctx)
      await b.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true } as any)
    } catch (err: any) {
      console.error('[TelegramBot] info command xatosi:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Ma\'lumot olib bo\'lmadi. Keyinroq urinib ko\'ring.')
    }
  }

  b.onText(/^\/bugun$/, (msg) => handleInfoCommand(String(msg.chat.id), buildTodaySummary))
  b.onText(/^\/muddat$/, (msg) => handleInfoCommand(String(msg.chat.id), buildExpiringDocs))
  b.onText(/^\/balans$/, (msg) => handleInfoCommand(String(msg.chat.id), buildMonthBalance))
  b.onText(/^\/kutmoqda$/, (msg) => handleInfoCommand(String(msg.chat.id), buildPendingApprovals))
  b.onText(/^\/mashinalar$/, (msg) => handleInfoCommand(String(msg.chat.id), buildVehiclesList))

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

  // ── Evidence OTP: foto qabul qilish ─────────────────────────────────────────
  // chatId → { fileId, receivedAt } — 10 daqiqa saqlanadi
  const pendingPhotos = new Map<string, { fileId: string; receivedAt: number }>()

  // Brute-force himoyasi: bir chatId uchun OTP urinishlar soni va sekin urinish lockout
  // Limit: 10 daqiqada 5 ta noto'g'ri urinish → 30 daqiqa lockout
  const otpAttempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>()
  const OTP_MAX_ATTEMPTS = 5
  const OTP_WINDOW_MS = 10 * 60 * 1000
  const OTP_LOCKOUT_MS = 30 * 60 * 1000

  b.on('photo', async (msg) => {
    const chatId = String(msg.chat.id)
    // Eng yuqori sifatli foto (oxirgi element)
    const photo = msg.photo?.[msg.photo.length - 1]
    if (!photo) return
    pendingPhotos.set(chatId, { fileId: photo.file_id, receivedAt: Date.now() })
    await b.sendMessage(chatId,
      '📷 Rasm qabul qilindi!\n\n<b>Saytda ko\'rsatilgan 6 xonali kodni yozing:</b>',
      { parse_mode: 'HTML' })
  })

  b.on('message', async (msg) => {
    const chatId = String(msg.chat.id)
    const text = msg.text?.trim()
    if (!text || !/^\d{6}$/.test(text)) return // faqat 6 xonali raqam

    const pending = pendingPhotos.get(chatId)
    if (!pending) {
      await b.sendMessage(chatId, "❌ Avval rasm yuboring, so'ng kodni kiriting.")
      return
    }
    if (Date.now() - pending.receivedAt > 12 * 60 * 1000) {
      pendingPhotos.delete(chatId)
      await b.sendMessage(chatId, '❌ Rasm eskirdi. Iltimos qaytadan yuboring.')
      return
    }

    // Brute-force lockout tekshiruvi
    const now = Date.now()
    const att = otpAttempts.get(chatId)
    if (att && att.lockedUntil > now) {
      const minutesLeft = Math.ceil((att.lockedUntil - now) / 60000)
      await b.sendMessage(chatId, `❌ Juda ko'p noto'g'ri urinish. ${minutesLeft} daqiqadan keyin urinib ko'ring.`)
      return
    }

    try {
      // Cross-org himoya: faqat shu chat ulangan foydalanuvchining
      // o'zi yaratgan yozuvi uchun OTP qabul qilinadi.
      const link = await (prisma as any).telegramLink.findUnique({
        where: { chatId },
        select: { userId: true },
      })
      if (!link) {
        await b.sendMessage(chatId,
          'ℹ️ Bu qurilma hisobga ulanmagan. Avval saytdan havola olib /start <token> bilan ulang.',
          { parse_mode: 'HTML' })
        return
      }

      const record = await (prisma as any).maintenanceRecord.findFirst({
        where: {
          evidenceOtpCode: text,
          evidenceOtpExpiry: { gt: new Date() },
          performedById: link.userId,
        },
        select: { id: true, evidenceOtpCode: true },
      })
      if (!record) {
        // Noto'g'ri urinish — counter
        const cur = otpAttempts.get(chatId)
        if (!cur || (now - cur.firstAt) > OTP_WINDOW_MS) {
          otpAttempts.set(chatId, { count: 1, firstAt: now, lockedUntil: 0 })
        } else {
          cur.count += 1
          if (cur.count >= OTP_MAX_ATTEMPTS) {
            cur.lockedUntil = now + OTP_LOCKOUT_MS
          }
          otpAttempts.set(chatId, cur)
        }
        const updated = otpAttempts.get(chatId)!
        if (updated.lockedUntil > now) {
          await b.sendMessage(chatId, `❌ Juda ko'p noto'g'ri urinish. 30 daqiqaga bloklandi.`)
        } else {
          const left = OTP_MAX_ATTEMPTS - updated.count
          await b.sendMessage(chatId, `❌ Kod noto'g'ri yoki sizning yozuvingiz emas. ${left} ta urinish qoldi.`)
        }
        return
      }
      // Muvaffaqiyatli urinish — counter ni tozalash
      otpAttempts.delete(chatId)

      // Fotoyu yuklab olish va saqlash
      const fileLink = await b.getFileLink(pending.fileId)
      const month = new Date().toISOString().slice(0, 7)
      const evidenceDir = path.join(process.cwd(), 'uploads', 'maintenance-evidence', month)
      if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true })
      const fileName = `${crypto.randomBytes(16).toString('hex')}.jpg`
      const filePath = path.join(evidenceDir, fileName)

      await new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(filePath)
        https.get(fileLink, (res) => {
          res.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      })

      const stat = fs.statSync(filePath)
      const fileUrl = `/uploads/maintenance-evidence/${month}/${fileName}`

      await (prisma as any).maintenanceEvidence.create({
        data: { maintenanceId: record.id, fileUrl, fileSizeBytes: stat.size },
      })

      // OTP ni tozalash
      await (prisma as any).maintenanceRecord.update({
        where: { id: record.id },
        data: { evidenceOtpCode: null, evidenceOtpExpiry: null },
      })

      pendingPhotos.delete(chatId)
      await b.sendMessage(chatId, '✅ Rasm muvaffaqiyatli biriktirildi! Admin tekshiradi.')
    } catch (err: any) {
      console.error('[TelegramBot] OTP evidence xatosi:', err?.message)
      await b.sendMessage(chatId, '❌ Xato yuz berdi. Qaytadan urinib ko\'ring.')
    }
  })

  b.on('polling_error', (err: any) => {
    console.error('[TelegramBot] polling xatosi:', err?.message ?? err)
  })
}

/** Bitta userning barcha qurilmalariga xabar yuboradi. Xato bo'lsa — jarayonni to'xtatmaydi. */
// Foydalanuvchining afzal ko'rgan tiliga moslab matnni transliteratsiya qiladi.
// uz-cyrl → kirillga; boshqalar (uz, ru, zh) → o'zgartirilmaydi
// (RU/ZH uchun keyinchalik tarjima lug'ati qo'shiladi).
async function localizeForUser(userId: string, text: string): Promise<string> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLanguage: true } as any,
    }) as any
    const lang = user?.preferredLanguage || 'uz'
    if (lang === 'uz-cyrl') {
      // Lazy import — circular dependency oldini olish uchun
      const { latinToCyrillic } = await import('../lib/transliterate')
      return latinToCyrillic(text)
    }
    return text
  } catch {
    return text
  }
}

export async function sendToUser(userId: string, text: string): Promise<number> {
  if (!bot) return 0
  try {
    const links = await (prisma as any).telegramLink.findMany({
      where: { userId },
      select: { chatId: true },
    })
    if (links.length === 0) return 0

    // Foydalanuvchi tiliga moslashtirilgan matn
    const localizedText = await localizeForUser(userId, text)

    let sent = 0
    for (const l of links) {
      try {
        await bot.sendMessage(l.chatId, localizedText, { parse_mode: 'HTML' })
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

// Hozirgi UZT soati (UTC + 5)
function currentUztHour(): number {
  const utcHour = new Date().getUTCHours()
  return (utcHour + 5) % 24
}

// Quiet hours tekshiruvi: hozirgi soat oralig'idami?
// Misol: quietStart=22, quietEnd=7 → 22:00-06:59 oralig'ida xabar yuborilmaydi
function isQuietNow(quietStart: number | null, quietEnd: number | null): boolean {
  if (quietStart == null || quietEnd == null) return false
  const h = currentUztHour()
  // Tunda kechib o'tadigan oraliq (masalan 22 → 7)
  if (quietStart > quietEnd) return h >= quietStart || h < quietEnd
  // Bir kun ichidagi oraliq (masalan 13 → 14)
  return h >= quietStart && h < quietEnd
}

// Dedup: 24 soat ichida bir xil userId+alertType+targetKey juftligi yuborilganmi?
async function shouldSkipDuplicate(userId: string, alertType: string, targetKey: string | null): Promise<boolean> {
  if (!targetKey) return false // targetKey yo'q bo'lsa dedup ishlatmaymiz
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const existing = await (prisma as any).telegramAlertDedupe.findUnique({
    where: { userId_alertType_targetKey: { userId, alertType, targetKey } },
  })
  if (!existing) return false
  if (new Date(existing.sentAt) < since) {
    // 24 soatdan eski — yangilash uchun upsert qaytaramiz (false = yuborish)
    return false
  }
  return true // 24 soat ichida yuborilgan
}

async function recordDedupe(userId: string, alertType: string, targetKey: string | null) {
  if (!targetKey) return
  await (prisma as any).telegramAlertDedupe.upsert({
    where: { userId_alertType_targetKey: { userId, alertType, targetKey } },
    create: { userId, alertType, targetKey },
    update: { sentAt: new Date() },
  }).catch(() => {})
}

/**
 * Orgdagi foydalanuvchilarga alertType, vehicleId va vehicleBranchId bo'yicha filtrlangan xabar yuboradi.
 * Har bir userning TelegramNotificationPref tekshiriladi:
 *  - alertType o'chirilgan → o'tkaziladi
 *  - branchIds to'ldirilgan va vehicleBranchId unda yo'q → o'tkaziladi
 *  - vehicleIds to'ldirilgan va vehicleId unda yo'q → o'tkaziladi
 *  - quietStart/quietEnd diapazonida — o'tkaziladi
 *  - 24 soat ichida bir xil alert yuborilgan bo'lsa — o'tkaziladi (anti-spam)
 *  - pref yo'q → hamma alert yoqilgan, quiet hours yo'q
 *
 * deepLink — agar berilsa, "Saytda ochish" tugmasi qo'shiladi.
 */
export async function sendToOrgAdminsFiltered(
  orgId: string,
  alertType: string,
  vehicleId: string | null,
  vehicleBranchId: string | null,
  text: string,
  deepLink?: string
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

    const eligibleUserIds: string[] = []
    for (const userId of userIds) {
      const pref = prefMap.get(userId) as any
      if (pref) {
        if (pref[alertType] === false) continue
        if (vehicleBranchId && pref.branchIds?.length > 0 && !pref.branchIds.includes(vehicleBranchId)) continue
        if (vehicleId && pref.vehicleIds?.length > 0 && !pref.vehicleIds.includes(vehicleId)) continue
        if (isQuietNow(pref.quietStart, pref.quietEnd)) continue
      }
      // Anti-spam: 24 soat ichida bir xil alert yuborilganmi?
      const dedupKey = vehicleId || null
      if (dedupKey && await shouldSkipDuplicate(userId, alertType, dedupKey)) continue
      eligibleUserIds.push(userId)
    }
    if (eligibleUserIds.length === 0) return 0

    const links = await (prisma as any).telegramLink.findMany({
      where: { userId: { in: eligibleUserIds } },
      select: { userId: true, chatId: true },
    })

    // Foydalanuvchilarning afzal ko'rgan tilini bir marta yuklab olamiz —
    // har bir Telegram link uchun N+1 query'ni oldini olamiz.
    const userLangs = await prisma.user.findMany({
      where: { id: { in: eligibleUserIds } },
      select: { id: true, preferredLanguage: true } as any,
    }) as any[]
    const langMap = new Map<string, string>(userLangs.map((u: any) => [u.id, u.preferredLanguage || 'uz']))
    // Lazy import to avoid heavyweight transliterator import at module-load time.
    const { latinToCyrillic } = await import('../lib/transliterate')

    const replyMarkup = deepLink ? {
      inline_keyboard: [[{ text: '🔗 Saytda ochish', url: deepLink }]],
    } : undefined

    let sent = 0
    const sentToUsers = new Set<string>()
    for (const l of links) {
      try {
        // Har bir userga o'z tiliga moslashtirilgan matn
        const lang = langMap.get(l.userId) || 'uz'
        const localizedText = lang === 'uz-cyrl' ? latinToCyrillic(text) : text
        await bot.sendMessage(l.chatId, localizedText, {
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        } as any)
        sent++
        sentToUsers.add(l.userId)
      } catch (err: any) {
        if (err?.response?.body?.error_code === 403) {
          await (prisma as any).telegramLink.delete({ where: { chatId: l.chatId } }).catch(() => {})
        }
      }
    }

    // Anti-spam: muvaffaqiyatli yuborilganlarni qayd qilamiz
    if (vehicleId) {
      for (const uId of sentToUsers) {
        await recordDedupe(uId, alertType, vehicleId)
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

    // Admin/branch_manager userlar (preferredLanguage bilan birga)
    const users = await prisma.user.findMany({
      where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
      select: { id: true, preferredLanguage: true } as any,
    }) as any[]
    if (users.length === 0) return 0

    const langMap = new Map<string, string>(users.map((u: any) => [u.id, u.preferredLanguage || 'uz']))

    // Barcha ulangan qurilmalar
    const links = await (prisma as any).telegramLink.findMany({
      where: { userId: { in: users.map((u: any) => u.id) } },
      select: { userId: true, chatId: true },
    })

    const { latinToCyrillic } = await import('../lib/transliterate')

    let sent = 0
    for (const l of links) {
      try {
        const lang = langMap.get(l.userId) || 'uz'
        const localizedText = lang === 'uz-cyrl' ? latinToCyrillic(text) : text
        await bot.sendMessage(l.chatId, localizedText, { parse_mode: 'HTML' })
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
