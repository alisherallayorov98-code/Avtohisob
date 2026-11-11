import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Map as MapIcon, Users, Smartphone, Trophy, WifiOff } from 'lucide-react'
import { tgLogin, loadTelegramSdk, tgErrorMessage, TgUser } from './tgApi'
import TgMapTab from './TgMapTab'
import TgDebtorsTab, { OpenOpts } from './TgDebtorsTab'
import TgKpiTab from './TgKpiTab'
import TgEntitySheet from './TgEntitySheet'
import { Button, ConfirmProvider, Skeleton, f } from '../ui'
import { invalidateEko } from '../lib/queries'
import { getLastSync, subscribeSync } from './tgUtil'
import { syncTelegramChrome, useOnline, useTelegramTheme, webApp } from './tgTelegram'
import type { LocalPay, LocalVisit, PayResult, VisitMark } from './tgTypes'
import '../ui/tokens.css'

type Tab = 'map' | 'debtors' | 'kpi'

const TABS: Array<{ key: Tab; label: string; icon: typeof MapIcon }> = [
  { key: 'debtors', label: 'Qarzdorlar', icon: Users },
  { key: 'map', label: 'Xarita', icon: MapIcon },
  { key: 'kpi', label: 'KPI', icon: Trophy },
]

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab')
  return t === 'map' ? 'map' : t === 'kpi' ? 'kpi' : 'debtors'
}

/**
 * EkoHisob mini ilovasi (Telegram Web App).
 * Kirish — Telegram imzosi orqali (login/parol yo'q). Bosh ekran: Qarzdorlar.
 * Tashkilot ustiga bosilsa — varaq: qarz, qo'ng'iroq, yo'nalish, to'lov, to'lamadi/va'da.
 */
export default function TgApp() {
  const theme = useTelegramTheme()
  return (
    <div className="eko-app h-dvh flex flex-col" data-theme={theme}>
      <ConfirmProvider>
        <TgShell theme={theme} />
      </ConfirmProvider>
    </div>
  )
}

function TgShell({ theme }: { theme: 'dark' | 'light' }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<TgUser | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [open, setOpen] = useState<{ id: string; pay: boolean } | null>(null)
  // To'lov/tashrifdan keyin ro'yxat/xarita jim yangilanadi (remount YO'Q)
  const [version, setVersion] = useState(0)
  const [localPays, setLocalPays] = useState<LocalPay[]>([])
  const [localVisits, setLocalVisits] = useState<LocalVisit[]>([])
  const orderRef = useRef<string[]>([])
  const nextRef = useRef<string | null>(null)
  const tabRef = useRef<Tab>(tab)
  tabRef.current = tab
  const online = useOnline()
  const lastSync = useSyncExternalStore(subscribeSync, getLastSync)

  useEffect(() => {
    let cancelled = false
    setError('')
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
        if (!cancelled) setError(tgErrorMessage(e, "Kirishda xato. Qayta urinib ko'ring."))
      }
    })()
    return () => { cancelled = true }
  }, [attempt])

  // Mavzu o'zgarganda Telegram sarlavha/fon ranglari ilova tokenlariga moslanadi
  useEffect(() => { syncTelegramChrome() }, [theme, user])

  const onOrder = useCallback((ids: string[]) => { orderRef.current = ids }, [])

  const onPaid = useCallback((id: string, r: PayResult) => {
    const idx = orderRef.current.indexOf(id)
    nextRef.current = tabRef.current === 'debtors' ? (orderRef.current.slice(idx + 1).find(x => x !== id) ?? null) : null
    setLocalPays(p => [...p, { id, amount: r.amount, remaining: r.remaining, ts: Date.now() }])
    invalidateEko(qc, 'payment')
    setVersion(v => v + 1)
  }, [qc])

  const onVisit = useCallback((id: string, mark: VisitMark) => {
    setLocalVisits(v => [...v, { id, mark, ts: Date.now() }])
    setVersion(x => x + 1)
  }, [])

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center bg-eko-canvas">
        <div className="space-y-4 max-w-xs">
          <Smartphone className="w-10 h-10 text-eko-muted mx-auto" aria-hidden />
          <p className="eko-text-md font-medium text-eko-danger">{error}</p>
          {webApp()?.initData && <Button size="lg" variant="primary" onClick={() => setAttempt(a => a + 1)}>Qayta urinish</Button>}
        </div>
      </div>
    )
  }
  if (!user) {
    return (
      <div className="flex-1 p-4 space-y-3 bg-eko-canvas" aria-busy>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  const canWrite = user.role !== 'supervisor'
  // KPI faqat inspektorlar uchun (boshliq/admin uchun hisoblanmaydi)
  const tabs = TABS.filter(t => t.key !== 'kpi' || user.role === 'inspector')

  return (
    <>
      {!online && (
        <div role="status" className="shrink-0 flex items-center gap-2 px-4 py-2 bg-eko-warn-soft text-eko-warn border-b border-eko-warn-line eko-text-sm font-medium">
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden />
          <span>Oflayn{lastSync ? ` · oxirgi yangilanish ${f.time(new Date(lastSync))}` : ''}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 relative bg-eko-canvas">
        {/* Xarita doim ulangan turadi (tab almashganda holati — joylashuv, zoom — yo'qolmasin) */}
        <div className={tab === 'map' ? 'h-full' : 'hidden'}>
          <TgMapTab onOpen={id => setOpen({ id, pay: false })} active={tab === 'map'} refreshKey={version} />
        </div>
        {tab === 'debtors' && (
          <TgDebtorsTab
            userId={user.id} role={user.role} canWrite={canWrite} refreshKey={version}
            localPays={localPays} localVisits={localVisits} onOrder={onOrder}
            onOpen={(id, o?: OpenOpts) => setOpen({ id, pay: Boolean(o?.pay) })}
          />
        )}
        {tab === 'kpi' && <TgKpiTab />}
      </div>

      <nav
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        className="shrink-0 grid bg-eko-surface border-t border-eko-line pb-[env(safe-area-inset-bottom)]"
      >
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={`relative min-h-[56px] flex flex-col items-center justify-center gap-0.5 eko-text-xs font-medium ${active ? 'text-eko-text' : 'text-eko-muted'}`}
            >
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-[3px] rounded-b bg-eko-accent" aria-hidden />}
              <Icon className="w-5 h-5" aria-hidden />
              {t.label}
            </button>
          )
        })}
      </nav>

      {open && (
        <TgEntitySheet
          key={open.id}
          entityId={open.id}
          canWrite={canWrite}
          initialPay={open.pay}
          getNext={() => nextRef.current}
          onOpenNext={() => { const id = nextRef.current; nextRef.current = null; setOpen(id ? { id, pay: false } : null) }}
          onClose={() => setOpen(null)}
          onPaid={onPaid}
          onVisit={onVisit}
        />
      )}
    </>
  )
}
