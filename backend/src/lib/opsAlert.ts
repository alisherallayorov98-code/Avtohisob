// ═══════════════════════════════════════════════════════════════════════════
// Operatsion ogohlantirish kanali — MIJOZLARGA KO'RINMAYDIGAN, faqat egaga
// (sizga) xabar beradigan alohida kanal. Mavjud 4 ta mijoz-yo'naltirilgan
// botdan (telegramBot, driverBot, ekoFieldBot, careBot) MUSTAQIL — ular bilan
// bir xil chatId'ga yozib yubormaydi, alohida bot token/chat ishlatadi.
//
// XAVFSIZLIK: bu modul faqat O'QIYDI (DB'dan sonlarni sanash) va tashqariga
// XABAR yuboradi. Hech qanday yozish/o'chirish amali yo'q. Env sozlanmagan
// bo'lsa butunlay jim (no-op) — mavjud funksionallikka ta'sir qilmaydi.
//
// Sozlash (.env): OPS_ALERT_BOT_TOKEN, OPS_ALERT_CHAT_ID
// (BotFather'dan yangi bot yarating, unga /start yozing, chat_id'ni
//  https://api.telegram.org/bot<TOKEN>/getUpdates orqali oling)
// ═══════════════════════════════════════════════════════════════════════════

const TELEGRAM_API = 'https://api.telegram.org'

function isConfigured(): boolean {
  return !!(process.env.OPS_ALERT_BOT_TOKEN && process.env.OPS_ALERT_CHAT_ID)
}

/** Xom xabar yuborish — ichki, hech qachon throw qilmaydi. */
async function send(text: string): Promise<void> {
  if (!isConfigured()) return
  try {
    const token = process.env.OPS_ALERT_BOT_TOKEN
    const chatId = process.env.OPS_ALERT_CHAT_ID
    const url = `${TELEGRAM_API}/bot${token}/sendMessage`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (e) {
    // Alert yuborilmasa ham serverni to'xtatmaymiz — faqat lokal logga yozamiz
    console.warn('[opsAlert] yuborilmadi:', (e as any)?.message ?? e)
  }
}

// ── 5xx xato alerti: bir xil xato N daqiqada bitta marta (spam bo'lmasin) ──
const lastSentAt = new Map<string, number>()
const DEDUPE_WINDOW_MS = 15 * 60 * 1000 // 15 daqiqa

// Kunlik xulosa uchun hisoblagich — Telegram'ga yuborilmagan (dedupe qilingan)
// xatolar ham shu yerda sanaladi, shunda xulosa haqiqiy hajmni ko'rsatadi.
// Har kunlik digest yuborilganda 0 ga qaytadi (getAndResetErrorCount).
let errorCountSinceDigest = 0

/**
 * Kutilmagan server xatosi haqida xabar beradi. errorHandler'dan chaqiriladi.
 * Fire-and-forget — javobni bloklamaydi, xato tashlamaydi.
 */
export function alertServerError(method: string, path: string, message: string): void {
  errorCountSinceDigest++
  if (!isConfigured()) return
  const key = `${method} ${path} :: ${message}`.slice(0, 200)
  const now = Date.now()
  const last = lastSentAt.get(key)
  if (last && now - last < DEDUPE_WINDOW_MS) return
  lastSentAt.set(key, now)
  // Xotira sizmasin — vaqti-vaqti bilan eski kalitlarni tozalaymiz
  if (lastSentAt.size > 500) {
    for (const [k, t] of lastSentAt) if (now - t > DEDUPE_WINDOW_MS) lastSentAt.delete(k)
  }
  const text = `🔴 <b>Server xatosi</b>\n<code>${escapeHtml(method)} ${escapeHtml(path)}</code>\n${escapeHtml(message).slice(0, 500)}`
  void send(text)
}

/** Oxirgi digest'dan beri necha marta 5xx bo'lganini qaytaradi va hisoblagichni 0 ga qaytaradi. */
export function getAndResetErrorCount(): number {
  const n = errorCountSinceDigest
  errorCountSinceDigest = 0
  return n
}

/** Kunlik/qo'lda xulosa xabari — scheduler chaqiradi. */
export function alertDigest(text: string): void {
  void send(text)
}

/** Qo'lda tekshirish uchun: sozlangan-sozlanmaganini bilish (masalan startup logda). */
export function opsAlertStatus(): string {
  return isConfigured() ? 'yoqilgan' : "sozlanmagan (OPS_ALERT_BOT_TOKEN/OPS_ALERT_CHAT_ID yo'q)"
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
