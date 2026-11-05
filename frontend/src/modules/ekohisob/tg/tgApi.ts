import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

/**
 * Telegram mini ilova uchun API qatlami.
 *
 * Nega `ekoApi` emas: u 401 da `/ekohisob/login` ga yo'naltiradi va asosiy
 * AutoHisob tokenini ustun qo'yadi — Telegram ichida login sahifasi yo'q.
 * Bu yerda token faqat xotirada turadi; muddati tugasa (401) Telegram initData
 * bilan ovoz chiqarmasdan qayta kiriladi va so'rov takrorlanadi.
 */

const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/ekohisob'

export interface TgUser {
  id: string
  fullName: string
  role: 'admin' | 'inspector' | 'supervisor' | string
  districtIds: string[]
}

let token: string | null = null
let loginPromise: Promise<TgUser> | null = null

export const tgApi = axios.create({ baseURL, timeout: 30000 })

tgApi.interceptors.request.use(config => {
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

tgApi.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    if (error.response?.status === 401 && config && !config._retried) {
      config._retried = true
      try {
        await tgLogin()
        return tgApi(config)
      } catch { /* qayta kirish ham o'tmadi — asl xatoni qaytaramiz */ }
    }
    return Promise.reject(error)
  },
)

/** Telegram WebApp SDK ni bir marta yuklaydi. */
export function loadTelegramSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    const existing = (window as any).Telegram?.WebApp
    if (existing) { resolve(existing); return }
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-web-app.js'
    s.onload = () => {
      const tg = (window as any).Telegram?.WebApp
      tg ? resolve(tg) : reject(new Error('no-tg'))
    }
    s.onerror = () => reject(new Error('sdk-fail'))
    document.body.appendChild(s)
  })
}

/** Telegram initData bilan kirish (bir vaqtda bir nechta chaqiruv bitta so'rovga birlashadi). */
export function tgLogin(): Promise<TgUser> {
  if (loginPromise) return loginPromise
  loginPromise = (async () => {
    const tg = await loadTelegramSdk()
    const initData: string = tg.initData || ''
    if (!initData) throw new Error('NOT_IN_TELEGRAM')
    const res = await axios.post(`${baseURL}/tg/auth`, { initData }, { timeout: 30000 })
    token = res.data.data.token
    return res.data.data.user as TgUser
  })().finally(() => { loginPromise = null })
  return loginPromise
}

/** Xato xabarini matnga aylantiradi (tarmoq xatosi alohida). */
export function tgErrorMessage(e: any, fallback = 'Xato yuz berdi'): string {
  if (e?.message === 'NOT_IN_TELEGRAM') return 'Bu ilova faqat Telegram bot ichida ochiladi.'
  if (!e?.response) return "Aloqa yo'q. Internetni tekshirib, qayta urinib ko'ring."
  return e.response.data?.error || fallback
}
