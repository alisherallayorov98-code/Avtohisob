import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/ekohisob'

const ekoApi = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

ekoApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('ekohisob_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

ekoApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ekohisob_token')
      // Dynamically import store to avoid circular deps
      try {
        const { useEkoAuthStore } = await import('../stores/ekoAuthStore')
        useEkoAuthStore.getState().logout()
      } catch {
        // fallback: just clear storage
      }
      window.location.href = '/ekohisob/login'
    }
    return Promise.reject(error)
  }
)

export default ekoApi
