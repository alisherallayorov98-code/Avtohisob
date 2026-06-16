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

// ── Reply Keyboard ────────────────────────────────────────────────────────────
const TMA_URL = process.env.FRONTEND_URL
  ? `${process.env.FRONTEND_URL}/tma`
  : 'https://avtohisob.uz/tma'

function getMainKeyboard() {
  return {
    keyboard: [
      [
        { text: '📱 Mini ilova', web_app: { url: TMA_URL } },
        { text: '📊 Bugungi xulosa' },
      ],
      [
        { text: '⏳ Kutayotganlar' },
        { text: '🚗 Mashinalarim' },
      ],
      [
        { text: '📷 Rasm yuklash' },
        { text: '🎥 Dumaloq video' },
      ],
      [
        { text: '📅 Muddatlar' },
        { text: '💰 Balans' },
      ],
    ],
    resize_keyboard: true,
    persistent: true,
  }
}

// Ulanmagan foydalanuvchiga keyboard ko'rinmasin
function getUnlinkedKeyboard() {
  return {
    keyboard: [[{ text: '❓ Yordam' }]],
    resize_keyboard: true,
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
        "Ulash uchun saytdagi <b>Settings → 'Telegram ulash'</b> bo'limidan havolani oling va shu yerga qayta keling.",
        { parse_mode: 'HTML', reply_markup: getUnlinkedKeyboard() } as any)
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
          `Salom, ${record.user.fullName}! 👋\n` +
          `AutoHisob ogohlantirishlari shu yerga keladi.\n\n` +
          `Pastdagi tugmalardan foydalaning ⬇️`,
          { parse_mode: 'HTML', reply_markup: getMainKeyboard() } as any)
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

  // /help — yo'l-yo'riq
  b.onText(/^\/help$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const helpText = [
      '🤖 <b>AutoHisob Bot</b>',
      '',
      'Pastki <b>tugmalar</b> orqali barchasiga kirishingiz mumkin.',
      'Tugmalar ko\'rinmasa — /menu yozing.',
      '',
      '<b>Komandalar:</b>',
      '/menu — tugmalar klaviaturasini ko\'rsatish',
      '/status — ulangan qurilmalar',
      '/unlink — bu qurilmani ajratish',
      '/app — Mini ilovani ochish',
    ].join('\n')
    await b.sendMessage(chatId, helpText, { parse_mode: 'HTML', reply_markup: getMainKeyboard() } as any)
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

  // /menu — tugmalar klaviaturasini qayta ko'rsatish
  b.onText(/^\/menu$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const link = await (prisma as any).telegramLink.findUnique({ where: { chatId } }).catch(() => null)
    if (!link) {
      await b.sendMessage(chatId, 'ℹ️ Avval saytdan ulang.',
        { reply_markup: getUnlinkedKeyboard() } as any)
      return
    }
    await b.sendMessage(chatId, '📋 Asosiy menyu:',
      { reply_markup: getMainKeyboard() } as any)
  })

  // /app — Telegram Mini App'ni ochish
  b.onText(/^\/app$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const appUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/tma`
      : 'https://avtohisob.uz/tma'
    try {
      await b.sendMessage(chatId,
        '📱 <b>AvtoHisob Mini App</b>\n\nYo\'llanmalar, bildirishnomalar va statistika — Telegram ichida.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 Ilovani ochish', web_app: { url: appUrl } },
            ]],
          },
        } as any)
    } catch (err: any) {
      console.error('[TelegramBot] /app xatosi:', err?.message ?? err)
    }
  })

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

  // ── Evidence OTP: rasm va video qabul qilish ────────────────────────────────
  // chatId → { files: [{fileId, ext}][], receivedAt } — 12 daqiqa saqlanadi
  // Foto (albom), video_note (dumaloq), oddiy qisqa video qo'llab-quvvatlanadi
  type MediaFile = { fileId: string; ext: '.jpg' | '.mp4' }
  const pendingMedia = new Map<string, { files: MediaFile[]; receivedAt: number }>()
  // Albom uchun takroriy "qabul qilindi" xabarini oldini olish
  const seenMediaGroups = new Set<string>()

  // Brute-force himoyasi: bir chatId uchun OTP urinishlar soni va sekin urinish lockout
  // Limit: 10 daqiqada 5 ta noto'g'ri urinish → 30 daqiqa lockout
  const otpAttempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>()
  const OTP_MAX_ATTEMPTS = 5
  const OTP_WINDOW_MS = 10 * 60 * 1000
  const OTP_LOCKOUT_MS = 30 * 60 * 1000

  function addPendingFile(chatId: string, file: MediaFile) {
    const existing = pendingMedia.get(chatId)
    if (existing) {
      existing.files.push(file)
      existing.receivedAt = Date.now()
    } else {
      pendingMedia.set(chatId, { files: [file], receivedAt: Date.now() })
    }
  }

  // Rasm (albom ham bo'lishi mumkin)
  b.on('photo', async (msg) => {
    const chatId = String(msg.chat.id)
    const photo = msg.photo?.[msg.photo.length - 1]
    if (!photo) return

    const mediaGroupId = (msg as any).media_group_id as string | undefined
    const isNewGroup = mediaGroupId && !seenMediaGroups.has(mediaGroupId)
    if (mediaGroupId) {
      if (isNewGroup) {
        seenMediaGroups.add(mediaGroupId)
        setTimeout(() => seenMediaGroups.delete(mediaGroupId), 5 * 60 * 1000)
      }
    }

    addPendingFile(chatId, { fileId: photo.file_id, ext: '.jpg' })

    if (!mediaGroupId || isNewGroup) {
      await b.sendMessage(chatId,
        '📷 Rasm(lar) qabul qilindi!\n\n' +
        'Barcha rasmlarni yuborgach <b>saytda ko\'rsatilgan 6 xonali kodni</b> yozing.',
        { parse_mode: 'HTML' })
    }
  })

  // Dumaloq video (video_note) — aldash imkonsizroq: real vaqtda Telegram ichida yoziladi
  b.on('video_note', async (msg) => {
    const chatId = String(msg.chat.id)
    const vn = (msg as any).video_note
    if (!vn) return
    // Telegram bot API: 20 MB gacha yuklab olish mumkin
    if (vn.file_size && vn.file_size > 20 * 1024 * 1024) {
      await b.sendMessage(chatId, '❌ Video juda katta (20 MB dan oshib ketdi). Qisqaroq yozing.')
      return
    }
    addPendingFile(chatId, { fileId: vn.file_id, ext: '.mp4' })
    await b.sendMessage(chatId,
      '🎥 Dumaloq video qabul qilindi!\n\n' +
      '<b>Saytda ko\'rsatilgan 6 xonali kodni</b> yozing.',
      { parse_mode: 'HTML' })
  })

  // Oddiy qisqa video (kamera orqali yoki galereya — rasm kabi, lekin qabul qilinadi)
  b.on('video', async (msg) => {
    const chatId = String(msg.chat.id)
    const video = (msg as any).video
    if (!video) return
    if (video.file_size && video.file_size > 20 * 1024 * 1024) {
      await b.sendMessage(chatId,
        '❌ <b>Video 20 MB dan katta</b> — Telegram boti orqali yuklab bo\'lmaydi (bu Telegram cheklovi).\n\n' +
        'Yechim:\n' +
        '• 🎥 <b>Dumaloq video</b> (video_note) yuboring — u kichik bo\'ladi, yoki\n' +
        '• Qisqaroq/past sifatli video yuboring, yoki\n' +
        '• Saytda <b>«Kompyuterdan»</b> tugmasi orqali yuklang (50 MB gacha).')
      return
    }
    const mediaGroupId = (msg as any).media_group_id as string | undefined
    const isNewGroup = mediaGroupId && !seenMediaGroups.has(mediaGroupId)
    if (mediaGroupId) {
      if (isNewGroup) {
        seenMediaGroups.add(mediaGroupId)
        setTimeout(() => seenMediaGroups.delete(mediaGroupId), 5 * 60 * 1000)
      }
    }
    addPendingFile(chatId, { fileId: video.file_id, ext: '.mp4' })
    if (!mediaGroupId || isNewGroup) {
      await b.sendMessage(chatId,
        '🎥 Video qabul qilindi!\n\n' +
        '<b>Saytda ko\'rsatilgan 6 xonali kodni</b> yozing.',
        { parse_mode: 'HTML' })
    }
  })

  b.on('message', async (msg) => {
    const chatId = String(msg.chat.id)
    const text = msg.text?.trim()
    if (!text) return

    // ── Tugma handlerlari ──────────────────────────────────────────────────
    switch (text) {
      case '📊 Bugungi xulosa':
        return handleInfoCommand(chatId, buildTodaySummary)
      case '⏳ Kutayotganlar':
        return handleInfoCommand(chatId, buildPendingApprovals)
      case '🚗 Mashinalarim':
        return handleInfoCommand(chatId, buildVehiclesList)
      case '📅 Muddatlar':
        return handleInfoCommand(chatId, buildExpiringDocs)
      case '💰 Balans':
        return handleInfoCommand(chatId, buildMonthBalance)
      case '📷 Rasm yuklash':
        await b.sendMessage(chatId,
          '📷 <b>Rasm bilan dalil yuborish:</b>\n\n' +
          '1️⃣ Saytda ta\'mirlash yozuvini toping\n' +
          '2️⃣ <b>«Rasm biriktirish»</b> tugmasini bosing — 6 xonali kod oling\n' +
          '3️⃣ Shu yerga <b>rasm yuboring</b> (bir nechta bo\'lsa hammasi)\n' +
          '4️⃣ Kodni yozing → rasm birikadi ✅',
          { parse_mode: 'HTML' })
        return
      case '🎥 Dumaloq video':
        await b.sendMessage(chatId,
          '🎥 <b>Dumaloq video bilan dalil yuborish:</b>\n\n' +
          '1️⃣ Saytda ta\'mirlash yozuvini toping\n' +
          '2️⃣ <b>«Rasm biriktirish»</b> tugmasini bosing — 6 xonali kod oling\n' +
          '3️⃣ Chatda 🎙 tugmasi <b>yonidagi aylana</b> ni bosib video yozing\n' +
          '4️⃣ Kodni yozing → video birikadi ✅\n\n' +
          '💡 Dumaloq video galereyadан yuborib bo\'lmaydi — bu aldashdan himoya.',
          { parse_mode: 'HTML' })
        return
      case '❓ Yordam':
        await b.sendMessage(chatId,
          '🤖 <b>AutoHisob Bot</b>\n\n' +
          'Ulash uchun saytdagi <b>Settings → Telegram ulash</b> bo\'limidan havolani oling.',
          { parse_mode: 'HTML' })
        return
    }

    // ── OTP: 6 xonali raqam ────────────────────────────────────────────────
    if (!/^\d{6}$/.test(text)) return

    const pending = pendingMedia.get(chatId)
    if (!pending) {
      await b.sendMessage(chatId, "❌ Avval rasm yoki video yuboring, so'ng kodni kiriting.")
      return
    }
    if (Date.now() - pending.receivedAt > 12 * 60 * 1000) {
      pendingMedia.delete(chatId)
      await b.sendMessage(chatId, '❌ Media eskirdi. Iltimos qaytadan yuboring.')
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

      // Barcha rasm/videolarni yuklab olish va saqlash
      const month = new Date().toISOString().slice(0, 7)
      const evidenceDir = path.join(process.cwd(), 'uploads', 'maintenance-evidence', month)
      if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true })

      let savedCount = 0
      for (const mediaFile of pending.files) {
        try {
          const fileLink = await b.getFileLink(mediaFile.fileId)
          const fileName = `${crypto.randomBytes(16).toString('hex')}${mediaFile.ext}`
          const filePath = path.join(evidenceDir, fileName)

          await new Promise<void>((resolve, reject) => {
            https.get(fileLink, (res) => {
              if (res.statusCode !== 200) { res.resume(); reject(new Error(`Telegram HTTP ${res.statusCode}`)); return }
              const file = fs.createWriteStream(filePath)
              res.pipe(file)
              file.on('finish', () => { file.close(); resolve() })
              file.on('error', reject)
            }).on('error', reject)
          })

          const stat = fs.statSync(filePath)
          const fileUrl = `/uploads/maintenance-evidence/${month}/${fileName}`

          await (prisma as any).maintenanceEvidence.create({
            data: { maintenanceId: record.id, fileUrl, fileSizeBytes: stat.size },
          })
          savedCount++
        } catch (mediaErr: any) {
          console.error(`[TelegramBot] Media yuklashda xato (${mediaFile.fileId}):`, mediaErr?.message)
        }
      }

      // OTP ni tozalash
      await (prisma as any).maintenanceRecord.update({
        where: { id: record.id },
        data: { evidenceOtpCode: null, evidenceOtpExpiry: null },
      })

      pendingMedia.delete(chatId)
      // Yuklab bo'lmasa (masalan video 20MB dan katta bo'lib Telegram bermasa) — yolg'on
      // "muvaffaqiyatli" demaymiz, aniq aytamiz (avval bu holat sukut bilan o'tib ketardi)
      if (savedCount === 0) {
        await b.sendMessage(chatId,
          '❌ Media saqlanmadi — fayl juda katta yoki yuklab bo\'lmadi.\n' +
          'Iltimos, qisqaroq video yoki rasm yuboring, yoki saytda <b>«Kompyuterdan»</b> orqali yuklang.')
        return
      }
      const hasVideo = pending.files.some(f => f.ext === '.mp4')
      const label = savedCount === 1
        ? (hasVideo ? 'Video' : 'Rasm')
        : `${savedCount} ta ${hasVideo ? 'media' : 'rasm'}`
      await b.sendMessage(chatId, `✅ ${label} muvaffaqiyatli biriktirildi! Admin tekshiradi.`)
    } catch (err: any) {
      console.error('[TelegramBot] OTP evidence xatosi:', err?.message)
      await b.sendMessage(chatId, '❌ Xato yuz berdi. Qaytadan urinib ko\'ring.')
    }
  })

  // ── Callback query (inline button) handler ─────────────────────────────────
  // Lead alert xabarlaridagi tezkor amal tugmalari uchun.
  // callback_data format: "lead:<action>:<leadId>"
  // actions: contacted | converted | rejected | spam
  b.on('callback_query', async (q) => {
    try {
      const data = q.data ?? ''
      if (!data.startsWith('lead:')) return // boshqa modullar uchun reservation

      const [, action, leadId] = data.split(':')
      const VALID_ACTIONS = new Set(['contacted', 'converted', 'rejected', 'spam'])
      if (!VALID_ACTIONS.has(action) || !leadId) {
        await b.answerCallbackQuery(q.id, { text: 'Noto\'g\'ri amal' })
        return
      }

      // Faqat super_admin ariza statusini o'zgartira oladi
      const chatId = String(q.message?.chat.id ?? '')
      if (!chatId) {
        await b.answerCallbackQuery(q.id, { text: 'Chat topilmadi' })
        return
      }
      const link = await (prisma as any).telegramLink.findUnique({
        where: { chatId },
        include: { user: { select: { id: true, fullName: true, role: true } } },
      })
      if (!link || link.user.role !== 'super_admin') {
        await b.answerCallbackQuery(q.id, { text: 'Ruxsat yo\'q', show_alert: true })
        return
      }

      // Lead'ni yangilash
      const updated = await (prisma as any).lead.update({
        where: { id: leadId },
        data: {
          status: action,
          ...(action === 'contacted' && { contactedAt: new Date() }),
          ...(action === 'converted' && { convertedAt: new Date() }),
        },
      }).catch(() => null)

      if (!updated) {
        await b.answerCallbackQuery(q.id, { text: 'Ariza topilmadi yoki o\'chirilgan', show_alert: true })
        return
      }

      const STATUS_EMOJI: Record<string, string> = {
        contacted: '✅ Bog\'lanildi',
        converted: '💼 Mijoz bo\'ldi',
        rejected:  '❌ Rad etildi',
        spam:      '🚫 Spam',
      }
      const statusLabel = STATUS_EMOJI[action]
      const now = formatUztDate(new Date())

      // Foydalanuvchiga toast confirmation
      await b.answerCallbackQuery(q.id, { text: `${statusLabel} — saqlandi` })

      // Xabar matnini yangilab, status footerini qo'shamiz va keyboard'ni olib tashlaymiz
      const origText = q.message?.text || q.message?.caption || ''
      // Avval qo'shilgan status footer'ni olib tashlaymiz (idempotent)
      const cleanText = origText.replace(/\n+✓ Status: .+$/m, '')
      const newText = `${cleanText}\n\n✓ Status: <b>${statusLabel}</b>\n👤 ${escapeHtml(link.user.fullName)} · ${now}`

      try {
        await b.editMessageText(newText, {
          chat_id: q.message!.chat.id,
          message_id: q.message!.message_id,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[
            { text: '👁️ Saytda ko\'rish', url: 'https://avtohisob.uz/admin/leads' },
          ]] },
        })
      } catch {
        // Edit xatosi bo'lsa (masalan xabar juda eski) — yangi xabar yuboramiz
        await b.sendMessage(chatId, `✓ Status yangilandi: ${statusLabel}`, { parse_mode: 'HTML' }).catch(() => {})
      }
    } catch (err: any) {
      console.error('[TelegramBot] callback_query xatosi:', err?.message ?? err)
      try { await b.answerCallbackQuery(q.id, { text: 'Ichki xato' }) } catch {}
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

// ─── Lead (landing'dan kelgan ariza) uchun maxsus xabar ─────────────────────
// To'liq tafsilot + tezkor amallar (inline keyboard).
//
// Inline keyboard struktura:
//   Row 1: [✅ Bog'landim] [💼 Mijoz bo'ldi]
//   Row 2: [❌ Rad etildi] [🚫 Spam]
//   Row 3: [👁️ Saytda ko'rish]
//
// Tugma bosilganda — callback_query handler ariza statusini yangilaydi
// va xabarga "✓ Status: ... (kim tomonidan)" pastki qatori qo'shadi.

export interface LeadAlertData {
  id: string
  fullName: string
  phone: string
  email: string | null
  organizationName: string | null
  fleetSize: number | null
  message: string | null
  source: string
  referrer: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}

export async function sendLeadAlert(lead: LeadAlertData): Promise<number> {
  if (!bot) return 0
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'super_admin', isActive: true },
      select: { id: true },
    })
    if (admins.length === 0) return 0

    // Telegram chat ID'lari
    const links = await (prisma as any).telegramLink.findMany({
      where: { userId: { in: admins.map(a => a.id) } },
      select: { chatId: true },
    })
    if (links.length === 0) return 0

    // Brauzer/qurilma turini userAgent'dan tezda chiqaramiz
    const ua = lead.userAgent || ''
    let device = '—'
    if (ua) {
      if (/iPhone|iPad/i.test(ua)) device = '📱 iOS'
      else if (/Android/i.test(ua)) device = '📱 Android'
      else if (/Windows/i.test(ua)) device = '💻 Windows'
      else if (/Mac OS X|Macintosh/i.test(ua)) device = '💻 macOS'
      else if (/Linux/i.test(ua)) device = '💻 Linux'
      else device = '💻 desktop'
      if (/Chrome/i.test(ua)) device += ' · Chrome'
      else if (/Firefox/i.test(ua)) device += ' · Firefox'
      else if (/Safari/i.test(ua)) device += ' · Safari'
      else if (/Edg/i.test(ua)) device += ' · Edge'
    }

    // Manba qaerdan kelgan
    let sourceLabel = '🌐 to\'g\'ridan-to\'g\'ri'
    if (lead.referrer) {
      try {
        const url = new URL(lead.referrer)
        sourceLabel = `🔗 ${url.hostname}`
      } catch {
        sourceLabel = '🔗 ' + (lead.referrer.length > 40 ? lead.referrer.slice(0, 37) + '...' : lead.referrer)
      }
    }

    const lines: string[] = [
      '🆕 <b>YANGI ARIZA — Avtohisob</b>',
      '',
      `👤 <b>${escapeHtml(lead.fullName)}</b>`,
      `📞 <a href="tel:${lead.phone.replace(/[^+0-9]/g, '')}">${escapeHtml(lead.phone)}</a>`,
    ]
    if (lead.email) lines.push(`✉️ <a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>`)
    if (lead.organizationName) lines.push(`🏢 ${escapeHtml(lead.organizationName)}`)
    if (lead.fleetSize != null) lines.push(`🚛 <b>${lead.fleetSize}</b> ta texnika`)
    if (lead.message) {
      lines.push('')
      lines.push('💬 <b>Xabar:</b>')
      lines.push(escapeHtml(lead.message))
    }
    lines.push('')
    lines.push('<i>━━━━━ Texnik ma\'lumot ━━━━━</i>')
    lines.push(`⏰ ${formatUztDate(lead.createdAt)}`)
    lines.push(`${sourceLabel}`)
    lines.push(`${device}`)
    if (lead.ipAddress) lines.push(`🌐 IP: <code>${lead.ipAddress}</code>`)
    lines.push(`🆔 <code>${lead.id.slice(0, 8)}</code>`)

    const text = lines.join('\n')

    const inline_keyboard = [
      [
        { text: '✅ Bog\'landim', callback_data: `lead:contacted:${lead.id}` },
        { text: '💼 Mijoz bo\'ldi', callback_data: `lead:converted:${lead.id}` },
      ],
      [
        { text: '❌ Rad etildi', callback_data: `lead:rejected:${lead.id}` },
        { text: '🚫 Spam', callback_data: `lead:spam:${lead.id}` },
      ],
      [
        { text: '👁️ Saytda ko\'rish', url: `https://avtohisob.uz/admin/leads` },
      ],
    ]

    let sent = 0
    for (const l of links) {
      try {
        await bot.sendMessage(l.chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard },
        })
        sent++
      } catch (err: any) {
        if (err?.response?.body?.error_code === 403) {
          await (prisma as any).telegramLink.delete({ where: { chatId: l.chatId } }).catch(() => {})
        }
      }
    }
    return sent
  } catch (err: any) {
    console.error('[TelegramBot] sendLeadAlert xatosi:', err?.message ?? err)
    return 0
  }
}

// HTML special chars escape (Telegram parse_mode='HTML' uchun)
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatUztDate(d: Date): string {
  // UZT = UTC+5
  const utcMs = d.getTime()
  const uzt = new Date(utcMs + 5 * 3600 * 1000)
  return uzt.toISOString().replace('T', ' ').slice(0, 16) + ' UZT'
}
