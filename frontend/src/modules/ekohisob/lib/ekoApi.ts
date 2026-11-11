import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/ekohisob'

const ekoApi = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

ekoApi.interceptors.request.use((config) => {
  // Avval asosiy AutoHisob token (ekohisob_user roli), keyin eski eko token
  const mainToken = localStorage.getItem('accessToken')
  const ekoToken  = localStorage.getItem('ekohisob_token')
  const token = mainToken || ekoToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** Vaqtincha parol almashtirish talab qilinganda (403 MUST_CHANGE_PASSWORD) EkoHisobApp tinglaydi. */
export const EKO_MUST_CHANGE_PASSWORD_EVENT = 'eko:must-change-password'

ekoApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error.response?.status
    const code = error.response?.data?.code
    const url: string = error.config?.url ?? ''

    // Login so'rovining o'zi 401 bersa (noto'g'ri parol) sahifani qayta yuklamaymiz —
    // xato matni formada ko'rinishi kerak.
    const isLoginCall = url.includes('/auth/login')

    if (status === 401 && !isLoginCall) {
      // SESSION_REVOKED (parol almashtirilgan, deaktiv qilingan, rol o'zgargan) yoki muddati o'tgan token
      localStorage.removeItem('ekohisob_token')
      try {
        const { useEkoAuthStore } = await import('../stores/ekoAuthStore')
        useEkoAuthStore.getState().logout()
      } catch {}
      // Asosiy token bilan kirgan bo'lsa — login sahifasiga
      const mainToken = localStorage.getItem('accessToken')
      window.location.href = mainToken ? '/login' : '/ekohisob/login'
    }

    if (status === 403 && code === 'MUST_CHANGE_PASSWORD') {
      window.dispatchEvent(new CustomEvent(EKO_MUST_CHANGE_PASSWORD_EVENT))
    }

    return Promise.reject(error)
  }
)

export default ekoApi
