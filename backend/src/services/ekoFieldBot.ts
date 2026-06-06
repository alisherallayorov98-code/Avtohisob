import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../lib/prisma'
import { getCurrentMonth } from '../modules/ekohisob/lib/months'
import { nextReceiptNum } from '../modules/ekohisob/controllers/receipts'

// Tashkilot uchun shu oydagi charge holatini qaytaradi (qancha to'langan/qolgan)
async function getChargeState(entityId: string, month: string, monthlyFee: number, billingMode: string) {
  const charge = await (prisma as any).ekoHisobCharge.findUnique({
    where: { entityId_month: { entityId, month } },
  }).catch(() => null)
  if (charge) {
    return {
      expected: charge.expectedAmount,
      paid: charge.paidAmount,
      remaining: Math.max(0, charge.expectedAmount - charge.paidAmount),
    }
  }
  // Charge yo'q — to'lovlar yig'indisidan hisoblaymiz
  const agg = await (prisma as any).ekoHisobPayment.aggregate({
    where: { entityId, month }, _sum: { amount: true },
  }).catch(() => ({ _sum: { amount: 0 } }))
  const paid = agg._sum.amount || 0
  const expected = billingMode === 'monthly_fixed' ? monthlyFee : 0
  return { expected, paid, remaining: Math.max(0, expected - paid) }
}

let ekoFieldBot: TelegramBot | null = null
let ekoBotUsername: string | null = null

/** Bot username (deep-link uchun, masalan: t.me/<username>?start=TOKEN). */
export function getEkoBotUsername(): string | null {
  return ekoBotUsername
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

interface EkoSession { state: string; data: Record<string, any> }
const sessions = new Map<string, EkoSession>()

function getSession(chatId: string): EkoSession {
  if (!sessions.has(chatId)) sessions.set(chatId, { state: 'idle', data: {} })
  return sessions.get(chatId)!
}
function setState(chatId: string, state: string, data: Record<string, any> = {}) {
  sessions.set(chatId, { state, data })
}
function clearState(chatId: string) {
  sessions.set(chatId, { state: 'idle', data: {} })
}

async function getLinkedUser(chatId: string) {
  const link = await (prisma as any).ekoHisobBotLink.findUnique({
    where: { chatId },
    include: {
      user: {
        include: { districts: { include: { district: { select: { id: true } } } } },
      },
    },
  })
  return link?.user ?? null
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '📍 Joylashuvni yuboring', request_location: true }],
      [{ text: '🔍 Tashkilot qidirish' }, { text: '📋 Bugungi ro\'yxat' }],
      [{ text: '❓ Yordam' }],
    ],
    resize_keyboard: true,
    persistent: true,
  }
}

export async function initEkoFieldBot(): Promise<void> {
  const token = process.env.EKO_FIELD_BOT_TOKEN
  if (!token) {
    console.warn("ℹ️  EKO_FIELD_BOT_TOKEN belgilanmagan — EkoHisob dala-bot o'chirilgan.")
    return
  }
  try {
    ekoFieldBot = new TelegramBot(token, { polling: true })
    const me = await ekoFieldBot.getMe()
    ekoBotUsername = me.username ?? null
    console.log(`✅ EkoHisob dala-bot ishga tushdi: @${me.username}`)
    registerEkoHandlers(ekoFieldBot)
  } catch (err: any) {
    console.error('❌ EkoHisob dala-bot ishga tushmadi:', err?.message ?? err)
    ekoFieldBot = null
  }
}

