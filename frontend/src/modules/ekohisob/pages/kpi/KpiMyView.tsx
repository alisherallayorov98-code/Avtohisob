import { useCallback, useEffect, useState } from 'react'
import ekoApi from '../../lib/ekoApi'
import {
  Page, PageHeader, Toolbar, MonthInput, Card, CardHeader, Badge, Banner, SkeletonList, EmptyState, f,
} from '../../ui'
import { ScoreBar } from './ScoreBar'
import { UserResult, errMsg, fmtValue } from './types'

interface MyKpi {
  applicable: boolean
  month?: string
  status?: 'open' | 'closed'
  scheme?: { bonusMax: number; minScore: number }
  result?: (UserResult & { units?: Record<string, string> }) | null
}

function currentMonth(): string {
  return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7)
}

/**
 * Xodimning o'z KPI'si. Boshqa xodimlar natijasi ko'rinmaydi (ochiq reyting yo'q);
 * ball ostida «bonus uchun yana nima kerak» ko'rsatiladi — jamoaviy emas, shaxsiy motivatsiya.
 */
export default function KpiMyView() {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState<MyKpi | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await ekoApi.get('/kpi/my', { params: { month } })
      setData(res.data.data); setError('')
    } catch (e) { setError(errMsg(e, "KPI'ni yuklab bo'lmadi")) }
  }, [month])
  useEffect(() => { setData(null); load() }, [load])

  const r = data?.result
  const min = data?.scheme?.minScore ?? 50

  return (
    <Page>
      <PageHeader title="Mening KPI'm" subtitle={`${f.monthLabel(month)} · oylik ko'rsatkichlar va bonus`} />
      <Toolbar>
        <MonthInput value={month} onChange={setMonth} />
        {data?.status && <Badge tone={data.status === 'closed' ? 'success' : 'info'}>{data.status === 'closed' ? 'Yakunlangan' : 'Oy davom etmoqda'}</Badge>}
      </Toolbar>

      {error && <Banner tone="danger">{error}</Banner>}
      {!data && !error && <SkeletonList rows={4} />}
      {data && !data.applicable && (
        <Card><EmptyState title="KPI bu rol uchun hisoblanmaydi" hint="KPI inspektorlar uchun yuritiladi." /></Card>
      )}
      {data?.applicable && !r && (
        <Card><EmptyState title="Natija yo'q" hint="Bu oy uchun KPI hisoblanmagan." /></Card>
      )}

      {r && (
        <>
          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
              <div>
                <p className="eko-text-xs text-eko-muted mb-1.5">Ball</p>
                <ScoreBar score={r.score} minScore={min} max={120} />
                <p className="eko-text-xs text-eko-muted mt-2">
                  {r.score >= min
                    ? 'Bonus uchun yetarli ball to\'plandi.'
                    : `Bonus uchun yana ${Math.round((min - r.score) * 10) / 10} ball kerak (minimal ${min}).`}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="eko-text-xs text-eko-muted">Bonus{data.status === 'open' ? ' (hozirgi holat bo\'yicha)' : ''}</p>
                <p className="eko-text-lead font-semibold text-eko-text eko-num">{f.num(r.bonus)} <span className="eko-text-base font-normal text-eko-muted">so'm</span></p>
              </div>
            </div>
          </Card>

          <Card flush>
            <CardHeader title="Ko'rsatkichlar" />
            <ul className="divide-y divide-eko-line">
              {r.items.filter(i => i.weight > 0).map(it => (
                <li key={it.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="flex-1 basis-44 min-w-0">
                    <p className="text-sm font-medium text-eko-text">{it.name}</p>
                    <p className="eko-text-xs text-eko-muted">
                      Maqsad: {fmtValue(it.target, it.unit ?? '')}{it.direction === 'lower' ? ' (ko\'pi bilan)' : ''} · vazn {it.weight}%
                    </p>
                  </div>
                  <p className="text-sm eko-num">{fmtValue(it.value, it.unit ?? '')}</p>
                  <div className="w-24 text-right">
                    {it.excluded
                      ? <Badge tone="neutral">hisobda yo'q</Badge>
                      : <span className="text-sm font-semibold eko-num">{it.achievement}%</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {r.adjustments.length > 0 && (
            <Card flush>
              <CardHeader title="Rahbar tuzatishlari" />
              <ul className="divide-y divide-eko-line">
                {r.adjustments.map(a => (
                  <li key={a.id} className="px-4 py-3 text-sm">
                    <b>
                      {a.points !== 0 && `${a.points > 0 ? '+' : '−'}${Math.abs(a.points)} ball `}
                      {a.bonusDelta !== 0 && `${a.bonusDelta > 0 ? '+' : '−'}${f.money(Math.abs(a.bonusDelta))}`}
                    </b>
                    <p className="eko-text-xs text-eko-muted">{a.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  )
}
