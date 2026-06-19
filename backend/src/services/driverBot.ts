import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../lib/prisma'

let driverBot: TelegramBot | null = null

// ── Shaharlar orasidagi taxminiy masofa (km) ─────────────────────────────────
const CITY_DISTANCES: Record<string, Record<string, number>> = {
  toshkent: {
    samarqand: 340, buxoro: 570, namangan: 300, andijon: 360,
    fargona: 380, nukus: 1100, termiz: 620, navoiy: 470,
    qarshi: 480, jizzax: 200, guliston: 130, urganch: 1050,
    sirdaryo: 110, shahrisabz: 400,
  },
  samarqand: {
    toshkent: 340, buxoro: 270, navoiy: 130, qarshi: 150,
    termiz: 280, shahrisabz: 70, jizzax: 160, namangan: 580,
    andijon: 620, fargona: 640, nukus: 800,
  },
  buxoro: {
    toshkent: 570, samarqand: 270, navoiy: 95, urganch: 450,
    nukus: 520, qarshi: 280, termiz: 450,
  },
  namangan: { toshkent: 300, andijon: 80, fargona: 100 },
  andijon:  { toshkent: 360, namangan: 80, fargona: 50 },
  fargona:  { toshkent: 380, namangan: 100, andijon: 50 },
  nukus:    { toshkent: 1100, urganch: 160, buxoro: 520 },
  urganch:  { toshkent: 1050, nukus: 160, buxoro: 450 },
  termiz:   { toshkent: 620, samarqand: 280, buxoro: 450, qarshi: 200 },
  navoiy:   { toshkent: 470, samarqand: 130, buxoro: 95, qarshi: 180 },
  qarshi:   { toshkent: 480, samarqand: 150, termiz: 200, navoiy: 180 },
  jizzax:   { toshkent: 200, samarqand: 160, guliston: 90 },
  guliston: { toshkent: 130, jizzax: 90, sirdaryo: 40 },
  sirdaryo: { toshkent: 110, guliston: 40 },
  shahrisabz: { samarqand: 70, qarshi: 90, termiz: 280 },
}

function getDistance(from: string, to: string): number | null {
  const f = normalizeCity(from)
  const t = normalizeCity(to)
  return CITY_DISTANCES[f]?.[t] ?? CITY_DISTANCES[t]?.[f] ?? null
}

