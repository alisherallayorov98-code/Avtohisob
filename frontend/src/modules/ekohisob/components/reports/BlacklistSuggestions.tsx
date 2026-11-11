import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, DataTable, Button, f } from '../../ui'

interface Suggestion {
  id: string; name: string; district: string | null; mahalla: string | null
  debtLevel: string; debtAmount: number; debtMonths: number; suggestedAt: string | null
}

/** Qora ro'yxatga tavsiya: tizim faqat tavsiya qiladi, qaror odamda. (Faqat admin uchun endpoint.) */
export default function BlacklistSuggestions() {
  const navigate = useNavigate()
  const q = useQuery<Suggestion[]>({
    queryKey: [...ekoKeys.blacklist, 'suggestions'],
    queryFn: async () => (await ekoApi.get('/settings/blacklist-suggestions')).data.data ?? [],
    staleTime: 60_000,
    retry: false,
  })
  return (
    <Card flush>
      <CardHeader
        title="Qora ro'yxatga tavsiya"
        hint="Kritik darajaga yetgan tashkilotlar. Qo'shish Tashkilotlar sahifasida."
        actions={<Button variant="ghost" size="sm" onClick={() => navigate('/ekohisob/blacklist')}>Qora ro'yxat</Button>}
      />
      <DataTable
        aria-label="Qora ro'yxat tavsiyalari"
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.isError ? errMsg(q.error) : null}
        onRetry={() => q.refetch()}
        empty={{ title: "Hozircha tavsiya yo'q", hint: 'Kritik darajaga yetgan tashkilot topilmadi.' }}
        columns={[
          {
            key: 'name', title: 'Tashkilot',
            render: (r) => (
              <>
                {r.name}
                <span className="block eko-text-xs text-eko-muted">
                  {[r.district, r.mahalla].filter(Boolean).join(' / ') || '—'} · {r.debtMonths} oy
                  {r.suggestedAt && ` · ${f.date(r.suggestedAt)} dan beri`}
                </span>
              </>
            ),
          },
          { key: 'debtAmount', title: "Qarz, so'm", align: 'right', render: (r) => f.num(r.debtAmount) },
        ]}
      />
    </Card>
  )
}
