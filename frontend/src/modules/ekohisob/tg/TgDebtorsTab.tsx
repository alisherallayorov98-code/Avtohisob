import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Wallet, WifiOff } from 'lucide-react'
import { tgApi, tgErrorMessage } from './tgApi'
import { Badge, Banner, Button, EmptyState, ErrorState, IconButton, InputWithIcon, SegmentedControl, SkeletonList, f } from '../ui'
import { Search } from 'lucide-react'
import { useOnline } from './tgTelegram'
import {
  cacheRead, cacheWrite, formatDistance, geoPermission, haversineM, markSynced, prefGet, prefSet,
  requestFix, todayUzIso, type GeoFix, type LatLon,
} from './tgUtil'
import type { LocalPay, LocalVisit, VisitMark } from './tgTypes'

interface Debtor {
  id: string
  name: string
  address?: string | null
  mahalla: string
  debtAmount: number
  unpaidMonths: string[]
  billingMode: string
  phone?: string | null
  fromSearch?: boolean
}

interface Snapshot { rows: Debtor[]; collected: number; total: number; truncated: boolean }
interface Promise_ { daysOverdue: number; promisedDate: string }

const PAGE = 50
const CACHE_KEY = 'debtors:v2'

export interface OpenOpts { pay?: boolean }

/**
 * Qarzdorlar — bosh ekran. Savol: "Hozir qayerga borib, kimdan pul olaman?"
 * Manba: /dashboard/daily (qarz), /payments (bugun yig'ilgan), /dashboard/map (masofa uchun
 * koordinata), /visits/promises (va'dasi bugun/o'tganlar). Oxirgi javob sessionStorage'da.
 */