function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, '')
    .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/toshkent|тошкент/i, 'toshkent')
    .replace(/samarqand|самарканд/i, 'samarqand')
    .replace(/buxoro|бухара/i, 'buxoro')
    .replace(/namangan|наманган/i, 'namangan')
    .replace(/andijon|андижан/i, 'andijon')
    .replace(/farg[']?ona|фергана/i, 'fargona')
    .replace(/nukus|нукус/i, 'nukus')
    .replace(/urganch|ургенч/i, 'urganch')
    .replace(/termiz|термез/i, 'termiz')
    .replace(/navoiy|навои/i, 'navoiy')
    .replace(/qarshi|карши/i, 'qarshi')
    .replace(/jizzax|джизак/i, 'jizzax')
    .replace(/guliston|гулистан/i, 'guliston')
    .replace(/sirdaryo|сырдарья/i, 'sirdaryo')
    .replace(/shahrisabz|шахрисабз/i, 'shahrisabz')
}

// ── Session (xotira) ──────────────────────────────────────────────────────────
interface Session {
  state: string
  data: Record<string, any>
}
const sessions = new Map<string, Session>()

function getSession(chatId: string): Session {
  if (!sessions.has(chatId)) sessions.set(chatId, { state: 'idle', data: {} })
  return sessions.get(chatId)!
}

function setState(chatId: string, state: string, data: Record<string, any> = {}) {
  sessions.set(chatId, { state, data })
}

function clearState(chatId: string) {
  sessions.set(chatId, { state: 'idle', data: {} })
}

// ── Yordamchi formatlash ──────────────────────────────────────────────────────
function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

// ── Haydovchini topish yoki yaratish ─────────────────────────────────────────
async function getOrCreateDriver(msg: TelegramBot.Message) {
  const chatId = String(msg.chat.id)
  let driver = await (prisma as any).driverBotUser.findUnique({ where: { chatId } })
  if (!driver) {
    driver = await (prisma as any).driverBotUser.create({
      data: {
        chatId,
        firstName: msg.from?.first_name ?? null,
        lastName: msg.from?.last_name ?? null,
        username: msg.from?.username ?? null,
      },
    })
  }
  return driver
}

// ── Tugmalar ──────────────────────────────────────────────────────────────────
function mainKeyboard(mode: string = 'truck') {
  const firstRow = mode === 'personal'
    ? [{ text: '⛽ Yoqilg\'i quydim' }, { text: '💸 Xarajat qo\'sh' }]
    : [{ text: '🚛 Yangi reys' }, { text: '💸 Xarajat qo\'sh' }]
  return {
    keyboard: [
      firstRow,
      [{ text: '📊 Bu oygi hisobot' }, { text: '📋 Tarix' }],
      [{ text: '⚙️ Sozlamalar' }, { text: '❓ Yordam' }],
    ],
    resize_keyboard: true,
    persistent: true,
  }
}

// Foydalanuvchining rejimiga mos asosiy menyu (chatId bo'yicha)
async function menuFor(chatId: string) {
  const d = await (prisma as any).driverBotUser.findUnique({ where: { chatId }, select: { mode: true } })
  return mainKeyboard(d?.mode ?? 'truck')
}

// Rejim tanlash tugmalari (/start da)
function modeChooseKeyboard() {
  return {
    keyboard: [
      [{ text: '🚛 Yuk mashinasi haydovchisi' }],
      [{ text: '🚗 Shaxsiy / yengil mashina' }],
    ],
    resize_keyboard: true,
  }
}

// ── Bot ishga tushirish ───────────────────────────────────────────────────────
export async function initDriverBot(): Promise<void> {
  const token = process.env.DRIVER_BOT_TOKEN
  if (!token) {
    console.warn("ℹ️  DRIVER_BOT_TOKEN belgilanmagan — Haydovchi bot o'chirilgan.")
    return
  }

  try {
    driverBot = new TelegramBot(token, { polling: true })
    const me = await driverBot.getMe()
    console.log(`✅ Haydovchi bot ishga tushdi: @${me.username}`)
    registerDriverHandlers(driverBot)
  } catch (err: any) {
    console.error('❌ Haydovchi bot ishga tushmadi:', err?.message ?? err)
    driverBot = null
  }
}

// ── Handlerlar ────────────────────────────────────────────────────────────────
function registerDriverHandlers(b: TelegramBot) {

  // /start — rejim tanlash
  b.onText(/^\/start/, async (msg) => {
    const driver = await getOrCreateDriver(msg)
    const chatId = String(msg.chat.id)
    clearState(chatId)
    const name = driver.firstName ? `, ${driver.firstName}` : ''
    await b.sendMessage(chatId,
      `👋 Salom${name}! Men <b>AvtoHisob Haydovchi</b> botiman.\n\n` +
      `Avval ayting — siz kim?\n` +
      `🚛 <b>Yuk mashinasi haydovchisi</b> — har reysdan foydani hisoblayman\n` +
      `🚗 <b>Shaxsiy / yengil mashina</b> — oyiga yoqilg\'i va xarajatlaringizni kuzatib boraman`,
      { parse_mode: 'HTML', reply_markup: modeChooseKeyboard() } as any
    )
  })

  // Rejim tanlash
  b.onText(/^🚛 Yuk mashinasi haydovchisi/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    await (prisma as any).driverBotUser.update({ where: { id: driver.id }, data: { mode: 'truck' } })
    clearState(chatId)
    await b.sendMessage(chatId,
      `🚛 <b>Yuk haydovchi rejimi</b>\n\nHar reysdan qancha <b>foyda</b> qilganingizni hisoblayman — yuk haqi, yoqilg\'i, ovqat, yo\'l puli.\n\nBoshlaylik! 👇`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard('truck') } as any
    )
  })

  b.onText(/^🚗 Shaxsiy/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    await (prisma as any).driverBotUser.update({ where: { id: driver.id }, data: { mode: 'personal' } })
    clearState(chatId)
    await b.sendMessage(chatId,
      `🚗 <b>Shaxsiy mashina rejimi</b>\n\nYoqilg\'i va xarajatlaringizni kuzatib boraman. Oy oxirida <b>"gazga qancha ketdi"</b> ni aniq ko\'rasiz.\n\n⛽ Har gaz/benzin quyganingizda <b>"Yoqilg\'i quydim"</b> ni bosing.`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard('personal') } as any
    )
  })

  // ⛽ Yoqilg'i quydim (shaxsiy rejim — tez kirim)
  b.onText(/^⛽ Yoqilg['']i quydim/, async (msg) => {
    const chatId = String(msg.chat.id)
    await getOrCreateDriver(msg)
    setState(chatId, 'pfuel_amount')
    await b.sendMessage(chatId,
      '⛽ Qancha pulga gaz/benzin quydingiz?\n<i>Misol: 150000</i>',
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } } as any
    )
  })

  // /yordam va ❓ Yordam
  b.onText(/^\/help|^❓ Yordam/, async (msg) => {
    const chatId = String(msg.chat.id)
    clearState(chatId)
    await b.sendMessage(chatId,
      `📖 <b>Buyruqlar:</b>\n\n` +
      `🚛 <b>Yangi reys</b> — reys hisobini hisoblash\n` +
      `💸 <b>Xarajat qo\'sh</b> — ta\'mirlash, jarima va b.\n` +
      `📊 <b>Bu oygi hisobot</b> — oylik daromad/xarajat\n` +
      `📋 <b>Oxirgi reyslar</b> — so\'nggi 10 reys\n` +
      `⚙️ <b>Sozlamalar</b> — yonilg\'i narxi, sarfi`,
      { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
    )
  })

  // 🚛 Yangi reys
  b.onText(/^\/reys|^🚛 Yangi reys/, async (msg) => {
    const chatId = String(msg.chat.id)
    await getOrCreateDriver(msg)
    setState(chatId, 'trip_from')
    await b.sendMessage(chatId,
      '🚛 <b>Yangi reys</b>\n\nQayerdan yo\'lga chiqyapsiz?\n<i>Misol: Toshkent</i>',
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } } as any
    )
  })

  // 💸 Xarajat qo'sh
  b.onText(/^💸 Xarajat qo['']sh|^\/xarajat/, async (msg) => {
    const chatId = String(msg.chat.id)
    await getOrCreateDriver(msg)
    setState(chatId, 'expense_type')
    await b.sendMessage(chatId,
      '💸 <b>Xarajat turi:</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '🔧 Ta\'mirlash' }, { text: '🛢️ Yonilg\'i' }],
            [{ text: '🛞 Rezina' }, { text: '🍽 Ovqat' }],
            [{ text: '📋 Yo\'l to\'lovi' }, { text: '⚖️ Jarima' }],
            [{ text: '🔩 Ehtiyot qism' }],
            [{ text: '❌ Bekor qilish' }],
          ],
          resize_keyboard: true,
        },
      } as any
    )
  })

  // 📊 Bu oygi hisobot
  b.onText(/^📊 Bu oygi hisobot|^\/oy/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    clearState(chatId)

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const [trips, expenses] = await Promise.all([
      (prisma as any).driverTrip.findMany({
        where: { driverId: driver.id, startedAt: { gte: monthStart, lte: monthEnd } },
      }),
      (prisma as any).driverExpense.findMany({
        where: { driverId: driver.id, createdAt: { gte: monthStart, lte: monthEnd } },
      }),
    ])

    const totalCargo = trips.reduce((s: number, t: any) => s + t.cargoPrice, 0)
    const totalFuel = trips.reduce((s: number, t: any) => s + t.fuelCost, 0)
    const totalFood = trips.reduce((s: number, t: any) => s + (t.foodCost || 0), 0)
    const totalToll = trips.reduce((s: number, t: any) => s + t.tollCost + t.otherCost, 0)
    const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0)
    const totalKm = trips.reduce((s: number, t: any) => s + t.distanceKm, 0)
    const totalSpent = totalFuel + totalFood + totalToll + totalExpenses
    const netProfit = totalCargo - totalSpent

    const monthName = now.toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })

    // ── Shaxsiy rejim: faqat xarajat (daromad/foyda yo'q) ──
    if (driver.mode === 'personal') {
      const byType: Record<string, number> = {}
      for (const e of expenses) byType[e.type] = (byType[e.type] || 0) + e.amount
      const total = expenses.reduce((s: number, e: any) => s + e.amount, 0)
      const L: Record<string, string> = {
        yonilgi: '⛽ Yoqilg\'i/gaz', ovqat: '🍽 Ovqat', tamirlash: '🔧 Ta\'mirlash',
        rezina: '🛞 Rezina', yol_tolovi: '📋 Yo\'l to\'lovi', jarima: '⚖️ Jarima', ehtiyot_qism: '🔩 Ehtiyot qism',
      }
      const order = ['yonilgi', 'ovqat', 'tamirlash', 'rezina', 'ehtiyot_qism', 'yol_tolovi', 'jarima']
      const catLines = order.filter(t => byType[t]).map(t => `   ${L[t]}: ${fmt(byType[t])} so\'m`).join('\n') || '   — hali xarajat yo\'q —'
      await b.sendMessage(chatId,
        `📊 <b>${monthName} hisobot</b>\n\n` +
        `📤 <b>Xarajatlar:</b>\n${catLines}\n` +
        `   ─────────────────\n   <b>Jami: ${fmt(total)} so\'m</b>` +
        (byType['yonilgi'] ? `\n\n⛽ Bu oy gazga/yoqilg\'iga: <b>${fmt(byType['yonilgi'])} so\'m</b>` : ''),
        { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
      )
      return
    }

    await b.sendMessage(chatId,
      `📊 <b>${monthName} hisobot</b>\n\n` +
      `🚛 Reyslar: ${trips.length} ta (${fmt(totalKm)} km)\n\n` +
      `💰 <b>Daromad:</b>\n` +
      `   Yuk haqi: ${fmt(totalCargo)} so\'m\n\n` +
      `📤 <b>Xarajat:</b>\n` +
      `   🛢️ Yoqilg\'i/gaz: ${fmt(totalFuel)} so\'m\n` +
      `   🍽 Ovqat: ${fmt(totalFood)} so\'m\n` +
      `   📋 Yo\'l to\'lovi: ${fmt(totalToll)} so\'m\n` +
      `   🔧 Ta\'mir va b.: ${fmt(totalExpenses)} so\'m\n` +
      `   ─────────────────\n` +
      `   Jami: ${fmt(totalSpent)} so\'m\n\n` +
      `${netProfit >= 0 ? '✅' : '❌'} <b>Sof foyda: ${fmt(netProfit)} so\'m</b>`,
      { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
    )
  })

  // 📋 Tarix (rejimga qarab: reyslar yoki xarajatlar)
  b.onText(/^📋 Tarix|^📋 Oxirgi reyslar|^\/tarix/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    clearState(chatId)

    if (driver.mode === 'personal') {
      const exps = await (prisma as any).driverExpense.findMany({
        where: { driverId: driver.id }, orderBy: { createdAt: 'desc' }, take: 10,
      })
      if (exps.length === 0) {
        await b.sendMessage(chatId, '📋 Hali xarajat yo\'q. ⛽ "Yoqilg\'i quydim" dan boshlang.', { reply_markup: await menuFor(chatId) } as any)
        return
      }
      const lines = exps.map((e: any, i: number) => {
        const date = new Date(e.createdAt).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })
        return `${i + 1}. ${date} | ${e.description || e.type} | <b>${fmt(e.amount)} so\'m</b>`
      }).join('\n')
      await b.sendMessage(chatId, `📋 <b>Oxirgi xarajatlar:</b>\n\n${lines}`, { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any)
      return
    }

    const trips = await (prisma as any).driverTrip.findMany({
      where: { driverId: driver.id },
      orderBy: { startedAt: 'desc' },
      take: 10,
    })

    if (trips.length === 0) {
      await b.sendMessage(chatId, '📋 Hali reys yo\'q.', { reply_markup: await menuFor(chatId) } as any)
      return
    }

    const lines = trips.map((t: any, i: number) => {
      const date = new Date(t.startedAt).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })
      const profit = t.netProfit >= 0 ? `+${fmt(t.netProfit)}` : `${fmt(t.netProfit)}`
      return `${i + 1}. ${date} ${t.fromCity}→${t.toCity} | ${fmt(t.cargoPrice)} so\'m | <b>${profit}</b>`
    }).join('\n')

    await b.sendMessage(chatId,
      `📋 <b>Oxirgi reyslar:</b>\n\n${lines}`,
      { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
    )
  })

  // ⚙️ Sozlamalar
  b.onText(/^⚙️ Sozlamalar|^\/sozlamalar/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    clearState(chatId)
    const modeLabel = driver.mode === 'personal' ? '🚗 Shaxsiy mashina' : '🚛 Yuk haydovchi'
    await b.sendMessage(chatId,
      `⚙️ <b>Sozlamalar</b>\n\n` +
      `🔁 Rejim: <b>${modeLabel}</b>\n` +
      `🛢️ Yonilg\'i narxi: <b>${fmt(driver.fuelPrice)} so\'m/litr</b>\n` +
      `⚡ 100 km sarfi: <b>${driver.fuelPer100km} litr</b>\n\n` +
      `Nimani o\'zgartirmoqchisiz?`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '🔁 Rejimni o\'zgartir' }],
            [{ text: '🛢️ Yonilg\'i narxini o\'zgartir' }],
            [{ text: '⚡ Sarfni o\'zgartir (100 km da)' }],
            [{ text: '🔙 Orqaga' }],
          ],
          resize_keyboard: true,
        },
      } as any
    )
  })

  // 🔁 Rejimni o'zgartir → /start dagi tanlovni qayta ko'rsatamiz
  b.onText(/^🔁 Rejimni o['']zgartir/, async (msg) => {
    const chatId = String(msg.chat.id)
    clearState(chatId)
    await b.sendMessage(chatId,
      `🔁 Rejimni tanlang:\n🚛 <b>Yuk haydovchi</b> — reys foydasi\n🚗 <b>Shaxsiy</b> — yoqilg\'i/xarajat kuzatuvi`,
      { parse_mode: 'HTML', reply_markup: modeChooseKeyboard() } as any
    )
  })

  b.onText(/^🛢️ Yonilg['']i narxini o['']zgartir/, async (msg) => {
    const chatId = String(msg.chat.id)
    setState(chatId, 'settings_fuel_price')
    await b.sendMessage(chatId,
      '🛢️ Hozirgi yonilg\'i narxini yozing (so\'m/litr):\n<i>Misol: 13500</i>',
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } } as any
    )
  })

  b.onText(/^⚡ Sarfni o['']zgartir/, async (msg) => {
    const chatId = String(msg.chat.id)
    setState(chatId, 'settings_consumption')
    await b.sendMessage(chatId,
      '⚡ 100 km da necha litr yonilg\'i sarflaysiz?\n<i>Misol: 28</i>',
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } } as any
    )
  })

  b.onText(/^🔙 Orqaga|^❌ Bekor qilish/, async (msg) => {
    const chatId = String(msg.chat.id)
    clearState(chatId)
    await b.sendMessage(chatId, '👍 Asosiy menyu:', { reply_markup: await menuFor(chatId) } as any)
  })

  // ── Barcha matnli xabarlar — state machine ────────────────────────────────
  b.on('message', async (msg) => {
    if (!msg.text) return
    const chatId = String(msg.chat.id)
    const text = msg.text.trim()

    // Asosiy menyu/sozlama tugmalari onText'da ishlanadi — ularni ANIQ matn bo'yicha
    // o'tkazib yuboramiz. (Emoji-prefiks bilan emas — aks holda "🛢️ Yonilg'i",
    // "📋 Yo'l to'lovi" kabi xarajat tugmalari noto'g'ri o'tkazib yuborilardi.)
    const MENU_TEXTS = new Set([
      '🚛 Yangi reys', '⛽ Yoqilg\'i quydim', '💸 Xarajat qo\'sh', '📊 Bu oygi hisobot',
      '📋 Tarix', '📋 Oxirgi reyslar', '⚙️ Sozlamalar', '❓ Yordam', '🔙 Orqaga', '❌ Bekor qilish',
      '🚛 Yuk mashinasi haydovchisi', '🚗 Shaxsiy / yengil mashina', '🔁 Rejimni o\'zgartir',
      '🛢️ Yonilg\'i narxini o\'zgartir', '⚡ Sarfni o\'zgartir (100 km da)',
    ])
    if (text.startsWith('/') || MENU_TEXTS.has(text)) return

    const session = getSession(chatId)

    // ── Shaxsiy rejim: tez yoqilg'i kirim ──
    if (session.state === 'pfuel_amount') {
      const amount = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(amount) || amount <= 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 150000')
        return
      }
      const driver = await getOrCreateDriver(msg)
      await (prisma as any).driverExpense.create({
        data: { driverId: driver.id, type: 'yonilgi', amount, description: '⛽ Yoqilg\'i/gaz' },
      })
      clearState(chatId)
      await b.sendMessage(chatId,
        `✅ Saqlandi: <b>${fmt(amount)} so\'m</b> yoqilg\'i.\n📊 "Bu oygi hisobot" — oylik jamini ko\'rasiz.`,
        { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
      )
      return
    }

    // ── Reys oqimi ──
    if (session.state === 'trip_from') {
      setState(chatId, 'trip_to', { from: text })
      await b.sendMessage(chatId,
        `📍 <b>${text}</b> dan yo\'lga chiqyapsiz.\n\nQayerga borasiz?\n<i>Misol: Samarqand</i>`,
        { parse_mode: 'HTML' }
      )
      return
    }

    if (session.state === 'trip_to') {
      const from = session.data.from
      const to = text
      const dist = getDistance(from, to)

      if (dist) {
        setState(chatId, 'trip_cargo', { from, to, distance: dist })
        await b.sendMessage(chatId,
          `📍 <b>${from} → ${to}</b>\n📏 Masofa: <b>${dist} km</b>\n\nYuk haqi necha so\'m?\n<i>Misol: 800000</i>`,
          { parse_mode: 'HTML' }
        )
      } else {
        setState(chatId, 'trip_distance', { from, to })
        await b.sendMessage(chatId,
          `📍 <b>${from} → ${to}</b>\n\nMasofani bilmayman. Taxminiy necha km?\n<i>Misol: 450</i>`,
          { parse_mode: 'HTML' }
        )
      }
      return
    }

    if (session.state === 'trip_distance') {
      const dist = parseInt(text.replace(/\s/g, ''))
      if (isNaN(dist) || dist <= 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 350')
        return
      }
      setState(chatId, 'trip_cargo', { ...session.data, distance: dist })
      await b.sendMessage(chatId,
        `📏 <b>${dist} km</b>\n\nYuk haqi necha so\'m?\n<i>Misol: 800000</i>`,
        { parse_mode: 'HTML' }
      )
      return
    }

    if (session.state === 'trip_cargo') {
      const cargo = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(cargo) || cargo <= 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 800000')
        return
      }
      // Taxminiy yoqilg'i — hint sifatida. Lekin haydovchi ANIQ summani kiritadi.
      const driver = await getOrCreateDriver(msg)
      const estFuel = Math.round((session.data.distance * driver.fuelPer100km / 100) * driver.fuelPrice)
      setState(chatId, 'trip_fuel', { ...session.data, cargo, estFuel })
      await b.sendMessage(chatId,
        `💰 Yuk haqi: <b>${fmt(cargo)} so\'m</b>\n\n` +
        `🛢️ Yoqilg\'i/gazga <b>aslida</b> qancha sarfladingiz?\n` +
        `<i>Taxminiy: ${fmt(estFuel)} so\'m. Aniq summani yozing — yoki taxminni qoldirish uchun "ha".</i>`,
        { parse_mode: 'HTML' }
      )
      return
    }

    if (session.state === 'trip_fuel') {
      let fuelCost: number
      if (/^ha$/i.test(text)) {
        fuelCost = session.data.estFuel
      } else {
        fuelCost = parseInt(text.replace(/[\s,]/g, ''))
        if (isNaN(fuelCost) || fuelCost < 0) {
          await b.sendMessage(chatId, '❌ Raqam kiriting yoki "ha". Misol: 1200000 yoki ha')
          return
        }
      }
      setState(chatId, 'trip_food', { ...session.data, fuelCost })
      await b.sendMessage(chatId,
        `🛢️ Yoqilg\'i: <b>${fmt(fuelCost)} so\'m</b>\n\n🍽 Ovqatga qancha sarfladingiz?\n<i>Yo\'q bo\'lsa 0 yozing</i>`,
        { parse_mode: 'HTML' }
      )
      return
    }

    if (session.state === 'trip_food') {
      const food = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(food) || food < 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 50000 yoki 0')
        return
      }
      setState(chatId, 'trip_other', { ...session.data, food })
      await b.sendMessage(chatId,
        `🍽 Ovqat: <b>${fmt(food)} so\'m</b>\n\n📋 Yo\'l puli, parking va boshqa xarajat?\n<i>Yo\'q bo\'lsa 0 yozing</i>`,
        { parse_mode: 'HTML' }
      )
      return
    }

    if (session.state === 'trip_other') {
      const other = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(other) || other < 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 30000 yoki 0')
        return
      }
      const driver = await getOrCreateDriver(msg)
      const { from, to, distance, cargo, fuelCost, food } = session.data
      const netProfit = cargo - fuelCost - food - other

      await (prisma as any).driverTrip.create({
        data: {
          driverId: driver.id,
          fromCity: from,
          toCity: to,
          distanceKm: distance,
          cargoPrice: cargo,
          fuelCost,
          foodCost: food,
          tollCost: other,
          netProfit,
          status: 'completed',
          completedAt: new Date(),
        },
      })

      clearState(chatId)

      const profitEmoji = netProfit >= 0 ? '✅' : '❌'
      await b.sendMessage(chatId,
        `🚛 <b>REYS HISOBI</b>\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📍 ${from} → ${to} (${distance} km)\n\n` +
        `💰 Yuk haqi:    <b>+${fmt(cargo)} so\'m</b>\n` +
        `🛢️ Yoqilg\'i:    <b>-${fmt(fuelCost)} so\'m</b>\n` +
        (food > 0 ? `🍽 Ovqat:       <b>-${fmt(food)} so\'m</b>\n` : '') +
        (other > 0 ? `📋 Yo\'l/boshqa: <b>-${fmt(other)} so\'m</b>\n` : '') +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${profitEmoji} <b>Sof foyda: ${fmt(netProfit)} so\'m</b>\n\n` +
        `📏 1 km = ${fmt(netProfit / distance)} so\'m`,
        { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
      )
      return
    }

    // ── Xarajat oqimi ──
    if (session.state === 'expense_type') {
      const typeMap: Record<string, string> = {
        '🔧 Ta\'mirlash': 'tamirlash',
        '🛢️ Yonilg\'i': 'yonilgi',
        '🛞 Rezina': 'rezina',
        '🍽 Ovqat': 'ovqat',
        '📋 Yo\'l to\'lovi': 'yol_tolovi',
        '⚖️ Jarima': 'jarima',
        '🔩 Ehtiyot qism': 'ehtiyot_qism',
      }
      const type = typeMap[text]
      if (!type) return
      setState(chatId, 'expense_amount', { type, label: text })
      await b.sendMessage(chatId,
        `${text} — necha so\'m?\n<i>Misol: 250000</i>`,
        { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } } as any
      )
      return
    }

    if (session.state === 'expense_amount') {
      const amount = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(amount) || amount <= 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 250000')
        return
      }
      const driver = await getOrCreateDriver(msg)
      await (prisma as any).driverExpense.create({
        data: {
          driverId: driver.id,
          type: session.data.type,
          amount,
          description: session.data.label,
        },
      })
      clearState(chatId)
      await b.sendMessage(chatId,
        `✅ <b>${session.data.label}</b> xarajati saqlandi: <b>${fmt(amount)} so\'m</b>`,
        { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
      )
      return
    }

    // ── Sozlamalar oqimi ──
    if (session.state === 'settings_fuel_price') {
      const price = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(price) || price < 1000) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 13500')
        return
      }
      const driver = await getOrCreateDriver(msg)
      await (prisma as any).driverBotUser.update({
        where: { id: driver.id },
        data: { fuelPrice: price },
      })
      clearState(chatId)
      await b.sendMessage(chatId,
        `✅ Yonilg\'i narxi yangilandi: <b>${fmt(price)} so\'m/litr</b>`,
        { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
      )
      return
    }

    if (session.state === 'settings_consumption') {
      const consumption = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(consumption) || consumption < 5 || consumption > 100) {
        await b.sendMessage(chatId, '❌ 5 dan 100 gacha raqam kiriting. Misol: 28')
        return
      }
      const driver = await getOrCreateDriver(msg)
      await (prisma as any).driverBotUser.update({
        where: { id: driver.id },
        data: { fuelPer100km: consumption },
      })
      clearState(chatId)
      await b.sendMessage(chatId,
        `✅ Sarfi yangilandi: <b>100 km da ${consumption} litr</b>`,
        { parse_mode: 'HTML', reply_markup: await menuFor(chatId) } as any
      )
      return
    }
  })
}

export function getDriverBot(): TelegramBot | null {
  return driverBot
}
