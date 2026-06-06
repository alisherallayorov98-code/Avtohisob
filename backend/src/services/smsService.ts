/**
 * SMS xizmati — Eskiz.uz (O'zbekiston) orqali.
 * ESKIZ_EMAIL va ESKIZ_PASSWORD env'da bo'lsa real SMS yuboradi.
 * Bo'lmasa — dev-rejim: kod konsolga yoziladi va javobda qaytadi (test uchun).
 */

const ESKIZ_BASE = 'https://notify.eskiz.uz/api'

let _token: string | null = null
let _tokenExpiry = 0

function isConfigured(): boolean {
  return !!(process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD)
}

// Eskiz token olish (30 kun yashaydi, lekin biz har kun yangilaymiz)
async function getToken(): Promise<string | null> {
  if (!isConfigured()) return null
  if (_token && Date.now() < _tokenExpiry) return _token
  try {
    const body = new URLSearchParams({
      email: process.env.ESKIZ_EMAIL!,
      password: process.env.ESKIZ_PASSWORD!,
    })
    const res = await fetch(`${ESKIZ_BASE}/auth/login`, { method: 'POST', body })
    const data: any = await res.json()
    const token = data?.data?.token
    if (token) {
      _token = token
      _tokenExpiry = Date.now() + 24 * 60 * 60 * 1000 // 24 soat
      return token
    }
  } catch (e: any) {
    console.error('[SMS] Eskiz token xatosi:', e?.message)
  }
  return null
}

/**
 * SMS yuboradi. Telefon: "998901234567" formatida (faqat raqamlar).
 * Dev-rejimda (kalit yo'q) — false qaytaradi, chaqiruvchi kodni o'zi ko'rsatadi.
 */
export async function sendSms(phone: string, message: string): Promise<{ sent: boolean; devMode: boolean }> {
  const cleanPhone = phone.replace(/\D/g, '')

  if (!isConfigured()) {
    // Dev-rejim: SMS yuborilmaydi, kod log'da
    console.log(`[SMS DEV] ${cleanPhone}: ${message}`)
    return { sent: false, devMode: true }
  }

  const token = await getToken()
  if (!token) {
    console.error('[SMS] Token olinmadi')
    return { sent: false, devMode: false }
  }

  try {
    const body = new URLSearchParams({
      mobile_phone: cleanPhone,
      message,
      from: process.env.ESKIZ_FROM || '4546',
    })
    const res = await fetch(`${ESKIZ_BASE}/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    })
    const data: any = await res.json()
    if (data?.status === 'waiting' || data?.id || data?.message === 'Waiting for SMS provider') {
      return { sent: true, devMode: false }
    }
    console.error('[SMS] Yuborilmadi:', JSON.stringify(data))
    return { sent: false, devMode: false }
  } catch (e: any) {
    console.error('[SMS] Yuborish xatosi:', e?.message)
    return { sent: false, devMode: false }
  }
}

export function smsConfigured(): boolean {
  return isConfigured()
}
