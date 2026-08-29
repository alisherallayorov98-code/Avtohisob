import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/savdo'

const savdoApi = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

savdoApi.interceptors.request.use((config) => {
  // Avval asosiy AutoHisob token (admin soya-kirish), keyin o'z Savdo tokeni
  const mainToken = localStorage.getItem('accessToken')
  const savdoToken = localStorage.getItem('savdo_token')
  const token = mainToken || savdoToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

savdoApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('savdo_token')
      try {
        const { useSavdoAuthStore } = await import('../stores/savdoAuthStore')
        useSavdoAuthStore.getState().logout()
      } catch {}
      const mainToken = localStorage.getItem('accessToken')
      window.location.href = mainToken ? '/login' : '/savdo/login'
    }
    return Promise.reject(error)
  }
)

export default savdoApi
