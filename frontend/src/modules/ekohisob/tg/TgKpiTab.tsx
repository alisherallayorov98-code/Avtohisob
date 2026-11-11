import { useCallback, useEffect, useState } from 'react'
import { tgApi, tgErrorMessage } from './tgApi'
import { currentMonthUz } from './tgUtil'
import { Banner, Badge, Button, SkeletonList, EmptyState, ErrorState, f } from '../ui'

interface Item {
  id: string; name: string; weight: number; target: number; direction: string; unit?: string
  value: number | null; achievement: number | null; excluded: boolean
}
interface My {
  month?: string
  applicable: boolean
  status?: 'open' | 'closed'
  scheme?: { bonusMax: number; minScore: number }
  result?: { score: number; bonus: number; items: Item[] } | null
}

/** Kichik progress chizig'i (pages/kpi/ScoreBar boshqa agentniki — shu yerda o'zimizniki). */
function Bar({ pct, label }: { pct: number; label: string }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}
      className="h-2 rounded-full bg-eko-surface-3 overflow-hidden mt-2">
      <div className="h-full rounded-full bg-eko-accent" style={{ width: `${w}%` }} />
    </div>
  )
}

const fmt = (v: number | null, unit = '') => {
  if (v === null) return '—'
  const s = (Math.round(v * 10) / 10).toLocaleString('en-US').replace(/,/g, ' ')
  return unit ? `${s} ${unit}` : s
}

/** Mini ilovada inspektorning o'z KPI'si (faqat o'zi — boshqalar ko'rinmaydi). */
export default function TgKpiTab() {
  const [data, setData] = useState<My | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await tgApi.get('/kpi/my')
      setData(res.data.data); setError('')
    } catch (e) { setError(tgErrorMessage(e, "KPI'ni yuklab bo'lmadi")) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const r = data?.result
  const min = data?.scheme?.minScore ?? 50

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {error && !data && <ErrorState title={error} onRetry={load} />}
      {error && data && <Banner tone="danger" action={<Button size="sm" onClick={load}>Qayta</Button>}>{error}</Banner>}
      {!data && !error && <SkeletonList rows={4} />}
      {data && !r && <EmptyState title="KPI hali hisoblanmagan" hint="Ko'rsatkichlar admin tomonidan sozlangach shu yerda ko'rinadi." />}

      {r && (
        <>
          <div className="bg-eko-surface border border-eko-line rounded-eko-lg p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="eko-text-sm text-eko-muted">{f.monthLabel(data?.month ?? currentMonthUz())} · ball</p>
                <p className="eko-text-lead font-semibold text-eko-text eko-num">{r.score}</p>
              </div>
              <div className="text-right">
                <p className="eko-text-sm text-eko-muted">Bonus</p>
                <p className="eko-text-lg font-semibold text-eko-text eko-num">{f.money(r.bonus)}</p>
              </div>
            </div>
            <Bar pct={r.score} label="Ball" />
            <p className="eko-text-sm text-eko-muted mt-2">
              {r.score >= min ? "Bonus uchun yetarli ball bor." : `Bonus uchun yana ${Math.round((min - r.score) * 10) / 10} ball kerak.`}
              {data?.status === 'open' ? ' Oy davom etmoqda — natija o\'zgarishi mumkin.' : ''}
            </p>
          </div>

          <ul className="space-y-2">
            {r.items.filter(i => i.weight > 0).map(it => (
              <li key={it.id} className="bg-eko-surface border border-eko-line rounded-eko-lg px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="eko-text-md font-medium text-eko-text">{it.name}</p>
                  {it.excluded
                    ? <Badge>hisobda yo'q</Badge>
                    : <span className="eko-text-md font-semibold eko-num">{it.achievement}%</span>}
                </div>
                {!it.excluded && <Bar pct={it.achievement ?? 0} label={it.name} />}
                <p className="eko-text-sm text-eko-muted mt-1.5">
                  {fmt(it.value, it.unit)} / {fmt(it.target, it.unit)}{it.direction === 'lower' ? ' (kam — yaxshi)' : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
