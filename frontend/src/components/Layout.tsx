import { Outlet } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import Sidebar from './Sidebar'
import Header from './Header'
import CommandPalette from './CommandPalette'
import PWAInstallPrompt from './PWAInstallPrompt'
import SubscriptionBanner from './SubscriptionBanner'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline  = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online',  goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online',  goOnline)
    }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <SubscriptionBanner />
        {isOffline && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            Internet aloqasi uzildi. Ma'lumotlar yangilanmayapti.
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <PWAInstallPrompt />
    </div>
  )
}
