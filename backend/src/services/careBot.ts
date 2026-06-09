import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'

// uploads/care papkasi (yo'q bo'lsa yaratiladi)
function careUploadDir(): string {
  const dir = path.join(process.cwd(), 'uploads', 'care')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Texnik parvarish boti — haydovchiga davriy vazifa eslatmalarini yuboradi.
// Alohida token (CARE_BOT_TOKEN). Bosqich 2: faqat ulanish (/start TOKEN).
// Bosqich 3-4: eslatma (cron) + rasm/video isboti shu yerga qo'shiladi.

let careBot: TelegramBot | null = null
let careBotUsername: string | null = null

export function getCareBotUsername(): string | null {
  return careBotUsername
}

export async function sendCareMessage(chatId: string, text: string, opts?: any): Promise<boolean> {
  if (!careBot) return false
  try {
    await careBot.sendMessage(chatId, text, { parse_mode: 'HTML', ...opts })
    return true
  } catch (err: any) {
    console.error('CareBot send error:', err?.message ?? err)
    return false
  }
}

export async function initCareBot(): Promise<void> {
  const token = process.env.CARE_BOT_TOKEN
  if (!token) {
    console.warn("ℹ️  CARE_BOT_TOKEN belgilanmagan — texnik parvarish bot o'chirilgan.")
    return
  }
  try {
    careBot = new TelegramBot(token, { polling: true })
    const me = await careBot.getMe()
    careBotUsername = me.username ?? null
    console.log(`✅ Texnik parvarish bot ishga tushdi: @${me.username}`)
    registerCareHandlers(careBot)
  } catch (err: any) {
    console.error('❌ Texnik parvarish bot ishga tushmadi:', err?.message ?? err)
    careBot = null
  }
}

function registerCareHandlers(b: TelegramBot) {
  // /start TOKEN — haydovchini mashinaga ulash
  b.onText(/^\/start (.+)$/, async (msg, match) => {
    const chatId = String(msg.chat.id)
    const rawToken = match?.[1]?.trim()
    if (!rawToken) return
    try {
      const upToken = rawToken.toUpperCase()
      const linkToken = await (prisma as any).vehicleCareLinkToken.findUnique({ where: { token: upToken } })

      if (!linkToken) {
        const existing = await (prisma as any).vehicleCareDriver.findFirst({ where: { chatId } })
        if (existing) {
          await b.sendMessage(chatId, '✅ Siz allaqachon ulangansiz!\n\nTexnik parvarish eslatmalari shu yerga keladi.')
          return
        }
        await b.sendMessage(chatId, '❌ Havola topilmadi. Admin saytdan yangi havola yuborsin.')
        return
      }
      if (new Date(linkToken.expiresAt) < new Date()) {
        await b.sendMessage(chatId, '⏳ Havola muddati o\'tgan. Admin yangi havola yuborsin.')
        return
      }
      if (linkToken.used) {
        const existing = await (prisma as any).vehicleCareDriver.findFirst({ where: { vehicleId: linkToken.vehicleId, chatId } })
        if (existing) {
          await b.sendMessage(chatId, '✅ Siz allaqachon shu mashinaga ulangansiz!')
          return
        }
        await b.sendMessage(chatId, '❌ Bu havola allaqachon ishlatilgan. Admin yangi havola yuborsin.')
        return
      }

      const vehicle = await (prisma as any).vehicle.findUnique({
        where: { id: linkToken.vehicleId },
        select: { registrationNumber: true, brand: true, model: true },
      })

      // Bir mashina — bir haydovchi: eski bog'lanishni almashtiramiz
      await (prisma as any).vehicleCareDriver.deleteMany({ where: { vehicleId: linkToken.vehicleId } })
      await (prisma as any).vehicleCareDriver.create({
        data: {
          vehicleId: linkToken.vehicleId,
          chatId,
          driverName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || null,
          tgUsername: msg.from?.username ?? null,
        },
      })
      await (prisma as any).vehicleCareLinkToken.update({ where: { token: upToken }, data: { used: true } })

      await b.sendMessage(chatId,
        `✅ <b>Muvaffaqiyatli ulandingiz!</b>\n\n` +
        `🚗 ${vehicle?.registrationNumber || ''} ${vehicle?.brand ? `(${vehicle.brand} ${vehicle.model})` : ''}\n\n` +
        `Endi texnik parvarish eslatmalari (havo filtri, smazka...) shu yerga keladi. ` +
        `Bajarganingizdan so'ng rasm/video biriktirasiz.`,
        { parse_mode: 'HTML' })
    } catch (err: any) {
      const detail = err?.message || err?.code || JSON.stringify(err, Object.getOwnPropertyNames(err || {}))
      console.error('CareBot /start error:', detail)
      await b.sendMessage(chatId, '❌ Xato yuz berdi. Keyinroq urinib ko\'ring.')
    }
  })

  // /start (tokensiz)
  b.onText(/^\/start$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const existing = await (prisma as any).vehicleCareDriver.findFirst({ where: { chatId } })
    if (existing) {
      await b.sendMessage(chatId, '👋 Salom! Siz texnik parvarish botiga ulangansiz. Eslatmalar shu yerga keladi.')
    } else {
      await b.sendMessage(chatId,
        '🔧 <b>Texnik parvarish boti</b>\n\nUlanish uchun admin beradigan havolani bosing yoki ' +
        '<code>/start HAVOLA_KODI</code> ko\'rinishida yuboring.',
        { parse_mode: 'HTML' })
    }
  })

  // Rasm — isbot
  b.on('photo', (msg) => {
    const photos = msg.photo || []
    const fileId = photos.length ? photos[photos.length - 1].file_id : null
    handleProof(b, msg, 'photo', fileId)
  })
  // Video — isbot
  b.on('video', (msg) => {
    handleProof(b, msg, 'video', msg.video?.file_id ?? null)
  })
}

