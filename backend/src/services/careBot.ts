import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../lib/prisma'

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
}
