import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../lib/api'
import { connectSocket, disconnectSocket } from '../lib/socket'

interface User {
  id: string
  email: string
  fullName: string
  role: string
  branchId: string | null
  branch?: { id: string; name: string } | null
  isActive: boolean
  emailVerified?: boolean
  twoFactorEnabled?: boolean
}

interface AuthState {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
  isAdmin: () => boolean
  isManager: () => boolean
  isBranchManager: () => boolean
  hasRole: (...roles: string[]) => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await api.post('/auth/login', { email, password })
          const { user, accessToken, refreshToken } = res.data.data
          localStorage.setItem('accessToken', accessToken)
          localStorage.setItem('refreshToken', refreshToken)
          set({ user, accessToken, isAuthenticated: true, isLoading: false })
          connectSocket(accessToken)
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      logout: () => {
        const refreshToken = localStorage.getItem('refreshToken')
        // Blacklist both tokens server-side (fire-and-forget)
        api.post('/auth/logout', { refreshToken }).catch(() => {})
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        disconnectSocket()
        set({ user: null, accessToken: null, isAuthenticated: false })
      },

      fetchMe: async () => {
        try {
          const res = await api.get('/auth/me')
          set({ user: res.data.data, isAuthenticated: true })
          const token = localStorage.getItem('accessToken')
          if (token) connectSocket(token)
        } catch {
          get().logout()
        }
      },

      isAdmin: () => get().user?.role === 'admin',
      isManager: () => ['admin', 'manager'].includes(get().user?.role || ''),
      isBranchManager: () => get().user?.role === 'branch_manager',
      hasRole: (...roles) => roles.includes(get().user?.role || ''),
    }),
    { name: 'auth-store', partialize: (state) => ({ user: state.user, accessToken: state.accessToken, isAuthenticated: state.isAuthenticated }) }
  )
)
