import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Trash2, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { ekoKeys, invalidateEko, useDistricts } from '../lib/queries'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { useAuthStore } from '../../../stores/authStore'
import {
  Banner, Card, Column, DataTable, FilterBar, Page, PageHeader, RowActions, SegmentedControl, useConfirm, f,
} from '../ui'

interface Entry {
  id: string
  entityName: string
  entityAddress: string
  reason: string
  govOrgName?: string | null
  govCaseId?: string | null
  addedAt: string
  resolvedAt?: string | null
  status: 'active' | 'resolved'
}

const PAGE_SIZE = 20

export default function BlacklistPage() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const ekoUser = useEkoAuthStore(s => s.user)
  const mainUser = useAuthStore(s => s.user)
  const isAdmin = ekoUser?.role === 'admin' || mainUser?.role === 'admin' || mainUser?.role === 'super_admin'
  // Yozish: admin va inspektor (boshliq faqat ko'radi); tuman tekshiruvi backendda
  const canWrite = isAdmin || ekoUser?.role === 'inspector'

  const [districtId, setDistrictId] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const [page, setPage] = useState(1)
  const districts = useDistricts()

  const q = useQuery<{ items: Entry[]; truncated: { shown: number; total: number } | null }>({
    queryKey: [...ekoKeys.blacklist, districtId],
    queryFn: async () => {
      const res = await ekoApi.get('/blacklist', { params: districtId ? { districtId } : {} })
      const data: any[] = Array.isArray(res.data.data) ? res.data.data : []
      const meta = res.data.meta
      return {
        items: data.map((b): Entry => ({
          id: b.id,
          entityName: b.entity?.name ?? b.entityName ?? '—',
          entityAddress: b.entity?.address ?? b.entityAddress ?? '',
          reason: b.reason ?? '',
          govOrgName: b.govOrgName, govCaseId: b.govCaseId,
          addedAt: b.addedAt, resolvedAt: b.resolvedAt, status: b.status,
        })),
        truncated: meta?.truncated ? { shown: data.length, total: meta.total ?? 0 } : null,
      }
    },
  })

  const resolve = useMutation({
    mutationFn: (id: string) => ekoApi.put(`/blacklist/${id}`, { status: 'resolved' }),
    onSuccess: () => { toast.success('Hal qilindi deb belgilandi'); invalidateEko(qc, 'entity') },
    onError: err => toast.error(errMsg(err)),
  })

  async function remove(e: Entry) {
    const ok = await confirm({
      title: "Qora ro'yxatdan chiqarish",
      message: `"${e.entityName}" qora ro'yxatdan olib tashlansinmi?`,
      danger: true,
      consequences: ['Tashkilot avvalgi holatiga qaytadi', 'Amal jurnalga yoziladi'],
      confirmLabel: 'Chiqarish',
    })
    if (!ok) return
    try {
      await ekoApi.delete(`/blacklist/${e.id}`)
      toast.success("Qora ro'yxatdan chiqarildi")
      invalidateEko(qc, 'entity')
    } catch (err) { toast.error(errMsg(err)) }
  }

  const all = q.data?.items ?? []
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return all
    return all.filter(e =>
      e.entityName.toLowerCase().includes(s) || e.entityAddress.toLowerCase().includes(s) ||
      e.reason.toLowerCase().includes(s) || (e.govOrgName || '').toLowerCase().includes(s))
  }, [all, search])
  const active = filtered.filter(e => e.status === 'active')
  const resolved = filtered.filter(e => e.status === 'resolved')
  const rows = tab === 'active' ? active : resolved
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const columns: Column<Entry>[] = [
    {
      key: 'name', title: 'Tashkilot', mobile: 'primary',
      render: e => (
        <div className="min-w-0">
          <p className="font-medium text-eko-text break-words">{e.entityName}</p>
          {e.entityAddress && <p className="eko-text-xs text-eko-muted">{e.entityAddress}</p>}
        </div>
      ),
    },
    { key: 'reason', title: 'Sabab', render: e => <span className="line-clamp-2 text-eko-text-2">{e.reason || '—'}</span> },
    {
      key: 'gov', title: 'Idora / ish raqami',
      render: e => e.govOrgName || e.govCaseId
        ? <span className="text-eko-text-2">{e.govOrgName}{e.govCaseId ? ` · #${e.govCaseId}` : ''}</span>
        : null,
    },
    { key: 'date', title: tab === 'active' ? 'Qo\'shilgan' : 'Hal qilingan', render: e => f.date(tab === 'active' ? e.addedAt : e.resolvedAt) },
  ]

  return (
    <Page>
      <PageHeader
        title="Qora ro'yxat"
        subtitle={`Faol: ${active.length} · Hal qilingan: ${resolved.length}`}
      />

      {q.data?.truncated && (
        <Banner tone="warn">
          {q.data.truncated.total} tadan {q.data.truncated.shown} tasi yuklandi — tuman bo'yicha filtrlang.
        </Banner>
      )}

      <FilterBar
        search={{ value: search, onChange: v => { setSearch(v); setPage(1) }, placeholder: "Tashkilot, manzil, sabab yoki idora bo'yicha" }}
        filters={[{
          key: 'district', label: 'Tuman', value: districtId,
          onChange: v => { setDistrictId(v); setPage(1) },
          options: (districts.data ?? []).map(d => ({ value: d.id, label: d.name })),
        }]}
        onClear={() => { setDistrictId(''); setSearch(''); setPage(1) }}
        actions={
          <SegmentedControl
            ariaLabel="Holat"
            value={tab}
            onChange={v => { setTab(v); setPage(1) }}
            options={[
              { value: 'active', label: 'Faol', count: active.length },
              { value: 'resolved', label: 'Hal qilingan', count: resolved.length },
            ]}
          />
        }
      />

      <Card flush>
        <DataTable
          aria-label="Qora ro'yxat"
          columns={columns}
          rows={paged}
          rowKey={e => e.id}
          loading={q.isLoading}
          error={q.isError ? errMsg(q.error) : null}
          onRetry={() => q.refetch()}
          empty={{
            title: search ? 'Hech narsa topilmadi' : tab === 'active' ? "Faol muammolar yo'q" : "Hal qilinganlar yo'q",
            hint: search ? "Qidiruvni o'zgartiring." : undefined,
            icon: <ShieldCheck className="w-6 h-6" />,
          }}
          rowActions={tab === 'active' && canWrite ? (e => (
            <RowActions
              primary={{
                label: 'Hal qilindi', icon: <CheckCircle2 className="w-4 h-4" aria-hidden />,
                loading: resolve.isPending && resolve.variables === e.id,
                onClick: () => resolve.mutate(e.id),
              }}
              items={isAdmin ? [{
                key: 'rm', label: "Ro'yxatdan chiqarish", icon: <Trash2 className="w-4 h-4" />, danger: true,
                onSelect: () => remove(e),
              }] : undefined}
            />
          )) : undefined}
          pagination={{ page, pageSize: PAGE_SIZE, total: rows.length, onPageChange: setPage }}
        />
      </Card>
    </Page>
  )
}
