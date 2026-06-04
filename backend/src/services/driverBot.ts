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
function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '🚛 Yangi reys' }, { text: '💸 Xarajat qo\'sh' }],
      [{ text: '📊 Bu oygi hisobot' }, { text: '📋 Oxirgi reyslar' }],
      [{ text: '⚙️ Sozlamalar' }, { text: '❓ Yordam' }],
    ],
    resize_keyboard: true,
    persistent: true,
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

  // /start
  b.onText(/^\/start/, async (msg) => {
    const driver = await getOrCreateDriver(msg)
    const chatId = String(msg.chat.id)
    clearState(chatId)
    const name = driver.firstName ? `, ${driver.firstName}` : ''
    await b.sendMessage(chatId,
      `👋 Salom${name}! Men <b>AvtoHisob Haydovchi</b> botiman.\n\n` +
      `Har bir reysdan qancha foyda qilganingizni hisoblayman.\n` +
      `Ta'mirlash, yonilg\'i xarajatlarini kuzatib boraman.\n\n` +
      `Boshlaylik! 👇`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
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
      { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
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
            [{ text: '🛞 Rezina' }, { text: '📋 Yo\'l to\'lovi' }],
            [{ text: '⚖️ Jarima' }, { text: '🔩 Ehtiyot qism' }],
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
    const totalToll = trips.reduce((s: number, t: any) => s + t.tollCost + t.otherCost, 0)
    const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0)
    const totalKm = trips.reduce((s: number, t: any) => s + t.distanceKm, 0)
    const netProfit = totalCargo - totalFuel - totalToll - totalExpenses

    const monthName = now.toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })

    await b.sendMessage(chatId,
      `📊 <b>${monthName} hisobot</b>\n\n` +
      `🚛 Reyslar: ${trips.length} ta (${fmt(totalKm)} km)\n\n` +
      `💰 <b>Daromad:</b>\n` +
      `   Yuk haqi: ${fmt(totalCargo)} so\'m\n\n` +
      `📤 <b>Xarajat:</b>\n` +
      `   Yonilg\'i: ${fmt(totalFuel)} so\'m\n` +
      `   Yo\'l to\'lovi: ${fmt(totalToll)} so\'m\n` +
      `   Ta\'mirlash va b.: ${fmt(totalExpenses)} so\'m\n` +
      `   ─────────────────\n` +
      `   Jami: ${fmt(totalFuel + totalToll + totalExpenses)} so\'m\n\n` +
      `${netProfit >= 0 ? '✅' : '❌'} <b>Sof foyda: ${fmt(netProfit)} so\'m</b>`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
    )
  })

  // 📋 Oxirgi reyslar
  b.onText(/^📋 Oxirgi reyslar|^\/tarix/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    clearState(chatId)

    const trips = await (prisma as any).driverTrip.findMany({
      where: { driverId: driver.id },
      orderBy: { startedAt: 'desc' },
      take: 10,
    })

    if (trips.length === 0) {
      await b.sendMessage(chatId, '📋 Hali reys yo\'q.', { reply_markup: mainKeyboard() } as any)
      return
    }

    const lines = trips.map((t: any, i: number) => {
      const date = new Date(t.startedAt).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })
      const profit = t.netProfit >= 0 ? `+${fmt(t.netProfit)}` : `${fmt(t.netProfit)}`
      return `${i + 1}. ${date} ${t.fromCity}→${t.toCity} | ${fmt(t.cargoPrice)} so\'m | <b>${profit}</b>`
    }).join('\n')

    await b.sendMessage(chatId,
      `📋 <b>Oxirgi reyslar:</b>\n\n${lines}`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
    )
  })

  // ⚙️ Sozlamalar
  b.onText(/^⚙️ Sozlamalar|^\/sozlamalar/, async (msg) => {
    const chatId = String(msg.chat.id)
    const driver = await getOrCreateDriver(msg)
    clearState(chatId)
    await b.sendMessage(chatId,
      `⚙️ <b>Sozlamalar</b>\n\n` +
      `🛢️ Yonilg\'i narxi: <b>${fmt(driver.fuelPrice)} so\'m/litr</b>\n` +
      `⚡ 100 km sarfi: <b>${driver.fuelPer100km} litr</b>\n\n` +
      `Nimani o\'zgartirmoqchisiz?`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '🛢️ Yonilg\'i narxini o\'zgartir' }],
            [{ text: '⚡ Sarfni o\'zgartir (100 km da)' }],
            [{ text: '🔙 Orqaga' }],
          ],
          resize_keyboard: true,
        },
      } as any
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
    await b.sendMessage(chatId, '👍 Asosiy menyu:', { reply_markup: mainKeyboard() } as any)
  })

  // ── Barcha matnli xabarlar — state machine ────────────────────────────────
  b.on('message', async (msg) => {
    if (!msg.text) return
    const chatId = String(msg.chat.id)
    const text = msg.text.trim()

    // Buyruqlar va tugmalar allaqachon boshqa handlerlarda — ularni o'tkazib yuboramiz
    if (text.startsWith('/') || text.startsWith('🚛') || text.startsWith('💸') ||
        text.startsWith('📊') || text.startsWith('📋') || text.startsWith('⚙️') ||
        text.startsWith('❓') || text.startsWith('🔙') || text.startsWith('❌') ||
        text.startsWith('🛢️') || text.startsWith('⚡')) return

    const session = getSession(chatId)

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
      setState(chatId, 'trip_toll', { ...session.data, cargo })
      await b.sendMessage(chatId,
        `💰 Yuk haqi: <b>${fmt(cargo)} so\'m</b>\n\nYo\'l to\'lovi bormi? (yo\'l puli, ko\'prik)\n<i>0 deb yozing agar yo\'q bo\'lsa</i>`,
        { parse_mode: 'HTML' }
      )
      return
    }

    if (session.state === 'trip_toll') {
      const toll = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(toll) || toll < 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 30000 yoki 0')
        return
      }
      // Hisoblash
      const driver = await getOrCreateDriver(msg)
      const { from, to, distance, cargo } = session.data
      const fuelLiters = (distance * driver.fuelPer100km) / 100
      const fuelCost = Math.round(fuelLiters * driver.fuelPrice)
      const netProfit = cargo - fuelCost - toll

      // Saqlash
      await (prisma as any).driverTrip.create({
        data: {
          driverId: driver.id,
          fromCity: from,
          toCity: to,
          distanceKm: distance,
          cargoPrice: cargo,
          fuelCost,
          tollCost: toll,
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
        `💰 Yuk haqi:       <b>${fmt(cargo)} so\'m</b>\n` +
        `🛢️ Yonilg\'i:       <b>-${fmt(fuelCost)} so\'m</b>\n` +
        (toll > 0 ? `📋 Yo\'l to\'lovi:   <b>-${fmt(toll)} so\'m</b>\n` : '') +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${profitEmoji} <b>Sof foyda: ${fmt(netProfit)} so\'m</b>\n\n` +
        `📏 1 km = ${fmt(netProfit / distance)} so\'m foyda`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
      )
      return
    }

    // ── Xarajat oqimi ──
    if (session.state === 'expense_type') {
      const typeMap: Record<string, string> = {
        '🔧 Ta\'mirlash': 'tamirlash',
        '🛢️ Yonilg\'i': 'yonilgi',
        '🛞 Rezina': 'rezina',
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
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
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
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
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
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
      )
      return
    }
  })
}

export function getDriverBot(): TelegramBot | null {
  return driverBot
}
