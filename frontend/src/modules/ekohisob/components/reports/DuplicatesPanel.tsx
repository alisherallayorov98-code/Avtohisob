import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys, invalidateEko } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import {
  Card, CardHeader, Badge, Button, Banner, EmptyState, ErrorState, SkeletonList, RowActions, useConfirm, f,
} from '../../ui'

interface DupEntity {
  id: string; name: string; stir: string | null; status: string
  district: string | null; mahalla: string | null; createdAt: string
  creatorName: string | null; paymentsCount: number; debtAmount: number
}
interface DupGroup { reason: 'stir' | 'name'; key: string; entities: DupEntity[] }
interface DupData { scanned: number; total?: number; truncated?: boolean; groups: DupGroup[] }

/**
 * Takroriy tashkilotlar. Takror yozuvga har oy IKKI MARTA hisob yoziladi va SMS ikki marta boradi.
 * Birlashtirish ataylab YO'Q (pul amali): qaysi yozuv asl ekanini odam hal qiladi, ortiqchasini
 * "Nofaol qilish" mumkin.
 */
export default function DuplicatesPanel() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)

  const q = useQuery<DupData>({
    queryKey: [...ekoKeys.reports, 'duplicates'],
    queryFn: async () => (await ekoApi.get('/monitoring/duplicates')).data.data,
    staleTime: 60_000,
  })
  const data = q.data

  async function deactivate(e: DupEntity) {
    const ok = await confirm({
      title: 'Tashkilotni nofaol qilish',
      message: <><b>{e.name}</b> nofaol qilinadi: unga hisob yozilmaydi va SMS bormaydi.</>,
      consequences: [
        `${f.num(e.paymentsCount)} ta to'lov yozuvi saqlanadi`,
        ...(e.debtAmount > 0 ? [`Qarzi bor: ${f.money(e.debtAmount)}`] : []),
      ],
      confirmLabel: 'Nofaol qilish',
      danger: true,
    })
    if (!ok) return
    setBusyId(e.id)
    try {
      await ekoApi.put(`/entities/${e.id}`, { status: 'inactive' })
      toast.success('Nofaol qilindi')
      invalidateEko(qc, 'entity')
      q.refetch()
    } catch (err) {
      toast.error(errMsg(err))
    } finally { setBusyId(null) }
  }

  return (
    <Card flush>
      <CardHeader
        title="Takroriy tashkilotlar"
        hint={data
          ? data.groups.length > 0
            ? `${data.groups.length} ta shubhali guruh · ${f.num(data.scanned)} ta tashkilot tekshirildi`
            : `${f.num(data.scanned)} ta tashkilot tekshirildi`
          : undefined}
        actions={<Button variant="ghost" size="sm" onClick={() => q.refetch()} loading={q.isFetching}>Yangilash</Button>}
      />
      {q.isLoading ? (
        <SkeletonList rows={2} />
      ) : q.isError || !data ? (
        <ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} compact />
      ) : (
        <>
          {data.truncated && (
            <div className="px-4 sm:px-5 pt-4">
              <Banner tone="info">Tashkilotlar ko'p bo'lgani uchun takrorlar qisman qidirildi ({f.num(data.scanned)} / {f.num(data.total ?? data.scanned)}).</Banner>
            </div>
          )}
          {data.groups.length === 0 ? (
            <EmptyState tone="success" compact title="Takror topilmadi" hint="STIR va nom bo'yicha shubhali juftlik yo'q." />
          ) : (
            <>
              <div className="px-4 sm:px-5 pt-4">
                <Banner tone="warn">
                  To'lovlari ko'p yozuvni qoldirib, bo'shini nofaol qiling. Birlashtirish avtomatik qilinmaydi — qaysi yozuv asl ekanini siz hal qilasiz.
                </Banner>
              </div>
              <div className="mt-3">
                {data.groups.map((g, i) => (
                  <div key={i} className="border-t border-eko-line first:border-t-0">
                    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2 bg-eko-surface-2 eko-text-xs text-eko-muted">
                      <span>{g.entities[0]?.name ?? g.key}</span>
                      <Badge tone={g.reason === 'stir' ? 'danger' : 'warn'}>{g.reason === 'stir' ? 'Bir xil STIR' : 'Bir xil nom'}</Badge>
                    </div>
                    {g.entities.map(e => (
                      <div key={e.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-t border-eko-line first:border-t-0">
                        <div className="min-w-0 flex-1">
                          <p className="eko-text-base text-eko-text truncate">{e.name}</p>
                          <p className="eko-text-xs text-eko-muted truncate">
                            {[e.district, e.mahalla].filter(Boolean).join(' / ') || '—'}
                            {e.stir && <> · STIR {e.stir}</>} · {f.date(e.createdAt)}
                            {e.creatorName && <> · {e.creatorName}</>}
                          </p>
                          <p className="eko-text-xs text-eko-muted eko-num">
                            {f.num(e.paymentsCount)} to'lov{e.debtAmount > 0 && <> · qarz {f.num(e.debtAmount)} so'm</>}
                            {e.status === 'inactive' && ' · nofaol'}
                          </p>
                        </div>
                        <RowActions
                          primary={{ label: 'Ochish', onClick: () => navigate('/ekohisob/entities') }}
                          items={e.status === 'inactive' ? [] : [{
                            key: 'deactivate', label: busyId === e.id ? 'Bajarilmoqda…' : 'Nofaol qilish',
                            danger: true, disabled: busyId === e.id, onSelect: () => deactivate(e),
                          }]}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}
