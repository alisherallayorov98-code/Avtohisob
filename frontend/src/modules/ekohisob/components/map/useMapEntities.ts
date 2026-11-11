import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'

export interface MapEntity {
  id: string; name: string; address: string
  status: 'active' | 'blacklisted' | 'inactive' | 'draft'
  paid: boolean; lat?: number; lng?: number; districtId?: string
  debtMonths: number; monthlyFee: number; cubicPrice: number
  billingMode?: 'monthly_fixed' | 'variable' | 'talon'
  /** Backend hisoblagan HAQIQIY qarz (uchala to'lov rejimi uchun to'g'ri) */
  debtAmount: number
  creatorName?: string | null
}

export interface MapBbox { minLat: number; maxLat: number; minLon: number; maxLon: number }

/** Server javobini MapEntity'ga o'tkazish — YAGONA joy (ilgari 3 nusxa edi). */
export function mapEntity(e: any): MapEntity {
  return {
    id: e.id, name: e.name, address: e.address ?? '',
    status: e.status, paid: Boolean(e.paidThisMonth),
    lat: e.lat ?? undefined, lng: e.lon ?? undefined,
    districtId: e.districtId,
    debtMonths: e.debtMonths ?? e.unpaidMonths?.length ?? 0,
    monthlyFee: e.monthlyFee ?? 0,
    cubicPrice: e.cubicPrice ?? 0,
    billingMode: e.billingMode,
    debtAmount: e.debtAmount ?? 0,
    creatorName: e.creatorName ?? null,
  }
}

export const debtOf = (e: MapEntity) => e.debtAmount ?? 0

const EMPTY: MapEntity[] = []

/**
 * Xarita tashkilotlari: GET /dashboard/map (tuman + ko'rinayotgan hudud bo'yicha).
 * To'lov/qoralama saqlangandan keyin `invalidateEko(qc, 'payment'|'entity')` ekoKeys.map ni yangilaydi.
 */
export function useMapEntities(districtId: string, bbox: MapBbox | null) {
  const bboxKey = bbox
    ? [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon].map(n => n.toFixed(4)).join(',')
    : 'initial'
  const q = useQuery({
    queryKey: [...ekoKeys.map, districtId || 'all', bboxKey],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (districtId) params.set('districtId', districtId)
      if (bbox) {
        params.set('minLat', String(bbox.minLat)); params.set('maxLat', String(bbox.maxLat))
        params.set('minLon', String(bbox.minLon)); params.set('maxLon', String(bbox.maxLon))
      }
      const res = await ekoApi.get(`/dashboard/map?${params}`)
      const data = res.data.data ?? res.data
      const meta = res.data.meta
      return {
        entities: (Array.isArray(data) ? data : []).map(mapEntity),
        truncated: meta?.truncated ? { shown: meta.shown ?? 0, total: meta.total ?? 0 } : null,
      }
    },
    placeholderData: (prev) => prev,   // siljiganda eski markerlar yo'qolmasin
    staleTime: 30_000,
  })
  return {
    entities: q.data?.entities ?? EMPTY,
    truncated: q.data?.truncated ?? null,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    refetch: q.refetch,
  }
}
