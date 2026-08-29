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
  // Qaysi token ishlatilganini eslab qolamiz — asosiy token 401 bersa-yu,
  // alohida Savdo tokeni ham bo'lsa, darhol chiqarib yubormasdan o'shani
  // sinab ko'ramiz (brauzerda eskirgan asosiy token qolib ketishi mumkin).
  ;(config as any)._usedMainToken = Boolean(mainToken) && token === mainToken
  return config
})

async function finalizeAuthFailure() {
  localStorage.removeItem('savdo_token')
  try {
    const { useSavdoAuthStore } = await import('../stores/savdoAuthStore')
    useSavdoAuthStore.getState().logout()
  } catch {}
  const mainToken = localStorage.getItem('accessToken')
  window.location.href = mainToken ? '/login' : '/savdo/login'
}

savdoApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    const config = error.config
    if (error.response?.status === 401 && config && !config._retriedWithSavdoToken) {
      const savdoToken = localStorage.getItem('savdo_token')
      if (config._usedMainToken && savdoToken) {
        config._retriedWithSavdoToken = true
        config.headers.Authorization = `Bearer ${savdoToken}`
        try {
          return await savdoApi(config)
        } catch (retryErr) {
          await finalizeAuthFailure()
          return Promise.reject(retryErr)
        }
      }
      await finalizeAuthFailure()
    }
    return Promise.reject(error)
  }
)

export default savdoApi
