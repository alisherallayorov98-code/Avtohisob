import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { ensureSubmissionsForVehicle } from './careScheduler'
import { compressVideo } from '../lib/videoCompress'

const UZT_OFFSET_MS = 5 * 60 * 60 * 1000

// uploads/care papkasi (yo'q bo'lsa yaratiladi)
function careUploadDir(): string {
  const dir = path.join(process.cwd(), 'uploads', 'care')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Ulangan haydovchi uchun pastki klaviatura (uzish tugmasi)
const UNLINK_BTN = '🚪 Ulanishni uzish'
const careKeyboard = { keyboard: [[{ text: UNLINK_BTN }]], resize_keyboard: true }

// Bir nechta vazifa bo'lsa: yuborilgan fayl tugma tanlanguncha vaqtincha shu yerda turadi
interface PendingUpload { type: 'photo' | 'video'; fullPath: string; hash: string }
const pendingCareUploads = new Map<string, PendingUpload>()

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
        `Bajarganingizdan so'ng rasm/video biriktirasiz.\n\n` +
        `Ulanishni uzmoqchi bo'lsangiz — pastdagi «${UNLINK_BTN}» tugmasini bosing.`,
        { parse_mode: 'HTML', reply_markup: careKeyboard } as any)
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
      await b.sendMessage(chatId,
        '👋 Salom! Siz texnik parvarish botiga ulangansiz. Eslatmalar shu yerga keladi.',
        { reply_markup: careKeyboard } as any)
    } else {
      await b.sendMessage(chatId,
        '🔧 <b>Texnik parvarish boti</b>\n\nUlanish uchun admin beradigan havolani bosing yoki ' +
        '<code>/start HAVOLA_KODI</code> ko\'rinishida yuboring.',
        { parse_mode: 'HTML' })
    }
  })

  // Ulanishni uzish — /stop yoki tugma. Haydovchining o'zi botdan chiqadi.
  b.onText(/^\/stop$|^\/uzish$/i, (msg) => unlinkSelf(b, msg))
  b.onText(new RegExp(UNLINK_BTN), (msg) => unlinkSelf(b, msg))

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

  // Vazifa tanlash (bir nechta vazifa bo'lganda)
  b.on('callback_query', async (q) => {
    const chatId = String(q.message?.chat.id)
    const msgId = q.message?.message_id
    const data = q.data || ''
    await b.answerCallbackQuery(q.id).catch(() => {})
    const up = pendingCareUploads.get(chatId)

    if (data === 'care_cancel') {
      if (up) { try { fs.unlinkSync(up.fullPath) } catch { /* ignore */ } ; pendingCareUploads.delete(chatId) }
      if (msgId) await b.editMessageText('✖️ Bekor qilindi. Rasmni qaytadan yuboring.', { chat_id: chatId, message_id: msgId }).catch(() => {})
      return
    }
    if (data.startsWith('care_pick:')) {
      const subId = data.slice('care_pick:'.length)
      if (!up) {
        if (msgId) await b.editMessageText('⏳ Muddati o\'tdi. Rasmni qaytadan yuboring.', { chat_id: chatId, message_id: msgId }).catch(() => {})
        return
      }
      const sub = await (prisma as any).vehicleCareSubmission.findUnique({ where: { id: subId } })
      if (!sub || sub.status === 'done') {
        try { fs.unlinkSync(up.fullPath) } catch { /* ignore */ }
        pendingCareUploads.delete(chatId)
        if (msgId) await b.editMessageText('Bu vazifa allaqachon bajarilgan yoki topilmadi.', { chat_id: chatId, message_id: msgId }).catch(() => {})
        return
      }
      pendingCareUploads.delete(chatId)
      if (msgId) await b.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId } as any).catch(() => {})
      await finalizeProof(b, chatId, sub, up.type, up.fullPath, up.hash)
    }
  })
}

