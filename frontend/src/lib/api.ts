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

// Debounce subscription toast so it shows once, not on every parallel request
let _subToastShown = false
function showSubscriptionToast(msg: string) {
  if (_subToastShown) return
  _subToastShown = true
  toast.error(msg, {
    duration: 6000,
    id: 'subscription-limit',
    icon: '🔒',
  })
  setTimeout(() => { _subToastShown = false }, 8000)
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    // 401 → refresh token
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '')
          const res = await axios.post('/api/auth/refresh-token', { refreshToken }, { baseURL: apiBase })
          const { accessToken, refreshToken: newRefresh } = res.data.data
          localStorage.setItem('accessToken', accessToken)
          localStorage.setItem('refreshToken', newRefresh)
          original.headers.Authorization = `Bearer ${accessToken}`
          return api(original)
        } catch {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          window.location.href = '/login'
        }
      }
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
