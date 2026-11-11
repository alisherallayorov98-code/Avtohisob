/**
 * EkoHisob — react-query kesh qatlami (spravochniklar va umumiy kalitlar).
 *
 * Ilgari modul react-query'ni umuman ishlatmasdi: `/districts` har sahifada va har
 * modalda qayta yuklanardi, to'lovdan keyin ro'yxatlar qo'lda yangilanardi. Endi
 * spravochniklar (tuman, mahalla) keshlanadi va to'lov/tashkilot o'zgarganda
 * `invalidateEko(qc, ...)` bilan tegishli kalitlar yangilanadi.
 *
 * Qoida: yangi sahifada tuman/mahalla uchun `ekoApi.get('/districts')` YOZILMAYDI —
 * `useDistricts()` / `useMahallas()` ishlatiladi.
 */
import { useQuery, QueryClient } from '@tanstack/react-query'
import ekoApi from './ekoApi'

export interface EkoDistrict { id: string; name: string; [k: string]: any }
export interface EkoMahalla { id: string; name: string; districtId: string; [k: string]: any }

export const ekoKeys = {
  all: ['eko'] as const,
  districts: ['eko', 'districts'] as const,
  mahallas: (districtId?: string | null) => ['eko', 'mahallas', districtId ?? 'all'] as const,
  entities: ['eko', 'entities'] as const,
  dashboard: ['eko', 'dashboard'] as const,
  reports: ['eko', 'reports'] as const,
  map: ['eko', 'map'] as const,
  payments: ['eko', 'payments'] as const,
  talons: ['eko', 'talons'] as const,
  blacklist: ['eko', 'blacklist'] as const,
  users: ['eko', 'users'] as const,
  plans: ['eko', 'plans'] as const,
  kpi: ['eko', 'kpi'] as const,
  audit: ['eko', 'audit'] as const,
  settings: ['eko', 'settings'] as const,
}

const REF_STALE = 10 * 60 * 1000 // spravochnik 10 daqiqa

export function useDistricts() {
  return useQuery<EkoDistrict[]>({
    queryKey: ekoKeys.districts,
    queryFn: async () => (await ekoApi.get('/districts')).data.data ?? [],
    staleTime: REF_STALE,
  })
}

export function useMahallas(districtId?: string | null) {
  return useQuery<EkoMahalla[]>({
    queryKey: ekoKeys.mahallas(districtId),
    queryFn: async () => {
      const q = districtId ? `?districtId=${encodeURIComponent(districtId)}` : ''
      return (await ekoApi.get(`/mahallas${q}`)).data.data ?? []
    },
    enabled: districtId !== '',        // '' (tanlanmagan) — so'rov yuborilmaydi; undefined — hammasi
    staleTime: REF_STALE,
  })
}

/**
 * Pul/tashkilot o'zgarganda bog'liq kalitlarni yangilash.
 *   'payment'  — to'lov yozildi/bekor qilindi/talon to'landi
 *   'entity'   — tashkilot yaratildi/o'zgardi/qora ro'yxat
 *   'reference'— tuman/mahalla o'zgardi
 */
export function invalidateEko(qc: QueryClient, what: 'payment' | 'entity' | 'reference' | 'all' = 'all') {
  const keys: ReadonlyArray<readonly unknown[]> =
    what === 'payment'
      ? [ekoKeys.entities, ekoKeys.dashboard, ekoKeys.reports, ekoKeys.map, ekoKeys.payments, ekoKeys.talons, ekoKeys.kpi]
    : what === 'entity'
      ? [ekoKeys.entities, ekoKeys.dashboard, ekoKeys.reports, ekoKeys.map, ekoKeys.blacklist]
    : what === 'reference'
      ? [ekoKeys.districts, ['eko', 'mahallas']]
    : [ekoKeys.all]
  for (const k of keys) qc.invalidateQueries({ queryKey: k as unknown[] })
}
