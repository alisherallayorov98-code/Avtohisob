import { useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import type { Entity, EntityFilterState } from './types'

export const PAGE_SIZE = 20

/** Ro'yxat va Excel eksport BIR XIL filtrni ishlatadi (ekrandagi = fayldagi). */
export function buildEntityParams(filters: EntityFilterState): URLSearchParams {
  const p = new URLSearchParams()
  if (filters.search.trim()) p.set('search', filters.search.trim())
  if (filters.districtId) p.set('districtId', filters.districtId)
  if (filters.mahallId) p.set('mahallId', filters.mahallId)
  if (filters.status) p.set('status', filters.status)
  if (filters.debtLevel) p.set('debtLevel', filters.debtLevel)
  if (filters.billingMode) p.set('billingMode', filters.billingMode)
  if (filters.createdBy) p.set('createdBy', filters.createdBy)
  return p
}

/** Tashkilotlar ro'yxati (react-query; pul/tashkilot o'zgarganda invalidateEko yangilaydi). */
export function useEntitiesQuery(filters: EntityFilterState, page: number) {
  const params = useMemo(() => {
    const p = buildEntityParams(filters)
    p.set('page', String(page))
    p.set('limit', String(PAGE_SIZE))
    return p.toString()
  }, [filters, page])

  return useQuery<{ items: Entity[]; total: number }>({
    queryKey: [...ekoKeys.entities, params],
    queryFn: async () => {
      const res = await ekoApi.get(`/entities?${params}`)
      const list: Entity[] = Array.isArray(res.data.data) ? res.data.data : (res.data.data?.items ?? [])
      return { items: list, total: res.data.meta?.total ?? list.length }
    },
    placeholderData: keepPreviousData,
  })
}
