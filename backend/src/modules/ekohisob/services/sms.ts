// Eskiz.uz SMS integratsiyasi — qarzdorlarga SMS eslatma yuborish uchun.
// ENV: ESKIZ_EMAIL, ESKIZ_PASSWORD, ESKIZ_FROM (alfa-nom, default '4546' test).
// Kalit yo'q bo'lsa servis "sozlanmagan" deb yumshoq xato qaytaradi (kod buzilmaydi).

const ESKIZ_BASE = 'https://notify.eskiz.uz/api'

// Token 30 kun amal qiladi — in-memory cache (25 kun xavfsizlik zaxirasi bilan).
let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * O'zbekiston telefon raqamini 998XXXXXXXXX formatiga keltiradi.
 * Qabul qiladi: "901234567", "+998 90 123 45 67", "998901234567" ...
 * Noto'g'ri bo'lsa null qaytaradi.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 9) return '998' + digits
  if (digits.length === 12 && digits.startsWith('998')) return digits
  return null
}

async function getToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const email = process.env.ESKIZ_EMAIL
  const password = process.env.ESKIZ_PASSWORD
  if (!email || !password) return null
  try {
    const form = new FormData()
    form.append('email', email)
    form.append('password', password)
    const res = await fetch(`${ESKIZ_BASE}/auth/login`, { method: 'POST', body: form })
    const json: any = await res.json().catch(() => ({}))
    const token = json?.data?.token
    if (!token) return null
    cachedToken = { value: token, expiresAt: Date.now() + 25 * 24 * 60 * 60 * 1000 }
    return token
  } catch {
    return null
  }
}

async function sendRequest(token: string, phone: string, message: string, from: string): Promise<globalThis.Response> {
  const form = new FormData()
  form.append('mobile_phone', phone)
  form.append('message', message)
  form.append('from', from)
  return fetch(`${ESKIZ_BASE}/message/sms/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
}

export interface SmsResult {
  ok: boolean
  msgId?: string
  error?: string
}

/**
 * Bitta SMS yuboradi. Eskiz kaliti yo'q bo'lsa { ok: false, error } qaytaradi.
 */
export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, error: 'Telefon raqami noto\'g\'ri' }

  let token = await getToken()
  if (!token) return { ok: false, error: 'SMS xizmati sozlanmagan (Eskiz kaliti yo\'q)' }

  const from = process.env.ESKIZ_FROM || '4546'
  try {
    let res = await sendRequest(token, normalized, message, from)
    // Token eskirgan bo'lsa — bir marta qayta login va qayta urinish
    if (res.status === 401) {
      cachedToken = null
      token = await getToken()
      if (!token) return { ok: false, error: 'SMS xizmati sozlanmagan' }
      res = await sendRequest(token, normalized, message, from)
    }
    const json: any = await res.json().catch(() => ({}))
    if (res.ok && (json?.id || json?.status === 'waiting' || json?.status === 'success')) {
      return { ok: true, msgId: json?.id != null ? String(json.id) : undefined }
    }
    return { ok: false, error: json?.message || `Eskiz xato (HTTP ${res.status})` }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'SMS yuborishda xato' }
  }
}

/** SMS xizmati sozlanganmi (kalit bor-yo'qligi) — UI uchun. */
export function isSmsConfigured(): boolean {
  return !!(process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD)
}
