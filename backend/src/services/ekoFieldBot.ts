// EkoHisob dala boti (Telegram). Inspektorlar naqd pulni shu yerdan yozadi.
// Pure mantiq services/ekoBot/*.ts da (testlangan); bu fayl faqat Telegram ulash va DB tartibi.
//
// Qoidalar: to'lov FAQAT recordEkoPayment orqali; tuman/huquq ekoScope orqali; sana/oy uzt.ts orqali.

import { randomUUID } from 'crypto'
import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../lib/prisma'
import { recordEkoPayment } from '../modules/ekohisob/services/paymentService'
import { toCyrillic } from './translit'
import { ekoWebAppUrl, webAppTabUrl } from '../modules/ekohisob/lib/webAppUrl'
import { verifyLinkToken, markLinkTokenUsed } from '../modules/ekohisob/controllers/botLink'
import { canAccessDistrict, entityScopeWhere, isEkoAdmin } from '../modules/ekohisob/lib/ekoScope'
import { currentMonthUz, dayBoundsUz, monthBoundsUz, parseDateOnly, todayUz } from '../modules/ekohisob/lib/uzt'
import { uzDate, uzMonth } from '../modules/ekohisob/lib/dateFormat'
import { logEkoAudit } from '../modules/ekohisob/lib/ekoAudit'
import { computeTalonAmount } from '../modules/ekohisob/lib/talonPay'
import { quickAmounts, parseBotAmount, amountErrorText, parsePlanTarget, parseCubeVolume } from './ekoBot/amount'
import { SessionStore } from './ekoBot/session'
import { matchCommand, CommandId } from './ekoBot/commands'
import {
  esc, head, kv, lines, sum, failText, describeError, confirmText, successText, duplicateText,
  receiptVerifyUrl, monthList, clip, statusFor, normApos,
} from './ekoBot/format'
import {
  mainKeyboard, menuInline, payQuickKeyboard, payConfirmKeyboard, duplicateKeyboard, paySuccessKeyboard,
  errorKeyboard, entityCardKeyboard, notpaidReasonKeyboard, notpaidExtraKeyboard, entityButtons,
} from './ekoBot/keyboards'
import { newPayDraft, setAmount, setMonth, beginSubmit, finishSubmit, failSubmit, PayDraft } from './ekoBot/payFlow'
import { REASONS, presetDate, parsePromiseText, validateVisit, VisitDraft } from './ekoBot/visitFlow'
import { buildDailyPage, buildDistrictReport, buildInspectorShort } from './ekoBot/reports'
import {
  BotUser, scopeOf, actorOf, loadEntityFor, getEntityDebtInfo, paidInMonth, searchEntities,
  loadDailyList, findSimilarForNew, districtOverview, inspectorRows,
} from './ekoBot/queries'

const db = prisma as any

// chatId -> til ('latin' | 'cyrillic')
const langCache = new Map<string, string>()
const store = new SessionStore()
setInterval(() => store.sweep(), 10 * 60 * 1000).unref?.()

let ekoFieldBot: TelegramBot | null = null
let ekoBotUsername: string | null = null

export function getEkoBotUsername(): string | null { return ekoBotUsername }
export function getEkoFieldBot(): TelegramBot | null { return ekoFieldBot }

