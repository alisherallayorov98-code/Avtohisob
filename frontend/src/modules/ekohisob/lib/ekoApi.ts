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

ekoApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ekohisob_token')
      try {
        const { useEkoAuthStore } = await import('../stores/ekoAuthStore')
        useEkoAuthStore.getState().logout()
      } catch {}
      // Asosiy token bilan kirgan bo'lsa — login sahifasiga
      const mainToken = localStorage.getItem('accessToken')
      window.location.href = mainToken ? '/login' : '/ekohisob/login'
    }
    return Promise.reject(error)
  }
)

export default ekoApi
