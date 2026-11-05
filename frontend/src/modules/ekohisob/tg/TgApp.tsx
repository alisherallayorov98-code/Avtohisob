import { useEffect, useState } from 'react'
import { Map as MapIcon, Users, Loader2, Smartphone, Trophy } from 'lucide-react'
import { tgLogin, loadTelegramSdk, tgErrorMessage, TgUser } from './tgApi'
import TgMapTab from './TgMapTab'
import TgDebtorsTab from './TgDebtorsTab'
import TgKpiTab from './TgKpiTab'
import TgEntitySheet from './TgEntitySheet'
import '../ui/tokens.css'

type Tab = 'map' | 'debtors' | 'kpi'

const TABS: Array<{ key: Tab; label: string; icon: typeof MapIcon }> = [
  { key: 'map', label: 'Xarita', icon: MapIcon },
  { key: 'debtors', label: 'Qarzdorlar', icon: Users },
  { key: 'kpi', label: 'KPI', icon: Trophy },
]

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab')
  return t === 'debtors' ? 'debtors' : t === 'kpi' ? 'kpi' : 'map'
}

/**
 * EkoHisob mini ilovasi (Telegram Web App).
 * Kirish — Telegram imzosi orqali (login/parol yo'q). Bot "📱 Ilova" tugmasi ochadi.
 * Tablar: Xarita (qidiruv, filtr, o'z joylashuvim), Qarzdorlar. Tashkilot ustiga bosilsa —
 * varaq: qarz, qo'ng'iroq, yo'nalish, to'lov yozish.
 */
export default function TgApp() {
  const [user, setUser] = useState<TgUser | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>(initialTab)
  const [openId, setOpenId] = useState<string | null>(null)
  // Varaq ichida to'lov yozilsa ro'yxat/xarita yangilansin
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tg = await loadTelegramSdk()
        tg.ready?.()
        tg.expand?.()
        // Xaritani surganda ilova yopilib ketmasin
        tg.disableVerticalSwipes?.()
        const u = await tgLogin()
        if (!cancelled) setUser(u)
      } catch (e) {
        if (!cancelled) setError(tgErrorMessage(e, 'Kirishda xato. Qayta urinib ko\'ring.'))
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="eko-app h-screen flex items-center justify-center p-6 text-center">
        <div>
          <Smartphone className="w-10 h-10 text-eko-subtle mx-auto mb-3" />
          <p className="text-sm font-medium text-eko-danger">{error}</p>
        </div>
      </div>
    )
  }
  if (!user) {
    return (
      <div className="eko-app h-screen flex items-center justify-center text-eko-accent">
        <Loader2 className="w-7 h-7 animate-spin" />
      </div>
    )
  }

  const canWrite = user.role !== 'supervisor'
  // KPI faqat inspektorlar uchun (boshliq/admin uchun hisoblanmaydi)
  const tabs = TABS.filter(t => t.key !== 'kpi' || user.role === 'inspector')

  return (
    <div className="eko-app h-screen flex flex-col bg-eko-surface-2" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="flex-1 min-h-0 relative">
        {/* Xarita doim ulangan turadi (tab almashganda holati — joylashuv, zoom — yo'qolmasin) */}
        <div className={tab === 'map' ? 'h-full' : 'hidden'}>
          <TgMapTab onOpen={setOpenId} active={tab === 'map'} refreshKey={version} />
        </div>
        {tab === 'debtors' && <TgDebtorsTab key={`d${version}`} onOpen={setOpenId} />}
        {tab === 'kpi' && <TgKpiTab />}
      </div>

      <nav style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} className="shrink-0 grid bg-eko-surface border-t border-eko-line pb-[env(safe-area-inset-bottom)]">
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? 'text-eko-accent' : 'text-eko-muted'}`}
            >
              <Icon className="w-5 h-5" />
              {t.label}
            </button>
          )
        })}
      </nav>

      {openId && (
        <TgEntitySheet
          entityId={openId}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onChanged={() => setVersion(v => v + 1)}
        />
      )}
    </div>
  )
}
