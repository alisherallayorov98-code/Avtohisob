import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isAlreadyInstalled(): boolean {
  // Running as installed PWA (standalone window, no browser chrome)
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari standalone
  if ((navigator as any).standalone === true) return true
  // User previously accepted the install prompt
  if (localStorage.getItem('pwa_installed') === '1') return true
  return false
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(() =>
    !!localStorage.getItem('pwa_prompt_dismissed') || isAlreadyInstalled()
  )

  useEffect(() => {
    // Never show if already running as installed PWA
    if (isAlreadyInstalled()) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!deferredPrompt || dismissed) return null

  const handleInstall = async () => {
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      localStorage.setItem('pwa_installed', '1')
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    localStorage.setItem('pwa_prompt_dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-gray-900 dark:bg-gray-800 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3 border border-gray-700 animate-in slide-in-from-bottom-4">
      <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
        <Download className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">AutoHisob ilovasini o'rnating</p>
        <p className="text-xs text-gray-400 mt-0.5">Oflayn ishlatish va tezkor kirish</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleInstall}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          O'rnatish
        </button>
        <button
          onClick={handleDismiss}
          className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
          aria-label="Yopish"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
