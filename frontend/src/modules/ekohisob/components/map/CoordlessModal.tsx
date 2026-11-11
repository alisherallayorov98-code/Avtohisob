import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { ekoKeys } from '../../lib/queries'
import { Button, DataTable, Modal } from '../../ui'

interface Row { id: string; name: string; address: string | null; district?: { name: string } | null }

/**
 * Koordinatasiz tashkilotlar. Xarita API'si (getMapData) faqat koordinatali
 * tashkilotlarni qaytaradi, shuning uchun ro'yxat /entities dan (200 tadan, 5 sahifagacha)
 * olinib, lat/lon yo'qlari ajratiladi.
 */
export default function CoordlessModal({ districtId, onClose }: { districtId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: [...ekoKeys.entities, 'coordless', districtId || 'all'],
    queryFn: async () => {
      const out: Row[] = []
      for (let page = 1; page <= 5; page++) {
        const params = new URLSearchParams({ page: String(page), limit: '200' })
        if (districtId) params.set('districtId', districtId)
        const res = await ekoApi.get(`/entities?${params}`)
        const list: any[] = res.data.data ?? []
        for (const e of list) {
          if ((e.lat == null || e.lon == null) && e.status !== 'inactive') out.push(e)
        }
        const total: number = res.data.meta?.total ?? 0
        if (page * 200 >= total) break
      }
      return out
    },
    staleTime: 60_000,
  })

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Koordinatasiz tashkilotlar"
      hint="Xaritada ko'rinmaydi. Joylashuvni Tashkilotlar sahifasida belgilang."
      footer={<Button variant="secondary" onClick={onClose}>Yopish</Button>}
    >
      <DataTable<Row>
        columns={[
          { key: 'name', title: 'Tashkilot', render: r => r.name },
          { key: 'address', title: 'Manzil', render: r => r.address || '—', mobile: 'secondary' },
          { key: 'district', title: 'Tuman', render: r => r.district?.name ?? '—', mobile: 'secondary' },
        ]}
        rows={q.data ?? []}
        rowKey={r => r.id}
        loading={q.isLoading}
        error={q.isError ? errMsg(q.error) : null}
        onRetry={() => q.refetch()}
        onRowClick={() => navigate('/ekohisob/entities')}
        empty={{ title: 'Hammasida koordinata bor', hint: 'Koordinatasiz faol tashkilot yo\'q.' }}
      />
    </Modal>
  )
}
