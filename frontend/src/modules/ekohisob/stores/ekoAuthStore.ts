import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import ekoApi from '../lib/ekoApi'

export interface EkoUser {
  id: string
  email: string
  fullName: string
  role: 'admin' | 'inspector' | 'supervisor'
  orgId: string
  districtIds: string[]
  /** true bo'lsa vaqtincha parol — almashtirmaguncha boshqa so'rovlar 403 */
  mustChangePassword?: boolean
}

interface EkoAuthState {
  user: EkoUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<EkoUser>
  /** Parol almashtirilgach: yangi token + mustChangePassword=false */
  applyPasswordChanged: (token: string) => void
  logout: () => void
}

export const useEkoAuthStore = create<EkoAuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await ekoApi.post('/auth/login', { email, password })
          const { user, token } = res.data.data ?? res.data
          localStorage.setItem('ekohisob_token', token)
          set({ user, token, isAuthenticated: true, isLoading: false })
          return user as EkoUser
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      applyPasswordChanged: (token) => {
        localStorage.setItem('ekohisob_token', token)
        set((st) => ({
          token,
          user: st.user ? { ...st.user, mustChangePassword: false } : st.user,
        }))
      },

      logout: () => {
        localStorage.removeItem('ekohisob_token')
        set({ user: null, token: null, isAuthenticated: false })
      },
    }),
    {
      name: 'ekohisob-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
