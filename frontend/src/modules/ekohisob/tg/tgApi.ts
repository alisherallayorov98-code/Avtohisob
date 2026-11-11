import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { parseEkoError } from '../lib/ekoErrors'

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

/** So'rov muddati: yomon internetda osilib qolmasin (tarmoq xatosi sifatida ajratiladi). */
const TIMEOUT_MS = 20000

export const tgApi = axios.create({ baseURL, timeout: TIMEOUT_MS })

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
      } catch (reloginErr) {
        // Qayta kirish ham o'tmadi (initData eskirgan) — login sahifasi YO'Q, foydalanuvchi
        // mini ilovani qayta ochishi kerak. Asl xatoga belgi qo'yib qaytaramiz.
        ;(error as any).tgSessionExpired = true
        ;(error as any).tgReloginError = reloginErr
      }
    } else if (error.response?.status === 401) {
      ;(error as any).tgSessionExpired = true
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
    const res = await axios.post(`${baseURL}/tg/auth`, { initData }, { timeout: TIMEOUT_MS })
    token = res.data.data.token
    return res.data.data.user as TgUser
  })().finally(() => { loginPromise = null })
  return loginPromise
}

/** 401 (sessiya) — Telegram mini ilovada alohida matn. */
export function isSessionExpired(e: unknown): boolean {
  const x = e as any
  return Boolean(x?.tgSessionExpired) || x?.response?.status === 401
}

/** Tarmoq xatosimi (aloqa yo'q / vaqt tugadi) — to'lov "noaniq" holati shu bilan hal qilinadi. */
export function isNetworkError(e: unknown): boolean {
  return parseEkoError(e).network
}

/** Xato xabarini matnga aylantiradi: tarmoq, sessiya va backend kodlari alohida. */
export function tgErrorMessage(e: any, fallback = 'Xato yuz berdi'): string {
  if (e?.message === 'NOT_IN_TELEGRAM') return 'Bu ilova faqat Telegram bot ichida ochiladi.'
  if (isSessionExpired(e)) return 'Sessiya tugagan, mini ilovani qayta oching'
  const info = parseEkoError(e)
  if (info.network) return info.message
  // Umumiy "Bajarilmadi" o'rniga ekran o'z matnini bersin
  if (!info.code && !e?.response?.data?.error && info.status !== 403 && info.status !== 404 && info.status !== 429 && !(info.status && info.status >= 500)) {
    return fallback
  }
  return info.message
}
