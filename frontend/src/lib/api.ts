import axios from 'axios'
import toast from 'react-hot-toast'

export const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '')

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

    return Promise.reject(error)
  }
)

export default api
