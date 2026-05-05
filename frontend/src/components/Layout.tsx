import { Outlet, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import Sidebar from './Sidebar'
import Header from './Header'
import CommandPalette from './CommandPalette'
import PWAInstallPrompt from './PWAInstallPrompt'
import SubscriptionBanner from './SubscriptionBanner'
import TermsBanner from './TermsBanner'
import OnboardingTour from './OnboardingTour'
import { getSocket } from '../lib/socket'

interface FuelAnomalyEvent {
  vehicleId: string
  registrationNumber: string
  anomaly: 'theft' | 'unrecorded_refuel'
  deltaL: number | null
  level: number
  driverName: string | null
  capturedAt: string
}

export default function Layout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
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

  // ── Real-time fuel anomaliya toast (sliv/qayd etilmagan zapravka) ──────
  // Telegram'dan tashqari, sayt ochiq bo'lgan paytda darhol ekranda
  // ko'rinadi. Audio signal ham bor (ihtibarni tortish uchun).
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleAnomaly = (e: FuelAnomalyEvent) => {
      const isTheft = e.anomaly === 'theft'
      const title = isTheft ? '🚨 SLIV ehtimoli' : '⚠️ Qayd etilmagan zapravka'
      const liters = e.deltaL != null ? `${Math.abs(e.deltaL).toFixed(1)} L` : ''
      const driverPart = e.driverName ? ` · 👤 ${e.driverName}` : ''

      // Beep ovozi (qisqa sintetik signal — ekstra fayl yuklamaslik uchun)
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = isTheft ? 880 : 660
        gain.gain.setValueAtTime(0.15, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
        osc.start(); osc.stop(ctx.currentTime + 0.4)
      } catch { /* AudioContext bloklangan bo'lsa indamay o'tib ketamiz */ }

      // Toast — bosib /fuel-monitoring ga o'tish mumkin
      toast(
        (t) => (
          <div onClick={() => { toast.dismiss(t.id); navigate('/fuel-monitoring') }} className="cursor-pointer flex items-start gap-3">
            <div className="text-2xl flex-shrink-0">{isTheft ? '🚨' : '⚠️'}</div>
            <div className="flex-1 min-w-0">
              <div className={`font-bold ${isTheft ? 'text-rose-700' : 'text-amber-700'}`}>{title}</div>
              <div className="text-sm text-gray-700 mt-0.5">
                <span className="font-semibold">{e.registrationNumber}</span>
                {liters && <span> · {liters}</span>}
                {driverPart}
              </div>
              <div className="text-xs text-blue-600 mt-1">Bak nazoratiga o'tish →</div>
            </div>
          </div>
        ),
        {
          duration: 12_000,
          style: {
            background: isTheft ? '#fef2f2' : '#fffbeb',
            border: `2px solid ${isTheft ? '#fca5a5' : '#fcd34d'}`,
            maxWidth: '420px',
          },
        },
      )
    }

    socket.on('fuel:anomaly', handleAnomaly)
    return () => { socket.off('fuel:anomaly', handleAnomaly) }
  }, [navigate])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <SubscriptionBanner />
        {isOffline && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            {t('errors.offline')}
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <PWAInstallPrompt />
      <TermsBanner />
      <OnboardingTour />
    </div>
  )
}
