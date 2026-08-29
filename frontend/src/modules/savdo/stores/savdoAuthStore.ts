import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import savdoApi from '../lib/savdoApi'

export interface SavdoUser {
  id: string
  email: string
  fullName: string
  role: 'admin' | 'manager' | 'cashier' | 'staff'
  orgId: string
  // Serverdagi lib/savdoPermissions.ts matritsasidan keladi (yagona manba).
  // Eski sessiyada bo'lmasligi mumkin — useSavdoPerms shunda hammasini ko'rsatadi.
  capabilities?: string[]
}

interface SavdoAuthState {
  user: SavdoUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  refreshMe: () => Promise<void>
  logout: () => void
}

export const useSavdoAuthStore = create<SavdoAuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await savdoApi.post('/auth/login', { email, password })
          const { user, token } = res.data.data ?? res.data
          localStorage.setItem('savdo_token', token)
          set({ user, token, isAuthenticated: true, isLoading: false })
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      // Rol/ruxsat o'zgargan bo'lishi mumkin (admin xodim rolini yangilagan) —
      // sahifa ochilganda imkoniyatlar serverdan qayta olinadi.
      refreshMe: async () => {
        try {
          const res = await savdoApi.get('/auth/me')
          const fresh = res.data.data ?? res.data
          set(state => (state.user ? { user: { ...state.user, ...fresh } } : {}))
        } catch {
          // jim: tarmoq xatosi kirishni buzmasin, savdoApi 401'ni o'zi hal qiladi
        }
      },

      logout: () => {
        localStorage.removeItem('savdo_token')
        set({ user: null, token: null, isAuthenticated: false })
      },
    }),
    {
      name: 'savdo-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
