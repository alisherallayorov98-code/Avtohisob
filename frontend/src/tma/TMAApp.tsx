import { useEffect, useState } from 'react'
import axios from 'axios'
import TMAHome from './screens/TMAHome'
import TMAWaybills from './screens/TMAWaybills'
import TMANotify from './screens/TMANotify'
import TMAManager from './screens/TMAManager'
import { Home, ClipboardList, Bell, BarChart3 } from 'lucide-react'

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready(): void
        expand(): void
        close(): void
        initData: string
        initDataUnsafe: { user?: { id: number; first_name: string } }
        themeParams: Record<string, string>
        colorScheme: 'light' | 'dark'
        MainButton: { setText(t: string): void; show(): void; hide(): void; onClick(fn: () => void): void }
        BackButton: { show(): void; hide(): void; onClick(fn: () => void): void }
        HapticFeedback: { impactOccurred(style: string): void }
      }
    }
  }
}

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

type Tab = 'home' | 'waybills' | 'notify' | 'manager'

const MANAGER_ROLES = ['super_admin', 'admin', 'manager', 'branch_manager']

interface User { id: string; fullName: string; role: string; branchId: string | null }

export default function TMAApp() {
  const [tab, setTab] = useState<Tab>('home')
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const tg = window.Telegram?.WebApp

  useEffect(() => {
    tg?.ready()
    tg?.expand()
    authenticate()
  }, [])

  async function authenticate() {
    try {
      const initData = tg?.initData
      if (!initData) {
        // Dev fallback: check stored token
        const stored = localStorage.getItem('tma_token')
        if (stored) {
          const res = await axios.get(`${BASE_URL}/tma/me`, {
            headers: { Authorization: `Bearer ${stored}` },
          })
          setUser(res.data)
          setLoading(false)
          return
        }
        setError("Telegram Web App'dan oching")
        setLoading(false)
        return
      }

      const res = await axios.post(`${BASE_URL}/tma/auth`, { initData })
      localStorage.setItem('tma_token', res.data.token)
      setUser(res.data.user)
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Autentifikatsiya xatosi'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const token = localStorage.getItem('tma_token') || ''
  const api = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--tg-theme-bg-color,#fff)]">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-[var(--tg-theme-bg-color,#fff)]">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-lg font-semibold text-red-600 mb-2">Xato</p>
        <p className="text-sm text-gray-600">{error}</p>
        {error.includes("bog'lanmagan") && (
          <p className="mt-3 text-xs text-gray-400">
            Botga /start buyrug'ini yuboring va hisobingizni ulang
          </p>
        )}
      </div>
    )
  }

  const isManager = MANAGER_ROLES.includes(user?.role || '')

  const navItems: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'home',     label: 'Asosiy',    icon: Home },
    { id: 'waybills', label: 'Yo\'llanma', icon: ClipboardList },
    { id: 'notify',   label: 'Xabarlar',  icon: Bell },
    ...(isManager ? [{ id: 'manager' as Tab, label: 'Nazorat', icon: BarChart3 }] : []),
  ]

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{
        background: 'var(--tg-theme-bg-color, #f5f5f5)',
        color: 'var(--tg-theme-text-color, #000)',
      }}
    >
      {/* Header */}
      <header
        className="px-4 py-3 flex items-center gap-2 border-b"
        style={{
          background: 'var(--tg-theme-secondary-bg-color, #fff)',
          borderColor: 'var(--tg-theme-hint-color, #ddd)',
        }}
      >
        <img src="/icons/icon.svg" alt="" className="w-7 h-7 rounded-md" />
        <div>
          <div className="font-semibold text-sm leading-tight">AvtoHisob</div>
          <div className="text-xs opacity-60">{user?.fullName}</div>
        </div>
      </header>

      {/* Screen */}
      <main className="flex-1 overflow-y-auto pb-16">
        {tab === 'home'     && <TMAHome     api={api} user={user!} tg={tg} />}
        {tab === 'waybills' && <TMAWaybills api={api} user={user!} tg={tg} />}
        {tab === 'notify'   && <TMANotify   api={api} user={user!} tg={tg} />}
        {tab === 'manager'  && <TMAManager  api={api} user={user!} tg={tg} />}
      </main>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 border-t flex"
        style={{
          background: 'var(--tg-theme-secondary-bg-color, #fff)',
          borderColor: 'var(--tg-theme-hint-color, #ddd)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => {
              tg?.HapticFeedback?.impactOccurred('light')
              setTab(item.id)
            }}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors"
            style={{
              color: tab === item.id
                ? 'var(--tg-theme-button-color, #3b82f6)'
                : 'var(--tg-theme-hint-color, #999)',
            }}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