// Haydovchi yuborgan rasm/video isbotini qabul qiladi.
// Hash orqali qayta yuklashni bloklaydi, eng eski bajarilmagan vazifaga biriktiradi.
async function handleProof(
  b: TelegramBot,
  msg: TelegramBot.Message,
  type: 'photo' | 'video',
  fileId: string | null,
): Promise<void> {
  const chatId = String(msg.chat.id)
  if (!fileId) return
  try {
    const driver = await (prisma as any).vehicleCareDriver.findFirst({ where: { chatId } })
    if (!driver) {
      await b.sendMessage(chatId, '🔗 Avval admin bergan havola orqali ulaning (/start HAVOLA_KODI).')
      return
    }

    // Eng eski bajarilmagan (bugungi yoki kechikkan) vazifa
    const pending = await (prisma as any).vehicleCareSubmission.findFirst({
      where: { vehicleId: driver.vehicleId, status: 'pending' },
      orderBy: { dueDate: 'asc' },
    })
    if (!pending) {
      await b.sendMessage(chatId, '✅ Hozircha bajarilmagan vazifa yo\'q. Rahmat!')
      return
    }

    // Faylni yuklab olamiz va hash hisoblaymiz
    const fullPath: string = await (b as any).downloadFile(fileId, careUploadDir())
    const buf = fs.readFileSync(fullPath)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')

    // Qayta yuklashga qarshi: shu mashina uchun bu hash avval ishlatilganmi?
    const dup = await (prisma as any).vehicleCareSubmission.findFirst({
      where: { vehicleId: driver.vehicleId, mediaHash: hash },
    })
    if (dup) {
      try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
      await b.sendMessage(chatId,
        '⚠️ Bu rasm/video avval yuborilgan. Iltimos, <b>bugungi yangi</b> rasm yoki video yuboring.',
        { parse_mode: 'HTML' })
      return
    }

    const rel = 'care/' + path.basename(fullPath)
    await (prisma as any).vehicleCareSubmission.update({
      where: { id: pending.id },
      data: { status: 'done', mediaType: type, mediaPath: rel, mediaHash: hash, submittedAt: new Date() },
    })

    const task = await (prisma as any).vehicleCareTask.findUnique({ where: { id: pending.taskId } })
    await b.sendMessage(chatId,
      `✅ <b>Qabul qilindi!</b> Rahmat.\n📋 ${task?.name || 'Vazifa'} bajarildi deb belgilandi.`,
      { parse_mode: 'HTML' })
  } catch (err: any) {
    console.error('CareBot proof error:', err?.message ?? err)
    await b.sendMessage(chatId, '❌ Faylni qabul qilishda xato. Qaytadan urinib ko\'ring.')
  }
}