function registerEkoHandlers(b: TelegramBot) {

  // /start <token> — hisobni ulash
  b.onText(/^\/start (.+)$/, async (msg, match) => {
    const chatId = String(msg.chat.id)
    const rawToken = match?.[1]?.trim()
    if (!rawToken) return
    try {
      const now = new Date()
      const linkToken = await (prisma as any).ekoHisobLinkToken.findUnique({
        where: { token: rawToken.toUpperCase() },
        include: { user: { select: { id: true, fullName: true } } },
      })
      if (!linkToken || linkToken.used || new Date(linkToken.expiresAt) < now) {
        await b.sendMessage(chatId, '❌ Token noto\'g\'ri yoki muddati o\'tgan.\nAdmin yangi token yaratsin.')
        return
      }
      await (prisma as any).ekoHisobBotLink.upsert({
        where: { chatId },
        create: { chatId, userId: linkToken.userId },
        update: { userId: linkToken.userId },
      })
      await (prisma as any).ekoHisobLinkToken.update({
        where: { token: rawToken.toUpperCase() },
        data: { used: true },
      })
      clearState(chatId)
      await b.sendMessage(chatId,
        `✅ Muvaffaqiyatli ulandi!\n\n👤 <b>${linkToken.user.fullName}</b>\n\nHozir joylashuvingizni yuboring yoki tashkilot qidiring.`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
      )
    } catch (err: any) {
      console.error('EkoFieldBot /start error:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Xato yuz berdi. Keyinroq urinib ko\'ring.')
    }
  })

  // /start (tokensiz)
  b.onText(/^\/start$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const user = await getLinkedUser(chatId)
    clearState(chatId)
    if (user) {
      await b.sendMessage(chatId,
        `👋 Salom, <b>${user.fullName}</b>!\n\nJoylashuvingizni yuboring yoki tashkilot qidiring.`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
      )
    } else {
      await b.sendMessage(chatId,
        '🔗 <b>EkoHisob Dala Boti</b>\n\nUlanish uchun admin beradigan tokenni:\n<code>/start TOKEN</code>\nko\'rinishida yuboring.',
        { parse_mode: 'HTML' }
      )
    }
  })

  // ❓ Yordam
  b.onText(/^\/yordam$|^❓ Yordam$/, async (msg) => {
    const chatId = String(msg.chat.id)
    clearState(chatId)
    const user = await getLinkedUser(chatId)
    if (!user) { await b.sendMessage(chatId, '🔗 Avval /start TOKEN bilan ulaning.'); return }
    await b.sendMessage(chatId,
      `📖 <b>EkoHisob Dala Boti</b>\n\n` +
      `📍 Joylashuv yuboring — yaqindagi tashkilotlar\n` +
      `🔍 Tashkilot qidirish — nom bo'yicha qidirish\n` +
      `📋 Bugungi ro'yxat — bu oy to'lamaganlar\n\n` +
      `Tashkilot tanlaganda:\n` +
      `• 💰 To'lov qabul qilish\n• ❌ To'lamadi qayd etish\n• 📍 Koordinata saqlash\n\n` +
      `Ulangan: <b>${user.fullName}</b>`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
    )
  })

  // 📋 Bugungi ro'yxat
  b.onText(/^\/bugun$|^📋 Bugungi ro['']yxat$/, async (msg) => {
    const chatId = String(msg.chat.id)
    clearState(chatId)
    const user = await getLinkedUser(chatId)
    if (!user) { await b.sendMessage(chatId, '🔗 Avval /start TOKEN bilan ulaning.'); return }
    try {
      const districtIds = user.districts.map((d: any) => d.district.id)
      const currentMonth = getCurrentMonth()
      const where: any = { orgId: user.orgId, status: 'active', payments: { none: { month: currentMonth } } }
      if (districtIds.length > 0) where.districtId = { in: districtIds }
      const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
        where, include: { mahalla: { select: { name: true } } }, orderBy: { name: 'asc' }, take: 50,
      })
      if (entities.length === 0) {
        await b.sendMessage(chatId,
          `✅ <b>${currentMonth}</b> oyida hamma to'lagan!`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
        )
        return
      }
      const lines = entities.slice(0, 30).map((e: any, i: number) => {
        const mahalla = e.mahalla?.name ? ` [${e.mahalla.name}]` : ''
        const fee = e.monthlyFee > 0 ? ` — ${fmt(e.monthlyFee)} so'm` : ''
        return `${i + 1}. ${e.name}${mahalla}${fee}`
      })
      const more = entities.length > 30 ? `\n\n...va yana ${entities.length - 30} ta` : ''
      await b.sendMessage(chatId,
        `📋 <b>${currentMonth} — to'lanmaganlar (${entities.length} ta):</b>\n\n${lines.join('\n')}${more}`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
      )
    } catch (err: any) {
      console.error('EkoFieldBot /bugun error:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Xato yuz berdi.')
    }
  })

  // 🔍 Tashkilot qidirish
  b.onText(/^🔍 Tashkilot qidirish$/, async (msg) => {
    const chatId = String(msg.chat.id)
    const user = await getLinkedUser(chatId)
    if (!user) { await b.sendMessage(chatId, '🔗 Avval /start TOKEN bilan ulaning.'); return }
    setState(chatId, 'entity_search', {})
    await b.sendMessage(chatId, '🔍 Tashkilot nomini yozing:',
      { reply_markup: { keyboard: [[{ text: '❌ Bekor qilish' }]], resize_keyboard: true } } as any
    )
  })

  // Joylashuv xabari → eng yaqin tashkilotlar
  b.on('location', async (msg) => {
    const chatId = String(msg.chat.id)
    const user = await getLinkedUser(chatId)
    if (!user) { await b.sendMessage(chatId, '🔗 Avval /start TOKEN bilan ulaning.'); return }
    if (!msg.location) return
    const { latitude: lat, longitude: lon } = msg.location
    clearState(chatId)
    try {
      const districtIds = user.districts.map((d: any) => d.district.id)
      const where: any = { orgId: user.orgId, status: { not: 'inactive' }, lat: { not: null }, lon: { not: null } }
      if (districtIds.length > 0) where.districtId = { in: districtIds }
      const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
        where, select: { id: true, name: true, lat: true, lon: true, monthlyFee: true }, take: 500,
      })
      const withDist = entities
        .map((e: any) => ({ ...e, dist: haversineMeters(lat, lon, e.lat, e.lon) }))
        .sort((a: any, b: any) => a.dist - b.dist)
        .slice(0, 5)

      // lat/lon ni saqlaymiz — yangi tashkilot yoki to'lov uchun ishlatiladi
      setState(chatId, 'location_shown', { lat, lon })

      // "➕ Yangi tashkilot" tugmasi har doim — bu yerda yangi tashkilot qo'shish mumkin
      const inline: any[] = [
        [{ text: '➕ Yangi tashkilot qo\'shish', callback_data: 'newentity' }],
      ]
      for (const e of withDist) {
        const distStr = e.dist < 1000 ? `${Math.round(e.dist)} m` : `${(e.dist / 1000).toFixed(1)} km`
        inline.push([{ text: `${e.name} (${distStr})`, callback_data: `sel:${e.id}` }])
      }
      inline.push([{ text: '❌ Bekor qilish', callback_data: 'cancel' }])

      const header = withDist.length > 0
        ? `📍 Joylashuv qabul qilindi.\nYaqin tashkilot (eng yaqini: ${Math.round(withDist[0].dist)} m) yoki yangi qo'shing:`
        : '📍 Joylashuv qabul qilindi.\nYaqin atrofda tashkilot yo\'q — yangi qo\'shing:'
      await b.sendMessage(chatId, header, { reply_markup: { inline_keyboard: inline } } as any)
    } catch (err: any) {
      console.error('EkoFieldBot location error:', err?.message ?? err)
      await b.sendMessage(chatId, '❌ Xato yuz berdi.')
    }
  })

  // Foto → "to'lamadi" dalili
  b.on('photo', async (msg) => {
    const chatId = String(msg.chat.id)
    const session = getSession(chatId)
    if (session.state !== 'notpaid_reason') return
    const user = await getLinkedUser(chatId)
    if (!user) return
    const { entityName } = session.data
    const reason = msg.caption || ''
    console.log(`EkoFieldBot: to'lamadi foto. entity=${entityName}, user=${user.fullName}, caption=${reason}`)
    clearState(chatId)
    await b.sendMessage(chatId,
      `✅ Qayd etildi!\n🏢 <b>${entityName}</b>\n❌ To'lamadi${reason ? `\n📝 ${reason}` : ''}`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
    )
  })

  // Inline callback'lar
  b.on('callback_query', async (query) => {
    const chatId = String(query.message!.chat.id)
    const msgId = query.message!.message_id
    const data = query.data || ''
    await b.answerCallbackQuery(query.id).catch(() => {})

    if (data === 'cancel') {
      clearState(chatId)
      await b.editMessageText('❌ Bekor qilindi.', { chat_id: chatId, message_id: msgId }).catch(() => {})
      await b.sendMessage(chatId, '👍', { reply_markup: mainKeyboard() } as any)
      return
    }

    const user = await getLinkedUser(chatId)
    if (!user) { await b.sendMessage(chatId, '🔗 Avval /start TOKEN bilan ulaning.'); return }

    // newentity — yangi tashkilot qo'shish: joylashuv saqlanadi, nom so'raladi
    if (data === 'newentity') {
      const session = getSession(chatId)
      const lat = session.data.lat, lon = session.data.lon
      if (lat == null || lon == null) {
        await b.sendMessage(chatId, '📍 Avval joylashuvni yuboring.', { reply_markup: mainKeyboard() } as any)
        return
      }
      setState(chatId, 'new_entity_name', { lat, lon })
      await b.editMessageText('➕ <b>Yangi tashkilot</b>', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' } as any).catch(() => {})
      await b.sendMessage(chatId,
        '🏢 Tashkilot nomini kiriting:\n<i>Qolgan ma\'lumotlarni (STIR, oylik to\'lov, mahalla) keyin saytda to\'ldirasiz.</i>',
        { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '❌ Bekor qilish' }]], resize_keyboard: true } } as any
      )
      return
    }

    // sel:<entityId> — tashkilot tanlanganidan keyin amalni ko'rsat
    if (data.startsWith('sel:')) {
      const entityId = data.slice(4)
      const session = getSession(chatId)
      const locData = session.state === 'location_shown'
        ? { lat: session.data.lat, lon: session.data.lon }
        : {}
      try {
        const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
          where: { id: entityId },
          select: { id: true, name: true, monthlyFee: true, billingMode: true, address: true },
        })
        if (!entity) {
          await b.editMessageText('❌ Tashkilot topilmadi.', { chat_id: chatId, message_id: msgId }).catch(() => {})
          return
        }
        const month = getCurrentMonth()
        const cs = await getChargeState(entityId, month, entity.monthlyFee, entity.billingMode)
        const fullyPaid = cs.expected > 0 && cs.remaining === 0 && cs.paid > 0
        const partial = cs.paid > 0 && cs.remaining > 0

        setState(chatId, 'entity_selected', { entityId, entityName: entity.name, monthlyFee: entity.monthlyFee, ...locData })

        const feeStr = entity.monthlyFee > 0 ? `\n💰 Oylik: ${fmt(entity.monthlyFee)} so'm` : ''
        let statusStr: string
        if (fullyPaid) statusStr = `\n✅ Bu oy to'liq to'langan (${fmt(cs.paid)} so'm)`
        else if (partial) statusStr = `\n🟡 Qisman: ${fmt(cs.paid)} to'langan, <b>${fmt(cs.remaining)} qoldi</b>`
        else statusStr = '\n⚠️ Bu oy to\'lamagan'

        const inline: any[] = []
        if (!fullyPaid) {
          const payLabel = partial ? `💰 Qolgan ${fmt(cs.remaining)} so'm` : '💰 To\'lov qabul qilish'
          inline.push([{ text: payLabel, callback_data: `pay:${entityId}` }])
        }
        inline.push([{ text: '❌ To\'lamadi (qayd)', callback_data: `notpaid:${entityId}` }])
        if ((locData as any).lat != null) inline.push([{ text: '📍 Koordinatani saqlash', callback_data: `saveloc:${entityId}` }])
        inline.push([{ text: '🔙 Orqaga', callback_data: 'cancel' }])
        await b.editMessageText(
          `🏢 <b>${entity.name}</b>${feeStr}${statusStr}\n\nNima qilmoqchisiz?`,
          { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: inline } } as any
        ).catch(() => {})
      } catch (err: any) {
        console.error('EkoFieldBot sel error:', err?.message ?? err)
      }
      return
    }

    // pay:<entityId> → to'lov summasi so'rash
    if (data.startsWith('pay:')) {
      const entityId = data.slice(4)
      const session = getSession(chatId)
      const entityName = session.data.entityName || entityId
      const monthlyFee = session.data.monthlyFee || 0
      setState(chatId, 'payment_amount', { entityId, entityName, monthlyFee })
      // Qolgan qarzni tavsiya qilamiz
      let hint = monthlyFee > 0 ? `\n<i>To'liq: ${fmt(monthlyFee)} so'm</i>` : ''
      try {
        const ent = await (prisma as any).ekoHisobLegalEntity.findUnique({
          where: { id: entityId }, select: { monthlyFee: true, billingMode: true },
        })
        if (ent) {
          const cs = await getChargeState(entityId, getCurrentMonth(), ent.monthlyFee, ent.billingMode)
          if (cs.remaining > 0 && cs.paid > 0) hint = `\n<i>Qolgan qarz: ${fmt(cs.remaining)} so'm</i>`
        }
      } catch {}
      await b.editMessageText(
        `💰 <b>${entityName}</b>\n\nTo'lov summasini yozing:${hint}`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' } as any
      ).catch(() => {})
      await b.sendMessage(chatId, '💰 Summani yozing (so\'m):\n<i>Misol: 50000 — qisman to\'lov ham mumkin</i>',
        { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '❌ Bekor qilish' }]], resize_keyboard: true } } as any
      )
      return
    }

    // notpaid:<entityId> → sabab yoki foto so'rash
    if (data.startsWith('notpaid:')) {
      const entityId = data.slice(8)
      const session = getSession(chatId)
      const entityName = session.data.entityName || entityId
      setState(chatId, 'notpaid_reason', { entityId, entityName })
      await b.editMessageText(
        `❌ <b>${entityName}</b> — to'lamadi`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' } as any
      ).catch(() => {})
      await b.sendMessage(chatId,
        '📝 Sabab yozing yoki foto yuboring (ixtiyoriy):',
        {
          reply_markup: {
            keyboard: [[{ text: '⏭️ Sabab ko\'rsatmasdan' }], [{ text: '❌ Bekor qilish' }]],
            resize_keyboard: true,
          },
        } as any
      )
      return
    }

    // saveloc:<entityId> → lat/lon ni sessiyadan olib saqlash
    if (data.startsWith('saveloc:')) {
      const entityId = data.slice(8)
      const session = getSession(chatId)
      const { lat, lon, entityName } = session.data
      if (lat == null || lon == null) {
        await b.sendMessage(chatId, '❌ Koordinata topilmadi.', { reply_markup: mainKeyboard() } as any)
        return
      }
      try {
        await (prisma as any).ekoHisobLegalEntity.update({ where: { id: entityId }, data: { lat, lon } })
        clearState(chatId)
        await b.editMessageText('✅ Koordinata saqlandi.', { chat_id: chatId, message_id: msgId }).catch(() => {})
        await b.sendMessage(chatId,
          `📍 <b>${entityName || entityId}</b> joylashuvi yangilandi.`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
        )
      } catch (err: any) {
        console.error('EkoFieldBot saveloc error:', err?.message ?? err)
        await b.sendMessage(chatId, '❌ Xato yuz berdi.')
      }
      return
    }
  })

  // Matnli xabarlar — state machine
  b.on('message', async (msg) => {
    if (!msg.text) return
    const chatId = String(msg.chat.id)
    const text = msg.text.trim()
    if (
      text.startsWith('/') ||
      text === '📍 Joylashuvni yuboring' ||
      text === '🔍 Tashkilot qidirish' ||
      text === '📋 Bugungi ro\'yxat' ||
      text === '❓ Yordam'
    ) return

    const session = getSession(chatId)

    if (text === '❌ Bekor qilish') {
      clearState(chatId)
      await b.sendMessage(chatId, '👍', { reply_markup: mainKeyboard() } as any)
      return
    }

    const user = await getLinkedUser(chatId)
    if (!user) { await b.sendMessage(chatId, '🔗 Avval /start TOKEN bilan ulaning.'); return }

    // Yangi tashkilot — nom kiritildi → chala tashkilot saqlanadi
    if (session.state === 'new_entity_name') {
      const name = text.trim()
      if (name.length < 2) {
        await b.sendMessage(chatId, '❌ Tashkilot nomi juda qisqa. Qayta yozing.')
        return
      }
      const { lat, lon } = session.data
      try {
        // Inspektorning birinchi tumani (districtId majburiy). Yo'q bo'lsa — xato.
        const districtId = user.districts[0]?.district?.id
        if (!districtId) {
          clearState(chatId)
          await b.sendMessage(chatId, '❌ Sizga tuman biriktirilmagan. Admin saytdan tuman biriktirsin.', { reply_markup: mainKeyboard() } as any)
          return
        }
        const entity = await (prisma as any).ekoHisobLegalEntity.create({
          data: {
            name, lat, lon,
            districtId, orgId: user.orgId,
            status: 'draft',          // chala — saytda to'ldiriladi
            billingMode: 'variable',
          },
          select: { id: true, name: true },
        })
        clearState(chatId)
        console.log(`EkoFieldBot: yangi chala tashkilot. id=${entity.id}, name=${name}, user=${user.fullName}`)
        await b.sendMessage(chatId,
          `✅ <b>${entity.name}</b> saqlandi!\n\n` +
          `📍 Joylashuv belgilandi.\n` +
          `📝 Qolgan ma'lumotlarni (STIR, oylik to'lov, mahalla, telefon) saytda — ` +
          `<b>Tashkilotlar → 🟡 Chala</b> bo'limidan to'ldiring.`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
        )
      } catch (err: any) {
        console.error('EkoFieldBot new entity error:', err?.message ?? err)
        clearState(chatId)
        await b.sendMessage(chatId, '❌ Saqlashda xato. Qayta urinib ko\'ring.', { reply_markup: mainKeyboard() } as any)
      }
      return
    }

    // Tashkilot qidirish oqimi
    if (session.state === 'entity_search') {
      try {
        const districtIds = user.districts.map((d: any) => d.district.id)
        const where: any = {
          orgId: user.orgId,
          status: { not: 'inactive' },
          name: { contains: text, mode: 'insensitive' },
        }
        if (districtIds.length > 0) where.districtId = { in: districtIds }
        const entities = await (prisma as any).ekoHisobLegalEntity.findMany({ where, take: 5 })
        if (entities.length === 0) {
          await b.sendMessage(chatId, `❌ "${text}" bo'yicha topilmadi. Boshqacha yozing.`)
          return
        }
        setState(chatId, 'search_result', {})
        const inline = [
          ...entities.map((e: any) => [{ text: e.name, callback_data: `sel:${e.id}` }]),
          [{ text: '❌ Bekor qilish', callback_data: 'cancel' }],
        ]
        await b.sendMessage(chatId, `🔍 "${text}" — natijalar:`, { reply_markup: { inline_keyboard: inline } } as any)
      } catch (err: any) {
        console.error('EkoFieldBot search error:', err?.message ?? err)
        await b.sendMessage(chatId, '❌ Xato yuz berdi.')
      }
      return
    }

    // To'lov summasi (qisman to'lov qo'llab-quvvatlanadi)
    if (session.state === 'payment_amount') {
      const amount = parseInt(text.replace(/[\s,]/g, ''))
      if (isNaN(amount) || amount <= 0) {
        await b.sendMessage(chatId, '❌ Raqam kiriting. Misol: 50000')
        return
      }
      const { entityId, entityName, monthlyFee } = session.data
      const currentMonth = getCurrentMonth()
      try {
        const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
          where: { id: entityId },
          select: { orgId: true, billingMode: true, monthlyFee: true },
        })
        if (!entity) {
          clearState(chatId)
          await b.sendMessage(chatId, '❌ Tashkilot topilmadi.', { reply_markup: mainKeyboard() } as any)
          return
        }

        // To'lov yozuvi (har doim yaratiladi — qisman ham)
        const payment = await (prisma as any).ekoHisobPayment.create({
          data: { entityId, month: currentMonth, amount, receivedBy: user.id, note: 'Dala-bot' },
        })

        // Charge yangilash yoki yaratish
        let remaining = 0
        const charge = await (prisma as any).ekoHisobCharge.findUnique({
          where: { entityId_month: { entityId, month: currentMonth } },
        }).catch(() => null)
        if (charge) {
          const newPaid = charge.paidAmount + amount
          remaining = Math.max(0, charge.expectedAmount - newPaid)
          await (prisma as any).ekoHisobCharge.update({
            where: { id: charge.id },
            data: { paidAmount: newPaid, status: newPaid >= charge.expectedAmount ? 'paid' : 'partial' },
          })
        } else if (entity.billingMode === 'monthly_fixed' && entity.monthlyFee > 0) {
          remaining = Math.max(0, entity.monthlyFee - amount)
          await (prisma as any).ekoHisobCharge.create({
            data: {
              entityId, month: currentMonth,
              expectedAmount: entity.monthlyFee, paidAmount: amount,
              status: amount >= entity.monthlyFee ? 'paid' : 'partial',
            },
          })
        }

        // Haqiqiy kvitansiya (web bilan bir xil)
        let receiptNum = '—'
        try {
          receiptNum = await nextReceiptNum(entity.orgId)
          await (prisma as any).ekoHisobReceipt.create({
            data: {
              receiptNumber: receiptNum, orgId: entity.orgId, entityId,
              paymentId: payment.id, month: currentMonth, amount, issuedBy: user.id,
            },
          })
        } catch (rErr: any) {
          console.warn('EkoFieldBot kvitansiya xatosi:', rErr?.message)
        }

        clearState(chatId)
        const remainStr = remaining > 0
          ? `\n⚠️ <b>Qolgan qarz: ${fmt(remaining)} so'm</b>`
          : '\n✅ To\'liq to\'landi'
        await b.sendMessage(chatId,
          `✅ <b>TO'LOV QABUL QILINDI!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━\n` +
          `🏢 ${entityName}\n` +
          `📅 ${currentMonth}\n` +
          `💰 <b>${fmt(amount)} so'm</b>${remainStr}\n` +
          `👤 ${user.fullName}\n` +
          `🧾 <code>${receiptNum}</code>`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
        )

        // Qarz qolgan bo'lsa — yana to'lash tugmasi
        if (remaining > 0) {
          await b.sendMessage(chatId,
            `${entityName} uchun yana to'lov qabul qilasizmi?`,
            { reply_markup: { inline_keyboard: [
              [{ text: `💰 Qolgan ${fmt(remaining)} so'm`, callback_data: `pay:${entityId}` }],
              [{ text: '✅ Yo\'q, tugadi', callback_data: 'cancel' }],
            ] } } as any
          )
          setState(chatId, 'entity_selected', { entityId, entityName, monthlyFee })
        }
      } catch (err: any) {
        console.error('EkoFieldBot payment save error:', err?.message ?? err)
        await b.sendMessage(chatId, '❌ Xato yuz berdi. Keyinroq urinib ko\'ring.')
      }
      return
    }

    // To'lamadi sababi
    if (session.state === 'notpaid_reason') {
      const { entityName } = session.data
      const reason = text === '⏭️ Sabab ko\'rsatmasdan' ? '' : text
      console.log(`EkoFieldBot: to'lamadi qayd. entity=${entityName}, user=${user.fullName}, reason=${reason}`)
      clearState(chatId)
      await b.sendMessage(chatId,
        `✅ Qayd etildi!\n🏢 <b>${entityName}</b>\n❌ To'lamadi${reason ? `\n📝 Sabab: ${reason}` : ''}`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard() } as any
      )
      return
    }
  })
}

export function getEkoFieldBot(): TelegramBot | null {
  return ekoFieldBot
}
