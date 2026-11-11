import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import {
  Card, CardHeader, Badge, Button, Banner, EmptyState, ErrorState, SkeletonList, f,
} from '../../ui'

type Severity = 'high' | 'medium' | 'low'

interface HealthGroup {
  code: string; label: string; why: string; severity: Severity; count: number
  samples: { id: string; name: string; district: string | null }[]
}
interface HealthData { checked: number; clean: number; total: number; truncated: boolean; groups: HealthGroup[] }

const SEVERITY_TONE: Record<Severity, 'danger' | 'warn' | 'neutral'> = { high: 'danger', medium: 'warn', low: 'neutral' }
const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'Avtomatlashtirishni buzadi',
  medium: 'Ishni qiyinlashtiradi',
  low: "Hujjat to'liqligi",
}

/**
 * Ma'lumot to'liqligi nazorati. Telefoni yo'q tashkilotga SMS bormaydi, oylik summasi 0 bo'lsa
 * hisob yozilmaydi — hech qanday xato chiqmaydi, shunchaki ish bajarilmaydi. Bu panel shuni ko'rsatadi.
 */
export default function DataHealthPanel() {
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery<HealthData>({
    queryKey: [...ekoKeys.reports, 'data-health'],
    queryFn: async () => (await ekoApi.get('/monitoring/data-health')).data.data,
    staleTime: 60_000,
  })
  const data = q.data
  const highCount = data?.groups.filter(g => g.severity === 'high').reduce((s, g) => s + g.count, 0) ?? 0

  return (
    <Card flush>
      <CardHeader
        title="Ma'lumot sog'ligi"
        hint={data ? `${f.num(data.checked)} ta tashkilot tekshirildi · ${f.num(data.clean)} tasi to'liq` : undefined}
        actions={<Button variant="ghost" size="sm" onClick={() => q.refetch()} loading={q.isFetching}>Yangilash</Button>}
      />
      {q.isLoading ? (
        <SkeletonList rows={3} />
      ) : q.isError || !data ? (
        <ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} compact />
      ) : data.groups.length === 0 ? (
        <EmptyState tone="success" compact title="Barcha ma'lumotlar to'liq" hint="Avtomatlashtirishni bloklaydigan bo'sh maydon topilmadi." />
      ) : (
        <>
          <div className="px-4 sm:px-5 pt-4 space-y-2">
            {highCount > 0 && (
              <Banner tone="danger">
                <b>{f.num(highCount)} ta tashkilotda</b> avtomatlashtirishni buzadigan maydon to'ldirilmagan — ularga SMS bormaydi yoki hisob yozilmaydi.
              </Banner>
            )}
            {data.truncated && (
              <Banner tone="info">{f.num(data.total)} tadan {f.num(data.checked)} tasi tekshirildi.</Banner>
            )}
          </div>
          <div className="mt-3">
            {data.groups.map(g => {
              const isOpen = open === g.code
              return (
                <div key={g.code} className="border-t border-eko-line">
                  <div className="flex items-start gap-3 px-4 sm:px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="eko-text-base font-medium text-eko-text">{g.label}</span>
                        <Badge tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</Badge>
                      </div>
                      <p className="eko-text-xs text-eko-muted mt-0.5">{g.why}</p>
                    </div>
                    <span className="eko-text-base font-semibold eko-num shrink-0">{f.num(g.count)}</span>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(isOpen ? null : g.code)} aria-expanded={isOpen}>
                      {isOpen ? 'Yopish' : 'Namunalar'}
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="px-4 sm:px-5 pb-3">
                      {g.samples.length === 0 ? (
                        <p className="eko-text-sm text-eko-muted">Namuna yo'q</p>
                      ) : (
                        <>
                          <ul className="border-l border-eko-line pl-3 space-y-1">
                            {g.samples.map(s => (
                              <li key={s.id} className="flex items-center justify-between gap-2 eko-text-sm">
                                <span className="text-eko-text-2 truncate">{s.name}</span>
                                <span className="text-eko-muted shrink-0">{s.district ?? '—'}</span>
                              </li>
                            ))}
                          </ul>
                          {g.count > g.samples.length && (
                            <p className="eko-text-xs text-eko-muted mt-1.5">…va yana {f.num(g.count - g.samples.length)} ta</p>
                          )}
                          <Button size="sm" className="mt-2" onClick={() => navigate('/ekohisob/entities')}>
                            Tashkilotlar sahifasida tuzatish
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}
