import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { tgApi, tgErrorMessage } from './tgApi'
import { Banner, Button, SkeletonList, EmptyState, f } from '../ui'

interface Debtor {
  id: string
  name: string
  address?: string | null
  mahalla: string
  debtAmount: number
  unpaidMonths: string[]
  billingMode: string
}

/**
 * Qarzdorlar ro'yxati — inspektor ko'chaga chiqishdan oldin/yo'lda kimga borishni ko'radi.
 * Manba: `/dashboard/daily` (veb "Kunlik ro'yxat" bilan bir xil hisob).
 */
export default function TgDebtorsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Debtor[] | null>(null)
  const [meta, setMeta] = useState<{ totalDebtors: number; paidToday: number; truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await tgApi.get('/dashboard/daily')
      const d = res.data.data
      const flat: Debtor[] = []
      for (const g of d.groups ?? []) {
        for (const e of g.entities ?? []) flat.push({ ...e, mahalla: g.mahallName })
      }
      flat.sort((a, b) => b.debtAmount - a.debtAmount)
      setRows(flat)
      setMeta({
        totalDebtors: d.totalDebtors ?? flat.length,
        paidToday: (d.paidToday ?? []).length,
        truncated: Boolean(res.data.meta?.truncated),
      })
      setError('')
    } catch (e) { setError(tgErrorMessage(e, "Ro'yxatni yuklab bo'lmadi")) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!rows) return []
    return t ? rows.filter(r => r.name.toLowerCase().includes(t) || (r.address ?? '').toLowerCase().includes(t)) : rows
  }, [rows, q])

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-eko-surface border border-eko-line rounded-eko px-3 h-10">
          <Search className="w-4 h-4 text-eko-subtle" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Qarzdorni qidirish"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
        </div>
        <Button onClick={load} loading={busy} icon={<RefreshCw className="w-4 h-4" />} aria-label="Yangilash" />
      </div>

      {meta && (
        <p className="text-xs text-eko-muted">
          Qarzdor: <b className="text-eko-text">{meta.totalDebtors}</b> · bugun to'lagan: <b className="text-eko-text">{meta.paidToday}</b>
        </p>
      )}
      {meta?.truncated && <Banner tone="info">Faqat eng birinchi qismi ko'rsatilmoqda.</Banner>}
      {error && <Banner tone="danger" action={<Button size="sm" onClick={load}>Qayta</Button>}>{error}</Banner>}
      {!rows && !error && <SkeletonList rows={6} />}
      {rows && filtered.length === 0 && !error && (
        <EmptyState
          title={q ? 'Topilmadi' : "Qarzdor yo'q"}
          hint={q ? undefined : "Hamma to'lagan"}
          tone={q ? 'neutral' : 'success'}
        />
      )}

      <ul className="space-y-2">
        {filtered.map(r => (
          <li key={r.id}>
            <button
              onClick={() => onOpen(r.id)}
              className="w-full text-left bg-eko-surface border border-eko-line rounded-eko-lg px-3.5 py-3 active:bg-eko-surface-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-eko-text truncate">{r.name}</p>
                  <p className="text-xs text-eko-muted truncate">{[r.mahalla, r.address].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-eko-danger">{r.debtAmount > 0 ? f.money(r.debtAmount) : "To'lanmagan"}</p>
                  {r.unpaidMonths.length > 0 && <p className="text-[11px] text-eko-muted">{r.unpaidMonths.length} oy</p>}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
