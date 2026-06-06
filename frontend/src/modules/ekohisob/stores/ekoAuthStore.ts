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
}

interface EkoAuthState {
  user: EkoUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string, orgId: string) => Promise<void>
  logout: () => void
}

export const useEkoAuthStore = create<EkoAuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password, orgId) => {
        set({ isLoading: true })
        try {
          const res = await ekoApi.post('/auth/login', { email, password, orgId })
          const { user, token } = res.data.data ?? res.data
          localStorage.setItem('ekohisob_token', token)
          set({ user, token, isAuthenticated: true, isLoading: false })
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
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
