import axios, { AxiosError } from 'axios'
import toast from 'react-hot-toast'

export const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '')

/**
 * Backend'dan kelgan fayl yo'lini to'liq URL ga aylantiradi.
 * /uploads/... → {apiBaseUrl}/api/uploads/... (nginx /api/ proxyi orqali o'tadi)
 */
export function getFileUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return `${apiBaseUrl}/api${path}`
}

/** Backend standart xato response shape: { error: string } yoki { message: string } */
export type ApiError = AxiosError<{ error?: string; message?: string }>

/** Axios xatosidan foydalanuvchiga ko'rsatiladigan matnni ajratib oladi */
export function apiErrorMessage(err: unknown, fallback = 'Xato yuz berdi'): string {
  const e = err as ApiError
  return e?.response?.data?.error || e?.response?.data?.message || e?.message || fallback
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Refresh mutex ─────────────────────────────────────────────────────────────
// Prevents multiple simultaneous 401s from each firing a separate refresh.
// All concurrent retries share the single in-flight refresh promise.
let _refreshPromise: Promise<string | null> | null = null

async function doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return null
  try {
    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '')
    const res = await axios.post('/api/auth/refresh-token', { refreshToken }, { baseURL: apiBase })
    const { accessToken, refreshToken: newRefresh } = res.data.data
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', newRefresh)
    return accessToken
  } catch {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    return null
  }
}

function getOrStartRefresh(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => { _refreshPromise = null })
  }
  return _refreshPromise
}

// ── Subscription toast dedup ──────────────────────────────────────────────────
let _subToastShown = false
function showSubscriptionToast(msg: string) {
  if (_subToastShown) return
  _subToastShown = true
  toast.error(msg, { duration: 6000, id: 'subscription-limit', icon: '🔒' })
  setTimeout(() => { _subToastShown = false }, 8000)
}

// ── Server error toast dedup ──────────────────────────────────────────────────
// 500/502/503/504 uchun bitta toast — takroriy so'rovlar spam qilmasin
const _serverErrorShown: Record<string, number> = {}
function showServerErrorToast(msg: string, code: number) {
  const key = `${code}:${msg}`
  const last = _serverErrorShown[key] || 0
  if (Date.now() - last < 60_000) return // 1 daqiqada bir marta
  _serverErrorShown[key] = Date.now()
  toast.error(msg, { duration: 5000, id: `server-err-${code}` })
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    // 401 → refresh token (mutex: only one refresh in-flight at a time)
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const newToken = await getOrStartRefresh()
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      }
      // Silent redirect — foydalanuvchiga xato toast ko'rsatmaymiz
      window.location.href = '/login'
      return Promise.reject(error)
    }

    // 403 from subscription guard → show upgrade prompt
    if (error.response?.status === 403) {
      const msg: string = error.response?.data?.error || ''
      const isSubscriptionError =
        msg.includes('tarif') || msg.includes('funksiyasi') || msg.includes('chegarasi') || msg.includes('tarifda')
      if (isSubscriptionError) {
        showSubscriptionToast(msg + ' → Obuna va to\'lov')
      }
    }

    // 5xx server xatolari → global dedup toast
    const status = error.response?.status
    if (status && status >= 500 && status < 600) {
      const msg = error.response?.data?.error || error.response?.data?.message || 'Server xatosi yuz berdi'
      showServerErrorToast(msg, status)
    }

    return Promise.reject(error)
  }
)

export default api
