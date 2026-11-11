import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Badge, BadgeTone, ErrorState, SkeletonList, f } from '../../ui'

interface Visit {
  id: string
  kind: 'not_paid' | 'promised' | 'visited'
  reason?: string | null
  promisedDate?: string | null
  createdAt: string
  userName?: string | null
}

const KIND: Record<Visit['kind'], { tone: BadgeTone; label: string }> = {
  not_paid: { tone: 'danger', label: "To'lamadi" },
  promised: { tone: 'warn', label: "Va'da berdi" },
  visited: { tone: 'neutral', label: 'Tashrif' },
}

/** Tashrif tarixi: inspektor qarzdorga borganda natijani qayd etadi (bot orqali). */
export default function VisitHistory({ entityId }: { entityId: string }) {
  const q = useQuery<Visit[]>({
    queryKey: ['eko', 'visits', entityId],
    queryFn: async () => (await ekoApi.get('/visits', { params: { entityId, limit: 10 } })).data.data ?? [],
  })
  return (
    <section>
      <h3 className="eko-text-base font-medium text-eko-text mb-2">Tashrif tarixi</h3>
      {q.isLoading && <SkeletonList rows={2} />}
      {q.isError && <ErrorState compact hint={errMsg(q.error)} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="eko-text-sm text-eko-muted">Hali tashrif qayd etilmagan</p>}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg">
          {q.data.map(v => (
            <li key={v.id} className="px-3 py-2.5 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={KIND[v.kind]?.tone ?? 'neutral'}>{KIND[v.kind]?.label ?? v.kind}</Badge>
                {v.promisedDate && <span className="eko-text-sm text-eko-text-2">{f.date(v.promisedDate)} gacha</span>}
              </div>
              {v.reason && <p className="eko-text-sm text-eko-text">{v.reason}</p>}
              <p className="eko-text-xs text-eko-muted">{f.dateTime(v.createdAt)}{v.userName ? ` · ${v.userName}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
