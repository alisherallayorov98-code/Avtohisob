import { Menu, LogOut, User, ChevronDown, Sun, Moon, Globe, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import { USER_ROLES } from '../lib/utils'
import NotificationBell from './NotificationBell'
import TelegramLinkModal from './TelegramLinkModal'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'

interface Props { onMenuClick: () => void }

const LANGS = [
  { code: 'uz', label: "O'zbek" },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
]

export default function Header({ onMenuClick }: Props) {
  const { user, logout } = useAuthStore()
  const { isDark, toggle } = useThemeStore()
  const { i18n } = useTranslation()
  const [dropOpen, setDropOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [telegramOpen, setTelegramOpen] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      // Unregister service worker and clear caches
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    } finally {
      window.location.reload()
    }
  }

  const handleLogout = async () => {
    try { await api.post('/auth/logout') } catch {}
    logout()
    setDropOpen(false)
  }

  return (
    <>
    <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button
          onClick={handleRefresh}
          title="Yangilash (kesh tozalash)"
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <div className="hidden lg:block">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {user?.branch?.name || 'Barcha Filiallar'}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* Language Switcher */}
        <div className="relative">
          <button
            onClick={() => setLangOpen(o => !o)}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1"
          >
            <Globe className="w-4 h-4" />
            <span className="text-xs font-medium uppercase hidden sm:block">{i18n.language.slice(0, 2)}</span>
          </button>
          {langOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-100 dark:border-gray-700 z-20 py-1">
                {LANGS.map(l => (
                  <button
                    key={l.code}
                    onClick={() => { i18n.changeLanguage(l.code); setLangOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 ${i18n.language === l.code ? 'font-bold text-blue-600 dark:text-blue-400' : ''}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggle}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <NotificationBell />

        {/* User dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropOpen(!dropOpen)}
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-medium text-gray-900 dark:text-white">{user?.fullName}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{USER_ROLES[user?.role || ''] || user?.role}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400 hidden sm:block" />
          </button>

          {dropOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-100 dark:border-gray-700 z-20 py-1">
                <button
                  onClick={() => { setTelegramOpen(true); setDropOpen(false) }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                >
                  <Send className="w-4 h-4" />
                  Telegram ulash
                </button>
                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <LogOut className="w-4 h-4" />
                  Chiqish
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>

    <TelegramLinkModal open={telegramOpen} onClose={() => setTelegramOpen(false)} />
    </>
  )
}