export default function TgDebtorsTab({
  userId, role, canWrite, refreshKey, localPays, localVisits, onOpen, onOrder,
}: {
  userId: string
  role: string
  canWrite: boolean
  refreshKey: number
  localPays: LocalPay[]
  localVisits: LocalVisit[]
  onOpen: (id: string, opts?: OpenOpts) => void
  onOrder: (ids: string[]) => void
}) {
  const cached = useRef(cacheRead<Snapshot>(CACHE_KEY)).current
  const [snap, setSnap] = useState<Snapshot | null>(cached?.data ?? null)
  const [stale, setStale] = useState(Boolean(cached))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [promises, setPromises] = useState<Map<string, Promise_>>(new Map())
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [coords, setCoords] = useState<Map<string, LatLon>>(new Map())
  const [geoNote, setGeoNote] = useState('')
  const [mode, setMode] = useState<'near' | 'debt'>(() => (prefGet('debtorsMode') === 'near' ? 'near' : 'debt'))
  const [remote, setRemote] = useState<Debtor[]>([])
  const loadStartedAt = useRef(0)
  const [syncedAt, setSyncedAt] = useState(0)
  const online = useOnline()

  const load = useCallback(async () => {
    const startedAt = Date.now()
    setBusy(true)
    try {
      const day = todayUzIso()
      const payParams: Record<string, string | number> = { from: day, to: day, limit: 1 }
      if (role === 'inspector') payParams.receivedBy = userId
      const [daily, pays] = await Promise.all([
        tgApi.get('/dashboard/daily'),
        tgApi.get('/payments', { params: payParams }),
      ])
      const d = daily.data.data
      const flat: Debtor[] = []
      for (const g of d.groups ?? []) {
        for (const e of g.entities ?? []) flat.push({ ...e, mahalla: g.mahallName })
      }
      flat.sort((a, b) => b.debtAmount - a.debtAmount)
      const next: Snapshot = {
        rows: flat,
        collected: Number(pays.data.meta?.totalAmount ?? 0),
        total: d.totalDebtors ?? flat.length,
        truncated: Boolean(daily.data.meta?.truncated),
      }
      loadStartedAt.current = startedAt
      setSnap(next)
      setStale(false)
      setError('')
      setSyncedAt(markAndCache(next))
    } catch (e) {
      setError(tgErrorMessage(e, "Ro'yxatni yuklab bo'lmadi"))
    } finally { setBusy(false) }
  }, [role, userId])

  // Va'dasi bugun/o'tganlar — qo'shimcha belgi, xatosi ro'yxatni to'smaydi
  const loadPromises = useCallback(async () => {
    try {
      const r = await tgApi.get('/visits/promises')
      const m = new Map<string, Promise_>()
      for (const p of r.data.data ?? []) m.set(p.entityId, { daysOverdue: p.daysOverdue, promisedDate: p.promisedDate })
      setPromises(m)
    } catch (e) {
      console.warn('promises', tgErrorMessage(e))
    }
  }, [])

  // Birinchi yuklash + to'lov/tashrifdan keyin jim yangilash (remount YO'Q, qidiruv/skroll saqlanadi)
  useEffect(() => { load(); loadPromises() }, [load, loadPromises, refreshKey])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') { load(); loadPromises() } }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load, loadPromises])
  useEffect(() => { if (online && error) load() }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  // Joylashuv: ruxsat oldindan berilgan bo'lsa jim olinadi, aks holda "Yaqin" bosilganda so'raladi
  const locate = useCallback(async () => {
    setGeoNote('')
    try {
      const p = await requestFix({ maximumAge: 30000, timeout: 12000 })
      setFix(p)
      return p
    } catch (e) {
      setGeoNote(e instanceof Error && e.message === 'denied' ? "GPS ruxsati yo'q — qarz bo'yicha saralandi" : "Joylashuv aniqlanmadi — qarz bo'yicha saralandi")
      setMode('debt')
      return null
    }
  }, [])

  useEffect(() => {
    geoPermission().then(st => { if (st === 'granted') locate() })
  }, [locate])
  useEffect(() => { if (mode === 'near' && !fix) locate() }, [mode, fix, locate])

  // Koordinatalar (qarz ro'yxatida yo'q) — faqat GPS bor bo'lganda, bir marta
  const coordsLoaded = useRef(false)
  useEffect(() => {
    if (!fix || coordsLoaded.current) return
    coordsLoaded.current = true
    tgApi.get('/dashboard/map', { params: { limit: 5000 } })
      .then(r => {
        const m = new Map<string, LatLon>()
        for (const e of r.data.data ?? []) if (e.lat != null && e.lon != null) m.set(e.id, { lat: e.lat, lon: e.lon })
        setCoords(m)
      })
      .catch(err => {
        coordsLoaded.current = false
        setGeoNote(tgErrorMessage(err, "Masofa hisoblanmadi"))
      })
  }, [fix])

  // Server qidiruvi: STIR / kod / nom (+ telefon, agar qaytsa). Qarzsiz tashkilotlar ham chiqadi.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 3) { setRemote([]); return }
    let off = false
    const t = setTimeout(async () => {
      try {
        const r = await tgApi.get('/entities', { params: { search: term, limit: 20 } })
        if (off) return
        setRemote((r.data.data ?? []).map((e: any): Debtor => ({
          id: e.id, name: e.name, address: e.address, mahalla: e.mahalla?.name ?? '', debtAmount: 0,
          unpaidMonths: [], billingMode: e.billingMode, phone: e.phone, fromSearch: true,
        })))
      } catch (e) {
        if (!off) { setRemote([]); console.warn('search', tgErrorMessage(e)) }
      }
    }, 300)
    return () => { off = true; clearTimeout(t) }
  }, [q])

  // Lokal tuzatishlar: to'lovdan keyin qator darrov yangilanadi (server javobi kelguncha)
  const patched = useMemo(() => {
    const started = loadStartedAt.current
    const payBy = new Map<string, LocalPay>()
    for (const p of localPays) if (p.ts > started) payBy.set(p.id, p)
    const visitBy = new Map<string, VisitMark>()
    for (const v of localVisits) visitBy.set(v.id, v.mark)
    const collectedDelta = localPays.filter(p => p.ts > started).reduce((s, p) => s + p.amount, 0)
    return { payBy, visitBy, collectedDelta }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPays, localVisits, syncedAt])

  const dist = useCallback((id: string): number | null => {
    const c = coords.get(id)
    return fix && c ? haversineM(fix, c) : null
  }, [fix, coords])

  const list = useMemo(() => {
    const byId = new Map<string, Debtor>()
    for (const r of snap?.rows ?? []) byId.set(r.id, r)
    const t = q.trim().toLowerCase()
    const digits = t.replace(/\D/g, '')
    let rows: Debtor[] = (snap?.rows ?? []).map(r => {
      const p = patched.payBy.get(r.id)
      return p ? { ...r, debtAmount: p.remaining } : r
    }).filter(r => r.debtAmount > 0 || !patched.payBy.has(r.id))
    if (t) {
      rows = rows.filter(r =>
        r.name.toLowerCase().includes(t) || (r.address ?? '').toLowerCase().includes(t) ||
        r.mahalla.toLowerCase().includes(t) || (digits.length >= 4 && (r.phone ?? '').replace(/\D/g, '').endsWith(digits)))
      const have = new Set(rows.map(r => r.id))
      for (const r of remote) if (!have.has(r.id)) rows.push(byId.get(r.id) ?? r)
    }
    if (mode === 'near' && fix) {
      rows = [...rows].sort((a, b) => (dist(a.id) ?? Infinity) - (dist(b.id) ?? Infinity) || b.debtAmount - a.debtAmount)
    } else {
      rows = [...rows].sort((a, b) => b.debtAmount - a.debtAmount)
    }
    return rows
  }, [snap, q, remote, mode, fix, dist, patched])

  // Keyingi qarzdor uchun tartib
  useEffect(() => { onOrder(list.filter(r => r.debtAmount > 0).map(r => r.id)) }, [list, onOrder])
  useEffect(() => { setShown(PAGE) }, [q, mode])

  const closedLocally = snap ? snap.rows.filter(r => (patched.payBy.get(r.id)?.remaining ?? 1) <= 0).length : 0
  const remaining = snap ? Math.max(0, snap.total - closedLocally) : 0
  const collected = (snap?.collected ?? 0) + patched.collectedDelta

  function pickMode(m: 'near' | 'debt') {
    setMode(m); prefSet('debtorsMode', m)
  }

  const hasData = snap != null
  const syncText = stale && !online

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      {/* Ixcham sarlavha: bugun yig'ildi / qoldi */}
      <div className="sticky top-0 eko-z-sticky bg-eko-canvas border-b border-eko-line">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="eko-text-xs text-eko-muted leading-none">Bugun yig'ildi</p>
            <p className="text-[24px] leading-7 font-bold text-eko-text eko-num truncate">{f.num(collected)}</p>
          </div>
          <p className="shrink-0 eko-text-md text-eko-text-2">Qoldi: <b className="text-eko-text eko-num">{hasData ? remaining : '—'}</b> ta</p>
        </div>

        <div className="px-4 pb-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <InputWithIcon
              icon={<Search className="w-4 h-4" />} value={q} onChange={e => setQ(e.target.value)}
              className="!h-12" placeholder="Nom, STIR, kod yoki telefon" inputMode="search" aria-label="Qidiruv"
            />
          </div>
          <IconButton size="lg" label="Yangilash" loading={busy} icon={<RefreshCw className="w-5 h-5" />} onClick={() => { load(); loadPromises() }} />
        </div>
        <div className="px-4 pb-3">
          <SegmentedControl<'near' | 'debt'>
            ariaLabel="Saralash" className="w-full [&>button]:flex-1 [&>button]:justify-center"
            value={mode} onChange={pickMode}
            options={[{ value: 'near', label: 'Yaqin' }, { value: 'debt', label: 'Qarz' }]}
          />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {(syncText || (error && hasData)) && (
          <Banner
            tone="warn" icon={<WifiOff className="w-4 h-4" />}
            action={<Button size="sm" onClick={load} loading={busy}>Qayta</Button>}
          >
            {error ? `${error}. Saqlangan ro'yxat ko'rsatilmoqda.` : "Saqlangan ro'yxat ko'rsatilmoqda."}
          </Banner>
        )}
        {geoNote && <p className="eko-text-sm text-eko-muted">{geoNote}</p>}
        {snap?.truncated && <p className="eko-text-sm text-eko-muted">Faqat eng katta qarzdorlar ko'rsatilmoqda.</p>}

        {!hasData && !error && <SkeletonList rows={6} />}
        {!hasData && error && <ErrorState title={error} onRetry={load} />}
        {hasData && list.length === 0 && (
          <EmptyState title={q ? 'Topilmadi' : "Qarzdor yo'q"} hint={q ? undefined : "Hamma to'lagan"} tone={q ? 'neutral' : 'success'} />
        )}

        <ul className="space-y-2">
          {list.slice(0, shown).map(r => {
            const d = dist(r.id)
            const pr = promises.get(r.id)
            const vm = patched.visitBy.get(r.id)
            const meta = [r.mahalla, d != null ? formatDistance(d) : null, r.unpaidMonths.length > 0 ? `${r.unpaidMonths.length} oy` : null]
              .filter(Boolean).join(' · ')
            return (
              <li key={r.id} className="flex items-stretch bg-eko-surface border border-eko-line rounded-eko-lg overflow-hidden">
                <button
                  type="button" onClick={() => onOpen(r.id)}
                  className="flex-1 min-w-0 min-h-[72px] text-left px-4 py-3 active:bg-eko-surface-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[16px] leading-6 font-medium text-eko-text truncate">{r.name}</p>
                    <p className="shrink-0 text-[18px] leading-6 font-bold text-eko-text eko-num">
                      {r.debtAmount > 0 ? f.num(r.debtAmount) : <span className="eko-text-sm font-normal text-eko-muted">Qarzsiz</span>}
                    </p>
                  </div>
                  <p className="eko-text-sm text-eko-muted truncate mt-0.5">{meta || r.address || '—'}</p>
                  {(vm || pr) && (
                    <div className="mt-1.5">
                      {vm ? (
                        <Badge tone="neutral">{vm.kind === 'promised' && vm.promisedDate ? `Va'da ${f.date(vm.promisedDate)}` : "To'lamadi — qayd etildi"}</Badge>
                      ) : pr && (
                        <Badge tone="warn">{pr.daysOverdue <= 0 ? "Va'da: bugun" : `Va'da o'tgan · ${pr.daysOverdue} kun`}</Badge>
                      )}
                    </div>
                  )}
                </button>
                {canWrite && r.debtAmount > 0 && (
                  <div className="flex items-center pr-2">
                    <IconButton
                      variant="primary" size="lg" label={`To'lov: ${r.name}`}
                      icon={<Wallet className="w-5 h-5" />} onClick={() => onOpen(r.id, { pay: true })}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {list.length > shown && (
          <Button size="lg" block onClick={() => setShown(s => s + PAGE)}>Yana yuklash ({list.length - shown})</Button>
        )}
      </div>
    </div>
  )
}

/** Keshga yozadi va sinxronlash vaqtini e'lon qiladi. */
function markAndCache(s: Snapshot): number {
  const t = cacheWrite(CACHE_KEY, s)
  markSynced(t)
  return t
}