/** Eko bot orqali xabar yuborish (eslatma cron uchun). Bot o'chiq bo'lsa — false. */
export async function sendEkoMessage(chatId: string, text: string): Promise<boolean> {
  if (!ekoFieldBot) return false
  try {
    await ekoFieldBot.sendMessage(chatId, text, { parse_mode: 'HTML' })
    return true
  } catch (e: any) {
    console.error(`[EkoBot] xabar yuborilmadi (${chatId}):`, e?.message)
    return false
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ── Sessiya yordamchilari: loc va lastList holat almashganda saqlanadi ──
function setS(chatId: string, state: string, data: Record<string, any> = {}) {
  const prev = store.get(chatId).data
  store.set(chatId, state, { loc: prev.loc, lastList: prev.lastList, ...data })
}

const UNLINKED = "Avval /start TOKEN bilan ulaning"

type Resolved = { user: BotUser } | { user: null; reason: 'unlinked' | 'inactive' }

async function resolveUser(chatId: string): Promise<Resolved> {
  const link = await db.ekoHisobBotLink.findUnique({
    where: { chatId },
    include: { user: { include: { districts: { include: { district: { select: { id: true, name: true } } } } } } },
  })
  if (!link?.user) return { user: null, reason: 'unlinked' }
  langCache.set(chatId, link.lang || 'latin')
  if (!link.user.isActive) return { user: null, reason: 'inactive' }
  return { user: link.user as BotUser }
}

export async function getLinkedUser(chatId: string): Promise<BotUser | null> {
  return (await resolveUser(chatId)).user
}

const canWrite = (u: BotUser) => u.role === 'admin' || u.role === 'inspector'
const NO_DISTRICT = "Sizga tuman biriktirilmagan. Admin saytdan tuman biriktirsin"
const FORBIDDEN_ENTITY = "Bu tashkilot sizning tumaningizda emas"
const kb = (u?: { role?: string } | null) => mainKeyboard(u?.role, ekoWebAppUrl(), webAppTabUrl)
const noDistricts = (u: BotUser) => !isEkoAdmin(u) && u.districts.length === 0

function registerEkoHandlers(b: TelegramBot) {
  // ── Til: kirill tanlanganlarga matn avtomatik o'giriladi ──
  const origSend = b.sendMessage.bind(b)
  ;(b as any).sendMessage = (chatId: any, text: any, opts?: any) => {
    if (langCache.get(String(chatId)) === 'cyrillic') {
      if (typeof text === 'string') text = toCyrillic(text)
      const ik = opts?.reply_markup?.inline_keyboard
      if (Array.isArray(ik)) for (const row of ik) for (const btn of row) if (btn?.text) btn.text = toCyrillic(btn.text)
    }
    return origSend(chatId, text, opts)
  }
  const origEdit = b.editMessageText.bind(b)
  ;(b as any).editMessageText = (text: any, opts?: any) => {
    const cid = opts?.chat_id
    if (cid && langCache.get(String(cid)) === 'cyrillic') {
      if (typeof text === 'string') text = toCyrillic(text)
      const ik = opts?.reply_markup?.inline_keyboard
      if (Array.isArray(ik)) for (const row of ik) for (const btn of row) if (btn?.text) btn.text = toCyrillic(btn.text)
    }
    return origEdit(text, opts)
  }

  const send = (chatId: string, text: string, reply_markup?: any) =>
    b.sendMessage(chatId, text, { parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) } as any)

  /** Xabarni tahrirlaydi; bo'lmasa yangisini yuboradi. */
  async function show(chatId: string, msgId: number | null, text: string, reply_markup?: any) {
    if (msgId != null) {
      try {
        await b.editMessageText(text, {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          reply_markup: reply_markup ?? { inline_keyboard: [] },
        } as any)
        return
      } catch (e: any) {
        if (/not modified/i.test(String(e?.message))) return
      }
    }
    await send(chatId, text, reply_markup)
  }

  const sendFail = (chatId: string, reason: string, retry?: string | null, user?: BotUser | null) =>
    send(chatId, failText(reason), retry !== undefined ? errorKeyboard(retry) : kb(user))

  async function needUser(chatId: string): Promise<BotUser | null> {
    const r = await resolveUser(chatId)
    if (r.user) return r.user
    if (r.reason === 'inactive') {
      await send(chatId, failText('hisobingiz o\'chirilgan, adminga murojaat qiling'))
    } else {
      await send(chatId, `⚠️ ${UNLINKED}`)
    }
    return null
  }

  const staleMsg = (chatId: string, user?: BotUser | null) =>
    send(chatId, `⚠️ <b>Sessiya tugadi</b>\nQaytadan boshlang.`, kb(user))

  /** Handler o'rami: xato bo'lsa yagona shablon bilan javob (sababsiz "Xato yuz berdi" yo'q). */
  function safe<A extends any[]>(
    name: string, chatOf: (...a: A) => string | null, fn: (...a: A) => Promise<void>, retryOf?: (...a: A) => string | null,
  ) {
    return async (...a: A): Promise<void> => {
      try { await fn(...a) } catch (err: any) {
        console.error(`EkoFieldBot ${name} error:`, err?.message ?? err)
        const chatId = chatOf(...a)
        if (!chatId) return
        const info = describeError(err)
        await send(chatId, failText(info.reason), errorKeyboard(info.retryable ? retryOf?.(...a) ?? null : null)).catch(() => {})
      }
    }
  }

  // ── Tashkilot kartochkasi ──
  async function renderCard(user: BotUser, entityId: string, chatId: string) {
    const acc = await loadEntityFor(user, entityId)
    if (!acc.ok) return { error: acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi' }
    const e = acc.entity
    const month = currentMonthUz()
    const info = await getEntityDebtInfo(scopeOf(user), e, month)
    const { session } = store.take(chatId)
    const hasLoc = !!session.data.loc
    let statusLine: string, status: 'ok' | 'warn'
    let extra: string | null = null
    if (e.billingMode === 'variable') {
      const paid = await paidInMonth(e.id, month)
      status = paid > 0 ? 'ok' : 'warn'
      statusLine = paid > 0 ? kv('Bu oy to\'langan', sum(paid)) : "Bu oy to'lamagan"
    } else {
      status = info.debt > 0 ? 'warn' : 'ok'
      statusLine = info.debt > 0 ? kv('Qarz', `<b>${sum(info.debt)}</b>`) : "Qarz yo'q"
      if (info.unpaidMonths.length) extra = kv('Qarz oylari', monthList(info.unpaidMonths))
      else if (info.advance > 0) extra = kv('Avans', sum(info.advance))
    }
    const text = lines(
      head(status, e.name),
      e.address ? kv('Manzil', esc(e.address)) : null,
      e.billingMode === 'talon'
        ? (e.cubicPrice > 0 ? kv('Bir kub narxi', sum(e.cubicPrice)) : "Bir kub narxi belgilanmagan (admin saytdan belgilasin)")
        : (e.monthlyFee > 0 ? kv('Oylik', sum(e.monthlyFee)) : null),
      statusLine, extra,
    )
    const canPay = e.status === 'active' && (e.billingMode === 'variable' || info.debt > 0 || (e.billingMode === 'monthly_fixed'))
    const markup = entityCardKeyboard({
      entityId: e.id, canWrite: canWrite(user), canPay, talon: e.billingMode === 'talon', talonPriceSet: e.cubicPrice > 0,
      hasLocation: hasLoc, lat: e.lat, lon: e.lon, hasBack: !!session.data.lastList,
    })
    return { text, markup, entity: e, info }
  }

  async function showCard(chatId: string, msgId: number | null, user: BotUser, entityId: string) {
    const r = await renderCard(user, entityId, chatId)
    if ('error' in r) { await show(chatId, msgId, failText(r.error ?? 'tashkilot topilmadi'), kb(user)); return }
    setS(chatId, 'entity_selected', { entityId, entityName: r.entity.name })
    await show(chatId, msgId, r.text, r.markup)
  }

  // ── To'lov oqimi ──
  function quickScreen(d: PayDraft) {
    const q = quickAmounts(d.debt, d.monthlyFee)
    const text = lines(
      head('warn', "To'lov qabul qilish"),
      kv('Tashkilot', esc(d.entityName)),
      d.debt > 0 ? kv('Qarz', sum(d.debt)) : (d.monthlyFee > 0 ? kv('Oylik', sum(d.monthlyFee)) : null),
      d.debtMonths.length > 1 ? kv('Qarz oylari', monthList(d.debtMonths)) : null,
      kv('Oy', uzMonth(d.month)),
      'Summani tanlang yoki "Boshqa summa" ni bosing.',
    )
    return { text, markup: payQuickKeyboard({ entityId: d.entityId, full: q.full, half: q.half, months: d.debtMonths, selectedMonth: d.month }) }
  }

  async function startPay(chatId: string, msgId: number | null, user: BotUser, entityId: string) {
    if (!canWrite(user)) { await send(chatId, readOnlyText(), kb(user)); return }
    const acc = await loadEntityFor(user, entityId)
    if (!acc.ok) { await show(chatId, msgId, failText(acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi'), kb(user)); return }
    if (acc.entity.status !== 'active') { await show(chatId, msgId, failText('tashkilot faol emas'), kb(user)); return }
    const month = currentMonthUz()
    const info = await getEntityDebtInfo(scopeOf(user), acc.entity, month)
    const draft = newPayDraft({
      entityId, entityName: acc.entity.name, debt: info.debt, monthlyFee: acc.entity.monthlyFee || 0,
      debtMonths: info.unpaidMonths, currentMonth: month,
    })
    setS(chatId, 'pay_amount', { pay: draft })
    const s = quickScreen(draft)
    await show(chatId, msgId, s.text, s.markup)
  }

  const payDraftOf = (chatId: string): PayDraft | null => {
    const s = store.get(chatId)
    return s.data.pay && ['pay_amount', 'pay_confirm', 'pay_done'].includes(s.state) ? (s.data.pay as PayDraft) : null
  }
  const keepPay = (chatId: string, state: string, d: PayDraft) => setS(chatId, state, { pay: d })

  async function showConfirm(chatId: string, msgId: number | null, d: PayDraft) {
    await show(chatId, msgId, confirmText({
      entityName: d.entityName, month: d.month, amount: d.amount!, debt: d.debt, debtMonths: d.debtMonths,
    }), payConfirmKeyboard(d.entityId))
  }

  async function submitPay(chatId: string, msgId: number | null, user: BotUser, force: boolean) {
    const cur = payDraftOf(chatId)
    if (!cur) { await staleMsg(chatId, user); return }
    if (force && cur.status === 'confirm') cur.force = true
    const begun = beginSubmit(cur)
    if (begun.action === 'busy') return
    if (begun.action === 'invalid') { await staleMsg(chatId, user); return }
    if (begun.action === 'done') {
      const s = cur.summary!
      await send(chatId, successText({
        entityName: cur.entityName, month: s.month, amount: s.amount, allocations: s.allocations,
        talonsClosed: s.talonsClosed, remaining: s.remaining, receiptNumber: s.receiptNumber,
        inspector: user.fullName, replay: true,
      }), paySuccessKeyboard({ entityId: cur.entityId, remaining: s.remaining, verifyUrl: receiptVerifyUrl(s.verifyToken) }))
      return
    }
    let d = begun.draft
    keepPay(chatId, 'pay_confirm', d)
    if (msgId != null) await b.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId } as any).catch(() => {})
    try {
      if (!canWrite(user)) throw Object.assign(new Error('forbidden'), { name: 'PaymentError', code: 'FORBIDDEN' })
      const acc = await loadEntityFor(user, d.entityId)
      if (!acc.ok) {
        throw Object.assign(new Error('x'), { name: 'PaymentError', code: acc.reason === 'forbidden' ? 'FORBIDDEN' : 'ENTITY_NOT_FOUND' })
      }
      const result = await recordEkoPayment({
        entity: acc.entity, month: d.month, amount: d.amount!, note: 'Dala-bot', actorId: user.id,
        force: d.force, method: 'cash', idempotencyKey: d.key, actor: actorOf(user), source: 'bot',
      })
      const summary = {
        receiptNumber: result.receiptNumber, verifyToken: result.verifyToken, remaining: result.remaining,
        amount: d.amount!, month: d.month, allocations: result.allocations, talonsClosed: result.talonsClosed,
      }
      d = finishSubmit(d, summary)
      keepPay(chatId, 'pay_done', d)
      await send(chatId, successText({
        entityName: d.entityName, month: d.month, amount: d.amount!, allocations: result.allocations,
        talonsClosed: result.talonsClosed, remaining: result.remaining, receiptNumber: result.receiptNumber,
        inspector: user.fullName, replay: result.idempotentReplay,
      }), paySuccessKeyboard({ entityId: d.entityId, remaining: result.remaining, verifyUrl: receiptVerifyUrl(result.verifyToken) }))
    } catch (err: any) {
      d = failSubmit(d, false)
      keepPay(chatId, 'pay_confirm', d)
      if (err?.name === 'PaymentError' && err.code === 'DUPLICATE_PAYMENT') {
        await send(chatId, duplicateText(err.data ?? null, d.month), duplicateKeyboard())
        return
      }
      console.error('EkoFieldBot pay error:', err?.message ?? err)
      const info = describeError(err)
      await send(chatId, failText(info.reason), errorKeyboard(info.retryable ? 'pok' : null))
    }
  }

  const readOnlyText = () => lines(head('warn', 'Faqat kuzatish'), "Boshliq to'lov va o'zgartirish qila olmaydi — bu inspektorlar ishi.")

  // ── To'lamadi qaydi ──
  const npOf = (chatId: string) => {
    const s = store.get(chatId)
    return s.data.np && s.state.startsWith('np_') ? (s.data.np as VisitDraft & { entityId: string; entityName: string }) : null
  }

  async function showNpExtra(chatId: string, msgId: number | null) {
    const np = npOf(chatId)
    if (!np) return
    setS(chatId, 'np_extra', { np })
    await show(chatId, msgId, lines(
      head('warn', "To'lamadi qaydi"),
      kv('Tashkilot', esc(np.entityName)),
      kv('Sabab', esc(np.reason ?? "ko'rsatilmagan")),
      kv('Foto', np.photoFileId ? 'bor' : "yo'q"),
      kv("Va'da sanasi", np.promisedDate ? uzDate(np.promisedDate) : "yo'q"),
      "Foto yuborishingiz mumkin. Mijoz to'lash sanasini aytgan bo'lsa, tanlang.",
    ), notpaidExtraKeyboard())
  }

  async function saveVisit(chatId: string, msgId: number | null, user: BotUser) {
    const np = npOf(chatId)
    if (!np) { await staleMsg(chatId, user); return }
    if (!canWrite(user)) { await send(chatId, readOnlyText(), kb(user)); return }
    const acc = await loadEntityFor(user, np.entityId)
    if (!acc.ok) { await sendFail(chatId, acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi', undefined, user); return }
    const loc = store.get(chatId).data.loc
    const draft: VisitDraft = {
      reason: np.reason, promisedDate: np.promisedDate, photoFileId: np.photoFileId,
      lat: loc?.lat ?? null, lon: loc?.lon ?? null,
    }
    const parsed = validateVisit(draft, todayUz())
    if (!parsed.ok) { await show(chatId, msgId, failText(parsed.error), notpaidExtraKeyboard()); return }
    const v = parsed.value
    const visit = await db.ekoHisobVisit.create({
      data: {
        orgId: user.orgId, entityId: np.entityId, userId: user.id, kind: v.kind, reason: v.reason,
        promisedDate: v.promisedDate, lat: v.lat, lon: v.lon, photoFileId: v.photoFileId,
      },
      select: { id: true },
    })
    await logEkoAudit(actorOf(user), {
      action: 'visit.create', targetType: 'visit', targetId: visit.id, targetName: acc.entity.name,
      details: { entityId: np.entityId, kind: v.kind, reason: v.reason, promisedDate: np.promisedDate, source: 'bot' },
    })
    store.clear(chatId)
    await show(chatId, msgId, lines(
      head('ok', 'Qayd etildi'),
      kv('Tashkilot', esc(acc.entity.name)),
      kv('Sabab', esc(v.reason ?? '—')),
      v.promisedDate ? kv("Va'da sanasi", uzDate(v.promisedDate)) : null,
      v.photoFileId ? kv('Foto', 'saqlandi') : null,
    ))
    await send(chatId, 'Davom eting.', kb(user))
  }

  // ── Yangi tashkilot ──
  async function districtsFor(user: BotUser): Promise<{ id: string; name: string }[]> {
    if (isEkoAdmin(user)) {
      return db.ekoHisobDistrict.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    }
    return user.districts.map(d => ({ id: d.district.id, name: d.district.name ?? '' }))
  }

  async function afterDistrict(chatId: string, msgId: number | null, user: BotUser, name: string, lat: number, lon: number, districtId: string) {
    const matches = await findSimilarForNew(scopeOf(user), { name, lat, lon, districtId })
    if (matches.length > 0) {
      setS(chatId, 'new_similar', { nu: { name, lat, lon, districtId } })
      const rows = entityButtons(matches.map(m => ({ id: m.id, label: m.name })))
      rows.push([{ text: "Yo'q, yangi", callback_data: 'newcont' }, { text: 'Bekor', callback_data: 'cancel' }])
      await show(chatId, msgId, lines(
        head('warn', 'Bu shumi?'),
        `"${esc(name)}" ga o'xshash tashkilot bor. Shulardan biri bo'lsa, tanlang.`,
      ), { inline_keyboard: rows })
      return
    }
    await showSaveChoice(chatId, msgId, name, lat, lon, districtId)
  }

  async function showSaveChoice(chatId: string, msgId: number | null, name: string, lat: number, lon: number, districtId: string) {
    setS(chatId, 'new_save_choice', { nu: { name, lat, lon, districtId } })
    await show(chatId, msgId, lines(head('ok', 'Yangi tashkilot'), kv('Nom', esc(name)), 'Joylashuv belgilandi. Qanday saqlaymiz?'),
      { inline_keyboard: [
        [{ text: "Tez (saytda to'ldiraman)", callback_data: 'draftsave' }],
        [{ text: "To'liq (telefon, oylik)", callback_data: 'fullsave' }],
        [{ text: 'Bekor', callback_data: 'cancel' }],
      ] })
  }

  async function createEntity(chatId: string, user: BotUser, nu: any, full?: { phone: string; fee: number }) {
    if (!canWrite(user)) { await send(chatId, readOnlyText(), kb(user)); return }
    const dist = await db.ekoHisobDistrict.findUnique({ where: { id: nu.districtId }, select: { orgId: true } })
    if (!dist || dist.orgId !== user.orgId || !canAccessDistrict(scopeOf(user), nu.districtId)) {
      await sendFail(chatId, "bu tuman sizga biriktirilmagan", undefined, user); return
    }
    const entity = await db.ekoHisobLegalEntity.create({
      data: {
        name: nu.name, lat: nu.lat, lon: nu.lon, districtId: nu.districtId, orgId: user.orgId, createdBy: user.id,
        ...(full
          ? { phone: full.phone || null, monthlyFee: full.fee, status: 'active', billingMode: 'monthly_fixed' }
          : { status: 'draft', billingMode: 'variable' }),
      },
      select: { id: true, name: true },
    })
    await logEkoAudit(actorOf(user), {
      action: 'entity.create', targetType: 'entity', targetId: entity.id, targetName: entity.name,
      details: { source: 'bot', mode: full ? 'full' : 'draft', districtId: nu.districtId },
    })
    store.clear(chatId)
    await send(chatId, lines(
      head('ok', full ? "Tashkilot saqlandi (faol)" : 'Tashkilot saqlandi (chala)'),
      kv('Nom', esc(entity.name)),
      full?.phone ? kv('Telefon', esc(full.phone)) : null,
      full ? kv('Oylik', sum(full.fee)) : null,
      full ? "STIR va mahallani saytdan to'ldirishingiz mumkin." : "Qolgan ma'lumotni saytda Tashkilotlar > Chala bo'limidan to'ldiring.",
    ), kb(user))
  }

  // ── /start TOKEN ──
  b.onText(/^\/start (.+)$/, safe('start-token', (m: TelegramBot.Message, _x: RegExpExecArray | null) => String(m.chat.id), async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = String(msg.chat.id)
    const rawToken = (match as any)?.[1]?.trim()
    if (!rawToken) return
    const v = await verifyLinkToken(rawToken, chatId)
    if (!v.ok) {
      if (v.reason === 'blocked') { await send(chatId, failText("juda ko'p noto'g'ri urinish, 15 daqiqadan keyin qayta urining")); return }
      const existing = (await resolveUser(chatId)).user
      if (v.reason === 'used' && existing && v.row && existing.id === v.row.userId) {
        await send(chatId, lines(head('ok', 'Siz allaqachon ulangansiz'), kv('Xodim', esc(existing.fullName))), kb(existing))
        return
      }
      if (existing && (v.reason === 'malformed' || v.reason === 'not_found')) {
        await send(chatId, lines(head('ok', 'Siz allaqachon ulangansiz'), kv('Xodim', esc(existing.fullName))), kb(existing))
        return
      }
      const why: Record<string, string> = {
        malformed: 'havola noto\'g\'ri', not_found: 'havola topilmadi, admin yangi havola yuborsin',
        expired: 'havola muddati o\'tgan, admin yangi havola yuborsin',
        used: 'bu havola allaqachon ishlatilgan, har inspektorga alohida havola beriladi',
      }
      await send(chatId, failText(why[v.reason] ?? 'havola yaroqsiz'))
      return
    }
    const row = v.row
    // Atomik band qilish: false = poyga, rad
    if (!(await markLinkTokenUsed(row.token))) {
      await send(chatId, failText('havola allaqachon ishlatilgan'))
      return
    }
    try {
      await db.$transaction([
        db.ekoHisobBotLink.deleteMany({ where: { OR: [{ userId: row.userId }, { chatId }] } }),
        db.ekoHisobBotLink.create({
          data: {
            chatId, userId: row.userId, tgUsername: msg.from?.username ?? null,
            tgFirstName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || null,
          },
        }),
      ])
    } catch (e) {
      await db.ekoHisobLinkToken.updateMany({ where: { token: row.token }, data: { used: false } }).catch(() => {})
      throw e
    }
    store.clear(chatId)
    const u = (await resolveUser(chatId)).user
    await send(chatId, lines(
      head('ok', 'Muvaffaqiyatli ulandi'),
      kv('Xodim', esc(row.user.fullName)),
      row.user.role === 'supervisor' ? 'Boshliq (nazoratchi): "Mening tumanim" orqali inspektorlarni kuzating.' : 'Joylashuv yuboring yoki tashkilot qidiring.',
      u && noDistricts(u) ? `Eslatma: ${NO_DISTRICT}.` : null,
    ), kb(row.user))
  }))

  b.onText(/^\/start$/, safe('start', (m: TelegramBot.Message) => String(m.chat.id), async (msg) => {
    const chatId = String(msg.chat.id)
    store.clear(chatId)
    const r = await resolveUser(chatId)
    if (r.user) {
      await send(chatId, lines(head('ok', `Salom, ${r.user.fullName}`),
        r.user.role === 'supervisor' ? 'Boshliq (nazoratchi). Mening tumanim — inspektorlar faoliyati.' : 'Joylashuv yuboring yoki tashkilot qidiring.'), kb(r.user))
    } else if (r.reason === 'inactive') {
      await send(chatId, failText("hisobingiz o'chirilgan, adminga murojaat qiling"))
    } else {
      await send(chatId, lines(head('warn', 'EkoHisob dala boti'), 'Ulanish uchun admin bergan tokenni yuboring:', '<code>/start TOKEN</code>'))
    }
  }))

  // ── Buyruqlar ──
  async function helpText(user: BotUser) {
    return user.role === 'supervisor'
      ? lines(head('ok', 'EkoHisob — boshliq'),
        "Mening tumanim: inspektorlar (0 bilan ham), oxirgi to'lov, plan foizi",
        "Qidirish: nom, STIR, kod yoki telefon",
        "Bugungi ro'yxat: qarzdorlar, qarz kamayish tartibida",
        "Menyu: Yordam, Til",
        "Siz faqat kuzatasiz — to'lovni inspektorlar yozadi.", kv('Ulangan', esc(user.fullName)))
      : lines(head('ok', 'EkoHisob dala boti'),
        "Joylashuv yuborish: yaqin tashkilotlar yoki yangi qo'shish",
        "Qidirish: nom, STIR, kod yoki telefon",
        "Bugungi ro'yxat: qarzdorlar, qarz kamayish tartibida",
        "Mening hisobotim: bugun va bu oy yig'ilgan",
        "Tashkilot kartasida: to'lov (tasdiq bilan), to'lamadi qaydi, talon, qarz tarixi, yo'l ko'rsatish",
        kv('Ulangan', esc(user.fullName)))
  }

  async function runCommand(cmd: CommandId, chatId: string, user: BotUser) {
    if (cmd !== 'menu') store.clear(chatId)
    switch (cmd) {
      case 'cancel':
        await send(chatId, 'Bekor qilindi.', kb(user)); return
      case 'menu':
        await send(chatId, 'Menyu:', menuInline()); return
      case 'help':
        await send(chatId, await helpText(user), kb(user)); return
      case 'lang':
        await send(chatId, 'Til / Тил: qaysi tilda ko\'rishni xohlaysiz?', { inline_keyboard: [
          [{ text: "Lotin (O'zbekcha)", callback_data: 'lang:latin' }],
          [{ text: 'Кирилл (Ўзбекча)', callback_data: 'lang:cyrillic' }],
        ] }); return
      case 'search':
        if (noDistricts(user)) { await send(chatId, failText(NO_DISTRICT), kb(user)); return }
        setS(chatId, 'entity_search', {})
        await send(chatId, 'Nom, STIR, kod yoki telefon (oxirgi 4-9 raqam) yozing:', { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
        return
      case 'today': await showDaily(chatId, null, user, 0); return
      case 'report': await showMyReport(chatId, user); return
      case 'district':
        if (user.role !== 'supervisor') { await send(chatId, 'Bu bo\'lim faqat boshliqlar uchun.', kb(user)); return }
        await showDistrict(chatId, user); return
      case 'plan': await startPlan(chatId, user); return
    }
  }

  async function showDaily(chatId: string, msgId: number | null, user: BotUser, page: number) {
    if (noDistricts(user)) { await show(chatId, msgId, failText(NO_DISTRICT), kb(user)); return }
    const d = await loadDailyList(scopeOf(user))
    const p = buildDailyPage({ rows: d.rows, page, collectedToday: d.collectedToday, month: d.month })
    setS(chatId, 'daily_list', { lastList: { text: p.text, reply_markup: p.reply_markup } })
    await show(chatId, msgId, p.text, p.reply_markup)
  }

  async function showMyReport(chatId: string, user: BotUser) {
    const day = dayBoundsUz(todayUz())!
    const mb = monthBoundsUz(currentMonthUz())!
    const month = currentMonthUz()
    const payments = await db.ekoHisobPayment.findMany({
      where: { receivedBy: user.id, paidAt: { gte: mb.start, lt: mb.end } },
      select: { amount: true, paidAt: true, entityId: true },
    })
    const todayPays = payments.filter((p: any) => p.paidAt >= day.start && p.paidAt < day.end)
    const s = (a: any[]) => a.reduce((t, p) => t + p.amount, 0)
    const talons = await db.ekoHisobTalon.findMany({
      where: { createdBy: user.id, date: { gte: parseDateOnly(`${month}-01`)! } }, select: { amount: true, volume: true },
    })
    const plan = await db.ekoHisobPlan.findUnique({
      where: { inspectorId_date_type: { inspectorId: user.id, date: parseDateOnly(todayUz())!, type: 'new_entity' } },
    })
    const newToday = await db.ekoHisobLegalEntity.count({
      where: { orgId: user.orgId, createdBy: user.id, createdAt: { gte: day.start, lt: day.end } },
    })
    await send(chatId, lines(
      head('ok', `Mening hisobotim — ${uzMonth(month)}`),
      kv('Bugun', `${sum(s(todayPays))} (${new Set(todayPays.map((p: any) => p.entityId)).size} ta tashkilot, ${todayPays.length} to'lov)`),
      kv('Bu oy', `${sum(s(payments))} (${new Set(payments.map((p: any) => p.entityId)).size} ta tashkilot, ${payments.length} to'lov)`),
      talons.length ? kv('Talonlar', `${talons.length} ta, ${Math.round(talons.reduce((t: number, x: any) => t + x.volume, 0) * 1000) / 1000} m³, ${sum(s(talons))}`) : null,
      plan ? kv('Plan', `${newToday} / ${plan.targetCount} tashkilot${newToday >= plan.targetCount ? ' (bajarildi)' : ''}`) : kv('Bugun kiritilgan tashkilot', `${newToday} ta`),
    ), kb(user))
  }

  async function showDistrict(chatId: string, user: BotUser) {
    if (noDistricts(user)) { await send(chatId, failText(NO_DISTRICT), kb(user)); return }
    const o = await districtOverview(scopeOf(user))
    const r = buildDistrictReport(o)
    await send(chatId, r.text, r.reply_markup)
  }

  async function startPlan(chatId: string, user: BotUser) {
    if (user.role !== 'supervisor' && user.role !== 'admin') { await send(chatId, 'Plan berish faqat boshliq/admin uchun.', kb(user)); return }
    if (noDistricts(user)) { await send(chatId, failText(NO_DISTRICT), kb(user)); return }
    const inspectors = await inspectorRows(scopeOf(user), entityScopeWhere(scopeOf(user)))
    if (inspectors.length === 0) { await sendFail(chatId, "inspektor topilmadi, saytdan qo'shing", undefined, user); return }
    const rows = inspectors.map(i => [{ text: clip(i.name, 40), callback_data: `planinsp:${i.id}` }])
    rows.push([{ text: 'Bekor', callback_data: 'cancel' }])
    await send(chatId, lines(head('ok', 'Plan berish'), 'Qaysi inspektorga bugungi plan berasiz?'), { inline_keyboard: rows })
  }

  async function inspectorAllowed(user: BotUser, inspectorId: string) {
    const rows = await inspectorRows(scopeOf(user), entityScopeWhere(scopeOf(user)), inspectorId)
    return rows[0] ?? null
  }

  // ── Joylashuv ──
  b.on('location', safe('location', (m: TelegramBot.Message) => String(m.chat.id), async (msg) => {
    if (msg.chat.type !== 'private' || !msg.location) return
    const chatId = String(msg.chat.id)
    const user = await needUser(chatId)
    if (!user) return
    const { latitude: lat, longitude: lon } = msg.location
    store.clear(chatId)
    if (noDistricts(user)) { await send(chatId, failText(NO_DISTRICT), kb(user)); return }
    const entities = await db.ekoHisobLegalEntity.findMany({
      where: { ...entityScopeWhere(scopeOf(user)), status: { not: 'inactive' }, lat: { not: null }, lon: { not: null } },
      select: { id: true, name: true, lat: true, lon: true }, take: 2000,
    })
    const near = entities
      .map((e: any) => ({ ...e, dist: haversineMeters(lat, lon, e.lat, e.lon) }))
      .sort((a: any, c: any) => a.dist - c.dist).slice(0, 5)
    const inline: any[] = []
    if (canWrite(user)) inline.push([{ text: "Yangi tashkilot qo'shish", callback_data: 'newentity' }])
    for (const e of near) {
      const d = e.dist < 1000 ? `${Math.round(e.dist)} m` : `${(e.dist / 1000).toFixed(1)} km`
      inline.push([{ text: clip(`${e.name} (${d})`, 48), callback_data: `sel:${e.id}` }])
    }
    inline.push([{ text: 'Bekor', callback_data: 'cancel' }])
    const text = near.length
      ? lines(head('ok', 'Joylashuv qabul qilindi'), kv('Eng yaqini', `${Math.round(near[0].dist)} m`), 'Tashkilotni tanlang yoki yangisini qo\'shing.')
      : lines(head('warn', 'Joylashuv qabul qilindi'), "Yaqin atrofda tashkilot yo'q.")
    const markup = { inline_keyboard: inline }
    setS(chatId, 'location_shown', { loc: { lat, lon }, lastList: { text, reply_markup: markup } })
    await send(chatId, text, markup)
  }))

  // ── Foto ──
  b.on('photo', safe('photo', (m: TelegramBot.Message) => String(m.chat.id), async (msg) => {
    if (msg.chat.type !== 'private') return
    const chatId = String(msg.chat.id)
    const { session } = store.take(chatId)
    if (!['np_reason', 'np_text', 'np_extra'].includes(session.state)) return
    const user = await needUser(chatId)
    if (!user) return
    const np = npOf(chatId)
    if (!np || !msg.photo?.length) return
    np.photoFileId = msg.photo[msg.photo.length - 1].file_id
    if (!np.reason && msg.caption) np.reason = clip(msg.caption.trim(), 300)
    setS(chatId, 'np_extra', { np })
    if (np.reason) await showNpExtra(chatId, null)
    else {
      setS(chatId, 'np_reason', { np })
      await send(chatId, lines(head('ok', 'Foto qabul qilindi'), 'Endi sababni tanlang.'), notpaidReasonKeyboard(np.entityId))
    }
  }))

  // ── Inline callback'lar ──
  b.on('callback_query', safe('callback', (q: TelegramBot.CallbackQuery) => q.message ? String(q.message.chat.id) : null,
    async (query) => {
      if (!query.message) return
      const chatId = String(query.message.chat.id)
      const msgId = query.message.message_id
      let data = query.data || ''
      await b.answerCallbackQuery(query.id).catch(() => {})
      if (data.startsWith('rt:')) data = data.slice(3)

      if (data === 'cancel') {
        const u = (await resolveUser(chatId)).user
        store.clear(chatId)
        await show(chatId, msgId, 'Bekor qilindi.')
        if (u) await send(chatId, 'Davom eting.', kb(u))
        return
      }
      if (data.startsWith('lang:')) {
        const lang = data.slice(5) === 'cyrillic' ? 'cyrillic' : 'latin'
        await db.ekoHisobBotLink.updateMany({ where: { chatId }, data: { lang } })
        langCache.set(chatId, lang)
        await b.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId } as any).catch(() => {})
        const u = (await resolveUser(chatId)).user
        await send(chatId, head('ok', "Til o'zgartirildi"), kb(u))
        return
      }

      const user = await needUser(chatId)
      if (!user) return
      const { expired } = store.take(chatId)
      void expired

      if (data === 'm:help') { await send(chatId, await helpText(user), kb(user)); return }
      if (data === 'm:lang') { await runCommand('lang', chatId, user); return }

      // Boshliq faqat kuzatadi
      const writeCb = ['newentity', 'draftsave', 'fullsave', 'newcont', 'pok', 'pforce', 'skipphone', 'nps']
      if (!canWrite(user) && (writeCb.includes(data) || /^(newdist|talon|pay|notpaid|saveloc|pq|pm|npr|npd):?/.test(data))) {
        await show(chatId, msgId, readOnlyText()); return
      }

      if (data.startsWith('dl:')) { await showDaily(chatId, msgId, user, parseInt(data.slice(3), 10) || 0); return }

      if (data === 'back:list') {
        const ll = store.get(chatId).data.lastList
        if (ll) await show(chatId, msgId, ll.text, ll.reply_markup)
        else await show(chatId, msgId, 'Menyudan tanlang.')
        return
      }

      if (data.startsWith('sel:')) { await showCard(chatId, msgId, user, data.slice(4)); return }

      if (data.startsWith('hist:')) {
        const acc = await loadEntityFor(user, data.slice(5))
        if (!acc.ok) { await sendFail(chatId, acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi', undefined, user); return }
        const e = acc.entity
        const [payments, info] = await Promise.all([
          db.ekoHisobPayment.findMany({ where: { entityId: e.id }, orderBy: { paidAt: 'desc' }, take: 6, select: { amount: true, month: true, paidAt: true } }),
          getEntityDebtInfo(scopeOf(user), e, currentMonthUz()),
        ])
        await send(chatId, lines(
          head(statusFor(info.debt > 0), `${e.name} — qarz tarixi`),
          info.debt > 0 ? kv('Jami qarz', `<b>${sum(info.debt)}</b>`) : "Qarz yo'q",
          info.unpaidMonths.length ? kv('Qarz oylari', monthList(info.unpaidMonths)) : null,
          '',
          kv("Oxirgi to'lovlar", payments.length ? '' : "hali yo'q").trimEnd(),
          ...payments.map((p: any) => `${uzMonth(p.month)}: ${sum(p.amount)} (${uzDate(p.paidAt)})`),
        ), { inline_keyboard: [[{ text: 'Orqaga', callback_data: `sel:${e.id}` }]] })
        return
      }

      // ── To'lov ──
      if (data.startsWith('pay:')) { await startPay(chatId, msgId, user, data.slice(4)); return }

      if (data.startsWith('pm:')) {
        const d = payDraftOf(chatId)
        if (!d || d.status === 'done') { await staleMsg(chatId, user); return }
        const nd = setMonth(d, data.slice(3), () => `bot-${randomUUID()}`)
        keepPay(chatId, 'pay_amount', nd)
        const s = quickScreen(nd)
        await show(chatId, msgId, s.text, s.markup)
        return
      }

      if (data.startsWith('pq:')) {
        const [, kind, entityId] = data.split(':')
        const d = payDraftOf(chatId)
        if (!d || d.entityId !== entityId || d.status === 'done' || d.status === 'sending') { await staleMsg(chatId, user); return }
        if (kind === 'other') {
          keepPay(chatId, 'pay_amount', d)
          await show(chatId, msgId, lines(head('warn', "To'lov summasi"), kv('Tashkilot', esc(d.entityName)),
            "Summani so'mda yozing (butun son), masalan 150000."),
          { inline_keyboard: [[{ text: 'Orqaga', callback_data: `pay:${d.entityId}` }, { text: 'Bekor', callback_data: 'cancel' }]] })
          return
        }
        const q = quickAmounts(d.debt, d.monthlyFee)
        const amount = kind === 'half' ? q.half : q.full
        if (!amount) { await staleMsg(chatId, user); return }
        const nd = setAmount(d, amount, () => `bot-${randomUUID()}`)
        keepPay(chatId, 'pay_confirm', nd)
        await showConfirm(chatId, msgId, nd)
        return
      }

      if (data === 'pok' || data === 'pforce') { await submitPay(chatId, msgId, user, data === 'pforce'); return }

      // ── Talon ──
      if (data.startsWith('talon:')) {
        const acc = await loadEntityFor(user, data.slice(6))
        if (!acc.ok) { await show(chatId, msgId, failText(acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi'), kb(user)); return }
        if (!(acc.entity.cubicPrice > 0)) { await show(chatId, msgId, failText('bir kub narxi belgilanmagan'), kb(user)); return }
        setS(chatId, 'talon_volume', { talon: { entityId: acc.entity.id, entityName: acc.entity.name } })
        await show(chatId, msgId, lines(head('warn', 'Yangi talon'), kv('Tashkilot', esc(acc.entity.name)),
          kv('Bir kub narxi', sum(acc.entity.cubicPrice)), 'Necha kub (m³) ish bajarildi? Masalan: 3.5'),
        { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
        return
      }

      // ── To'lamadi ──
      if (data.startsWith('notpaid:')) {
        const acc = await loadEntityFor(user, data.slice(8))
        if (!acc.ok) { await show(chatId, msgId, failText(acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi'), kb(user)); return }
        const np = { entityId: acc.entity.id, entityName: acc.entity.name, reason: null, promisedDate: null, photoFileId: null, lat: null, lon: null }
        setS(chatId, 'np_reason', { np })
        await show(chatId, msgId, lines(head('warn', "To'lamadi qaydi"), kv('Tashkilot', esc(acc.entity.name)),
          'Sababni tanlang. Foto yuborish ham mumkin.'), notpaidReasonKeyboard(acc.entity.id))
        return
      }
      if (data.startsWith('npr:')) {
        const np = npOf(chatId)
        if (!np) { await staleMsg(chatId, user); return }
        const key = data.slice(4)
        if (key === 'other') {
          setS(chatId, 'np_text', { np })
          await show(chatId, msgId, lines(head('warn', 'Sabab'), 'Sababni yozing (kamida 3 harf).'), { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
          return
        }
        np.reason = REASONS[key] ?? null
        if (!np.reason) { await staleMsg(chatId, user); return }
        await showNpExtra(chatId, msgId)
        return
      }
      if (data.startsWith('npd:')) {
        const np = npOf(chatId)
        if (!np) { await staleMsg(chatId, user); return }
        const arg = data.slice(4)
        if (arg === 'txt') {
          setS(chatId, 'np_date', { np })
          await show(chatId, msgId, lines(head('warn', "Va'da sanasi"), 'Sanani kun.oy.yil ko\'rinishida yozing, masalan 25.11.2026.'),
            { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
          return
        }
        const days = parseInt(arg, 10)
        if (![3, 7, 14].includes(days)) { await staleMsg(chatId, user); return }
        np.promisedDate = presetDate(todayUz(), days)
        await saveVisit(chatId, msgId, user)
        return
      }
      if (data === 'nps') { await saveVisit(chatId, msgId, user); return }

      // ── Koordinata ──
      if (data.startsWith('saveloc:')) {
        const loc = store.get(chatId).data.loc
        if (!loc) { await show(chatId, msgId, failText('koordinata topilmadi, joylashuvni qayta yuboring'), kb(user)); return }
        const acc = await loadEntityFor(user, data.slice(8))
        if (!acc.ok) { await show(chatId, msgId, failText(acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi'), kb(user)); return }
        await db.ekoHisobLegalEntity.update({ where: { id: acc.entity.id }, data: { lat: loc.lat, lon: loc.lon } })
        await logEkoAudit(actorOf(user), {
          action: 'entity.location', targetType: 'entity', targetId: acc.entity.id, targetName: acc.entity.name,
          details: { lat: loc.lat, lon: loc.lon, source: 'bot' },
        })
        store.clear(chatId)
        await show(chatId, msgId, lines(head('ok', 'Joylashuv yangilandi'), kv('Tashkilot', esc(acc.entity.name))))
        await send(chatId, 'Davom eting.', kb(user))
        return
      }

      // ── Yangi tashkilot ──
      if (data === 'newentity') {
        if (noDistricts(user)) { await show(chatId, msgId, failText(NO_DISTRICT), kb(user)); return }
        const loc = store.get(chatId).data.loc
        if (!loc) { await show(chatId, msgId, failText('avval joylashuvni yuboring'), kb(user)); return }
        setS(chatId, 'new_entity_name', {})
        await show(chatId, msgId, lines(head('ok', 'Yangi tashkilot'), 'Tashkilot nomini yozing. Qolganini keyin saytda to\'ldirasiz.'),
          { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
        return
      }
      if (data.startsWith('newdist:')) {
        const s = store.get(chatId)
        if (s.state !== 'new_entity_district') { await staleMsg(chatId, user); return }
        const districtId = data.slice(8)
        const dist = await db.ekoHisobDistrict.findUnique({ where: { id: districtId }, select: { orgId: true } })
        if (!dist || dist.orgId !== user.orgId || !canAccessDistrict(scopeOf(user), districtId)) {
          await show(chatId, msgId, failText('bu tuman sizga biriktirilmagan'), kb(user)); return
        }
        const { name } = s.data.nu
        const loc = s.data.loc
        await afterDistrict(chatId, msgId, user, name, loc.lat, loc.lon, districtId)
        return
      }
      if (data === 'newcont') {
        const nu = store.get(chatId).data.nu
        if (store.get(chatId).state !== 'new_similar' || !nu) { await staleMsg(chatId, user); return }
        await showSaveChoice(chatId, msgId, nu.name, nu.lat, nu.lon, nu.districtId)
        return
      }
      if (data === 'draftsave' || data === 'fullsave') {
        const s = store.get(chatId)
        if (s.state !== 'new_save_choice' || !s.data.nu) { await staleMsg(chatId, user); return }
        if (data === 'draftsave') {
          await b.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId } as any).catch(() => {})
          await createEntity(chatId, user, s.data.nu)
          return
        }
        setS(chatId, 'new_full_phone', { nu: s.data.nu })
        await show(chatId, msgId, lines(head('ok', "To'liq to'ldirish"), kv('Nom', esc(s.data.nu.name)), 'Telefon raqamini yozing, masalan 901234567.'),
          { inline_keyboard: [[{ text: 'Telefonsiz', callback_data: 'skipphone' }, { text: 'Bekor', callback_data: 'cancel' }]] })
        return
      }
      if (data === 'skipphone') {
        const s = store.get(chatId)
        if (s.state !== 'new_full_phone') { await staleMsg(chatId, user); return }
        setS(chatId, 'new_full_fee', { nu: s.data.nu, phone: '' })
        await show(chatId, msgId, lines(head('ok', 'Oylik to\'lov'), "Oylik to'lov summasini yozing (so'm), masalan 50000."),
          { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
        return
      }

      // ── Plan ──
      if (data.startsWith('planinsp:')) {
        if (user.role !== 'supervisor' && user.role !== 'admin') return
        const insp = await inspectorAllowed(user, data.slice(9))
        if (!insp) { await show(chatId, msgId, failText('inspektor sizning tumaningizda emas'), kb(user)); return }
        setS(chatId, 'plan_target', { plan: { inspectorId: insp.id, inspectorName: insp.name } })
        await show(chatId, msgId, lines(head('ok', `${insp.name} uchun plan`), 'Bugun nechta tashkilot kiritsin? (1-1000) Masalan: 20'),
          { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] })
        return
      }
      if (data.startsWith('insp:')) {
        if (user.role !== 'supervisor' && user.role !== 'admin') return
        const r = await inspectorAllowed(user, data.slice(5))
        if (!r) { await show(chatId, msgId, failText('inspektor sizning tumaningizda emas'), kb(user)); return }
        await send(chatId, buildInspectorShort(r, uzDate(new Date())), { inline_keyboard: [[{ text: 'Yopish', callback_data: 'cancel' }]] })
        return
      }
    },
    (q) => (q.data && !q.data.startsWith('rt:') ? q.data : null)))

  // ── Matnli xabarlar ──
  b.on('message', safe('message', (m: TelegramBot.Message) => String(m.chat.id), async (msg) => {
    if (!msg.text || msg.chat.type !== 'private') return
    const chatId = String(msg.chat.id)
    const text = msg.text.trim()
    if (/^\/start(\s|$|@)/.test(text)) return

    const { session, expired } = store.take(chatId)
    const cmd = matchCommand(text)

    const user = await needUser(chatId)
    if (!user) return

    if (cmd) { await runCommand(cmd, chatId, user); return }
    if (text.startsWith('/')) { await send(chatId, "Tushunmadim, menyudan tanlang.", kb(user)); return }
    if (expired) { await staleMsg(chatId, user); return }

    const st = session.state
    const cancelRow = { inline_keyboard: [[{ text: 'Bekor', callback_data: 'cancel' }]] }

    if (st === 'new_entity_name') {
      const name = normApos(text).replace(/\s+/g, ' ').slice(0, 120)
      if (name.length < 2) { await sendFail(chatId, 'tashkilot nomi juda qisqa', null, user); return }
      const loc = session.data.loc
      if (!loc) { await staleMsg(chatId, user); return }
      const districts = await districtsFor(user)
      if (districts.length === 0) { store.clear(chatId); await send(chatId, failText(NO_DISTRICT), kb(user)); return }
      if (districts.length === 1) {
        await afterDistrict(chatId, null, user, name, loc.lat, loc.lon, districts[0].id)
      } else {
        setS(chatId, 'new_entity_district', { nu: { name } })
        const rows = districts.slice(0, 30).map(d => [{ text: clip(d.name, 40), callback_data: `newdist:${d.id}` }])
        rows.push([{ text: 'Bekor', callback_data: 'cancel' }])
        await send(chatId, lines(head('ok', name), 'Qaysi tumanda joylashgan?'), { inline_keyboard: rows })
      }
      return
    }

    if (st === 'new_full_phone') {
      const digits = text.replace(/\D/g, '')
      if (digits.length < 7 || digits.length > 15) { await sendFail(chatId, "telefon noto'g'ri, masalan 901234567", null, user); return }
      setS(chatId, 'new_full_fee', { nu: session.data.nu, phone: text.slice(0, 30) })
      await send(chatId, lines(head('ok', 'Oylik to\'lov'), "Oylik to'lov summasini yozing (so'm), masalan 50000."), cancelRow)
      return
    }

    if (st === 'new_full_fee') {
      const a = parseBotAmount(text)
      if (!a.ok) { await sendFail(chatId, amountErrorText(a.reason), null, user); return }
      await createEntity(chatId, user, session.data.nu, { phone: session.data.phone || '', fee: a.value })
      return
    }

    if (st === 'plan_target') {
      const target = parsePlanTarget(text)
      if (target == null) { await sendFail(chatId, '1 dan 1000 gacha butun son yozing', null, user); return }
      const { inspectorId } = session.data.plan
      const insp = await inspectorAllowed(user, inspectorId)
      if (!insp) { store.clear(chatId); await sendFail(chatId, 'inspektor sizning tumaningizda emas', undefined, user); return }
      const date = parseDateOnly(todayUz())!
      await db.ekoHisobPlan.upsert({
        where: { inspectorId_date_type: { inspectorId, date, type: 'new_entity' } },
        create: { orgId: user.orgId, inspectorId, assignedById: user.id, date, targetCount: target, type: 'new_entity' },
        update: { targetCount: target, assignedById: user.id },
      })
      store.clear(chatId)
      await send(chatId, lines(head('ok', 'Plan berildi'), kv('Inspektor', esc(insp.name)), kv('Bugun', `${target} ta tashkilot`)), kb(user))
      return
    }

    if (st === 'entity_search') {
      if (noDistricts(user)) { await send(chatId, failText(NO_DISTRICT), kb(user)); return }
      const found = await searchEntities(scopeOf(user), text)
      if (found.length === 0) {
        await send(chatId, lines(head('warn', 'Topilmadi'), `"${esc(clip(text, 40))}" bo'yicha tashkilot yo'q. Nom, STIR, kod yoki telefon yozing.`), cancelRow)
        return
      }
      const rows = entityButtons(found.map((e: any) => ({
        id: e.id, label: e.name + (e.stir ? ` · STIR ${e.stir}` : e.code ? ` · ${e.code}` : ''),
      })))
      rows.push([{ text: 'Bekor', callback_data: 'cancel' }])
      const t = lines(head('ok', `Natijalar: ${found.length} ta`), `So'rov: ${esc(clip(text, 40))}`)
      const markup = { inline_keyboard: rows }
      setS(chatId, 'search_result', { lastList: { text: t, reply_markup: markup } })
      await send(chatId, t, markup)
      return
    }

    if (st === 'talon_volume') {
      const volume = parseCubeVolume(text)
      if (volume == null) { await sendFail(chatId, "kub 0 dan katta va 1000 dan oshmagan son bo'lsin, masalan 3.5", null, user); return }
      const acc = await loadEntityFor(user, session.data.talon.entityId)
      if (!acc.ok) { store.clear(chatId); await sendFail(chatId, acc.reason === 'forbidden' ? FORBIDDEN_ENTITY : 'tashkilot topilmadi', undefined, user); return }
      const price = acc.entity.cubicPrice || 0
      const amount = computeTalonAmount(volume, price)
      if (price <= 0 || amount <= 0) { store.clear(chatId); await sendFail(chatId, 'bir kub narxi belgilanmagan', undefined, user); return }
      const talon = await db.ekoHisobTalon.create({
        data: { entityId: acc.entity.id, orgId: user.orgId, volume, amount, date: parseDateOnly(todayUz())!, createdBy: user.id, paid: false },
        select: { id: true },
      })
      await logEkoAudit(actorOf(user), {
        action: 'talon.create', targetType: 'talon', targetId: talon.id, targetName: acc.entity.name, amount,
        details: { volume, cubicPrice: price, source: 'bot' },
      })
      store.clear(chatId)
      await send(chatId, lines(head('ok', "Talon qo'shildi"), kv('Tashkilot', esc(acc.entity.name)),
        kv('Hajm', `${volume} m³ × ${sum(price)}`), kv('Summa', `<b>${sum(amount)}</b>`), 'Qarzga qo\'shildi.'), kb(user))
      return
    }

    if (st === 'pay_amount') {
      const d = payDraftOf(chatId)
      if (!d || d.status === 'done') { await staleMsg(chatId, user); return }
      const a = parseBotAmount(text)
      if (!a.ok) { await sendFail(chatId, amountErrorText(a.reason), null, user); return }
      const nd = setAmount(d, a.value, () => `bot-${randomUUID()}`)
      keepPay(chatId, 'pay_confirm', nd)
      await showConfirm(chatId, null, nd)
      return
    }

    if (st === 'np_reason' || st === 'np_text') {
      const np = npOf(chatId)
      if (!np) { await staleMsg(chatId, user); return }
      const reason = clip(text.replace(/\s+/g, ' '), 300)
      if (reason.length < 3) { await sendFail(chatId, 'sabab juda qisqa', null, user); return }
      np.reason = reason
      await showNpExtra(chatId, null)
      return
    }

    if (st === 'np_date') {
      const np = npOf(chatId)
      if (!np) { await staleMsg(chatId, user); return }
      const iso = parsePromiseText(text)
      if (!iso) { await sendFail(chatId, "sana noto'g'ri, kun.oy.yil ko'rinishida yozing, masalan 25.11.2026", null, user); return }
      np.promisedDate = iso
      const parsed = validateVisit({ reason: np.reason, promisedDate: iso, photoFileId: np.photoFileId, lat: null, lon: null }, todayUz())
      if (!parsed.ok) { await sendFail(chatId, parsed.error, null, user); return }
      await saveVisit(chatId, null, user)
      return
    }

    // Matn kutilmagan holat
    await send(chatId, 'Tushunmadim, menyudan tanlang.', kb(user))
  }))
}

export async function initEkoFieldBot(): Promise<void> {
  const token = process.env.EKO_FIELD_BOT_TOKEN
  if (!token) {
    console.warn("EKO_FIELD_BOT_TOKEN belgilanmagan — EkoHisob dala-bot o'chirilgan.")
    return
  }
  try {
    ekoFieldBot = new TelegramBot(token, { polling: true })
    const me = await ekoFieldBot.getMe()
    ekoBotUsername = me.username ?? null
    console.log(`EkoHisob dala-bot ishga tushdi: @${me.username}`)
    if (!ekoWebAppUrl()) {
      console.warn("[EkoBot] EKO_WEBAPP_URL/FRONTEND_URL (https) sozlanmagan — Xarita/Qarzdorlar mini-ilova tugmalari ko'rsatilmaydi.")
    }
    let lastPollErr = 0
    ekoFieldBot.on('polling_error', (e: any) => {
      if (Date.now() - lastPollErr > 60_000) { lastPollErr = Date.now(); console.error('[EkoBot] polling_error:', e?.code ?? '', e?.message ?? e) }
    })
    ekoFieldBot.on('error', (e: any) => console.error('[EkoBot] error:', e?.message ?? e))
    ekoFieldBot.setMyCommands([
      { command: 'bugun', description: "Bugungi ro'yxat" },
      { command: 'qidirish', description: 'Tashkilot qidirish' },
      { command: 'hisobotim', description: 'Mening hisobotim' },
      { command: 'yordam', description: 'Yordam' },
      { command: 'til', description: 'Til / Тил' },
    ]).catch(() => {})
    registerEkoHandlers(ekoFieldBot)
  } catch (err: any) {
    console.error('EkoHisob dala-bot ishga tushmadi:', err?.message ?? err)
    ekoFieldBot = null
  }
}