// Haydovchining o'zi botdan ulanishni uzadi (ketgan haydovchi uchun)
async function unlinkSelf(b: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  const chatId = String(msg.chat.id)
  try {
    const existing = await (prisma as any).vehicleCareDriver.findFirst({ where: { chatId } })
    if (!existing) {
      await b.sendMessage(chatId, 'Siz ulanmagansiz.', { reply_markup: { remove_keyboard: true } } as any)
      return
    }
    await (prisma as any).vehicleCareDriver.deleteMany({ where: { chatId } })
    // Bugungi bajarilmagan eslatmalar bu chatId ga boshqa kelmasin
    await (prisma as any).vehicleCareSubmission.updateMany({
      where: { driverChatId: chatId, status: 'pending' },
      data: { driverChatId: null },
    })
    await b.sendMessage(chatId,
      '🚪 Ulanish uzildi. Endi eslatmalar kelmaydi.\n\nQayta ulanish uchun admin yangi havola yuborsin.',
      { reply_markup: { remove_keyboard: true } } as any)
  } catch (err: any) {
    console.error('CareBot unlinkSelf error:', err?.message ?? err)
  }
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

    // Bugun belgilangan vazifalar uchun yozuv hali yo'q bo'lsa — shu zahoti ochamiz
    await ensureSubmissionsForVehicle(driver.vehicleId)

    // Barcha bajarilmagan vazifalar (bugungi + kechikkan; skip qilingan emas)
    const pendings = await (prisma as any).vehicleCareSubmission.findMany({
      where: { vehicleId: driver.vehicleId, status: { notIn: ['done', 'skipped'] } },
      orderBy: { dueDate: 'asc' },
    })
    if (pendings.length === 0) {
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

    // Bitta vazifa — to'g'ridan-to'g'ri; bir nechta — qaysi vazifa ekanini so'raymiz
    if (pendings.length === 1) {
      await finalizeProof(b, chatId, pendings[0], type, fullPath, hash)
      return
    }

    // Avvalgi tanlanmagan yuklamani tozalaymiz
    const prev = pendingCareUploads.get(chatId)
    if (prev) { try { fs.unlinkSync(prev.fullPath) } catch { /* ignore */ } }
    pendingCareUploads.set(chatId, { type, fullPath, hash })
    // 10 daqiqada tanlanmasa — faylni o'chiramiz
    setTimeout(() => {
      const cur = pendingCareUploads.get(chatId)
      if (cur && cur.fullPath === fullPath) {
        try { fs.unlinkSync(cur.fullPath) } catch { /* ignore */ }
        pendingCareUploads.delete(chatId)
      }
    }, 10 * 60 * 1000)

    const taskMap: Record<string, any> = {}
    const tIds = [...new Set(pendings.map((s: any) => s.taskId))]
    const tasks = await (prisma as any).vehicleCareTask.findMany({ where: { id: { in: tIds } } })
    tasks.forEach((t: any) => { taskMap[t.id] = t })

    const nowUz0 = new Date(Date.now() + UZT_OFFSET_MS)
    const todayUz0 = new Date(Date.UTC(nowUz0.getUTCFullYear(), nowUz0.getUTCMonth(), nowUz0.getUTCDate()))
    const buttons = pendings.slice(0, 8).map((s: any) => {
      const name = taskMap[s.taskId]?.name || 'Vazifa'
      const late = new Date(s.dueDate).getTime() < todayUz0.getTime()
      const label = `📋 ${name}${late ? ` (kechikkan ${new Date(s.dueDate).toISOString().slice(0, 10)})` : ''}`
      return [{ text: label, callback_data: `care_pick:${s.id}` }]
    })
    buttons.push([{ text: '✖️ Bekor', callback_data: 'care_cancel' }])
    await b.sendMessage(chatId,
      '📎 Rasm/video qabul qilindi. <b>Qaysi vazifa uchun?</b> Tanlang:',
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } } as any)
  } catch (err: any) {
    console.error('CareBot proof error:', err?.message ?? err)
    await b.sendMessage(chatId, '❌ Faylni qabul qilishda xato. Qaytadan urinib ko\'ring.')
  }
}

// Tanlangan/yagona vazifaga isbotni biriktiradi va haydovchiga javob beradi
async function finalizeProof(
  b: TelegramBot,
  chatId: string,
  submission: any,
  type: 'photo' | 'video',
  fullPath: string,
  hash: string,
): Promise<void> {
  // Video bo'lsa — 720p ga siqamiz (disk tejash). ffmpeg yo'q/xato bo'lsa asl qoladi.
  let finalPath = fullPath
  if (type === 'video') {
    const compPath = path.join(path.dirname(fullPath), `${path.basename(fullPath, path.extname(fullPath))}_c.mp4`)
    const ok = await compressVideo(fullPath, compPath)
    if (ok) {
      try { fs.unlinkSync(fullPath) } catch { /* ignore */ }
      finalPath = compPath
    }
  }
  const rel = 'care/' + path.basename(finalPath)
  const task = await (prisma as any).vehicleCareTask.findUnique({ where: { id: submission.taskId } })

  // Kilometr-vazifa bo'lsa: joriy probegni yozib, keyingi intervalни shu km'dan boshlaymiz
  let doneKm: number | null = null
  if (task?.triggerType === 'mileage') {
    const vehicle = await (prisma as any).vehicle.findUnique({
      where: { id: submission.vehicleId }, select: { mileage: true },
    })
    doneKm = Number(vehicle?.mileage || 0)
    await (prisma as any).vehicleCareMileageState.upsert({
      where: { taskId_vehicleId: { taskId: submission.taskId, vehicleId: submission.vehicleId } },
      create: { taskId: submission.taskId, vehicleId: submission.vehicleId, lastKm: doneKm },
      update: { lastKm: doneKm },
    })
  }

  await (prisma as any).vehicleCareSubmission.update({
    where: { id: submission.id },
    data: {
      status: 'done', mediaType: type, mediaPath: rel, mediaHash: hash, submittedAt: new Date(),
      ...(doneKm != null ? { doneKm } : {}),
    },
  })
  const nowUz = new Date(Date.now() + UZT_OFFSET_MS)
  const todayUz = new Date(Date.UTC(nowUz.getUTCFullYear(), nowUz.getUTCMonth(), nowUz.getUTCDate()))
  const wasLate = new Date(submission.dueDate).getTime() < todayUz.getTime()
  const dueStr = new Date(submission.dueDate).toISOString().slice(0, 10)
  await b.sendMessage(chatId,
    `✅ <b>Qabul qilindi!</b> Rahmat.\n📋 ${task?.name || 'Vazifa'} bajarildi deb belgilandi.` +
    (wasLate ? `\n⏰ (${dueStr} kuni uchun — kechikkan, lekin hisobga olindi)` : ''),
    { parse_mode: 'HTML' })
}
