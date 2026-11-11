import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, CardBody, DataTable, Badge, Button } from '../../ui'

interface UserRow {
  id: string; fullName: string; role: string; isActive: boolean
  botLink?: { linkedAt?: string | null; tgUsername?: string | null } | null
}

const ROLE: Record<string, string> = { admin: 'Admin', supervisor: 'Boshliq', inspector: 'Inspektor' }

/** Telegram bot: kim ulangan. Ulash havolasi Xodimlar sahifasida beriladi. */
export default function BotSection() {
  const navigate = useNavigate()
  const q = useQuery<UserRow[]>({
    queryKey: [...ekoKeys.users, 'bot-status'],
    queryFn: async () => (await ekoApi.get('/users')).data.data ?? [],
    staleTime: 30_000,
  })
  const rows = (q.data ?? []).filter(u => u.isActive)
  const linked = rows.filter(u => u.botLink?.linkedAt).length

  return (
    <Card flush>
      <CardHeader
        title="Telegram bot"
        hint={q.data ? `${linked} / ${rows.length} faol xodim ulangan` : 'Dala xodimlari to\'lovni botdan yozadi'}
        actions={<Button size="sm" onClick={() => navigate('/ekohisob/admin/users')}>Xodimlar</Button>}
      />
      <CardBody className="pb-2">
        <p className="eko-text-sm text-eko-muted">
          Xodim botga ulanishi uchun Xodimlar sahifasida unga ulash havolasini bering. Ulanmagan xodim botdan foydalana olmaydi.
        </p>
      </CardBody>
      <DataTable
        aria-label="Bot ulanishi"
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.isError ? errMsg(q.error) : null}
        onRetry={() => q.refetch()}
        empty={{ title: 'Faol xodim yo\'q' }}
        columns={[
          { key: 'fullName', title: 'Xodim', render: (r) => <span className="font-medium">{r.fullName}</span> },
          { key: 'role', title: 'Rol', render: (r) => ROLE[r.role] ?? r.role },
          {
            key: 'bot', title: 'Bot',
            render: (r) => r.botLink?.linkedAt
              ? <Badge tone="success">Ulangan{r.botLink.tgUsername ? ` · @${r.botLink.tgUsername}` : ''}</Badge>
              : <Badge tone="neutral">Ulanmagan</Badge>,
          },
        ]}
      />
    </Card>
  )
}
