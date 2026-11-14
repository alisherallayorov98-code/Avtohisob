// Filial mas'uli uchun: markazdan javob kutayotgan savol bo'lsa — har sahifa tepasida sariq yo'lak.
// Javob berilgach (yoki savol hal bo'lgach) o'zi yo'qoladi. Sidebar bilan bir xil so'rov (kesh umumiy).
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Inbox, ArrowRight } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

const BRANCH_ROLES = ['manager', 'branch_manager', 'operator']

export default function InsightRequestStrip() {
  const role = useAuthStore(s => s.user?.role ?? '')
  const { pathname } = useLocation()
  const enabled = BRANCH_ROLES.includes(role)
  const { data } = useQuery<{ count: number }>({
    queryKey: ['insight-badge'],
    queryFn: () => api.get('/insight-requests/badge').then(r => r.data.data),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const n = data?.count || 0
  if (!enabled || n === 0 || pathname.startsWith('/insight-requests')) return null
  return (
    <Link to="/insight-requests"
      className="flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 text-amber-950 text-sm font-semibold transition-colors">
      <Inbox className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">Markazdan {n} ta savol keldi — javob bering</span>
      <ArrowRight className="w-4 h-4 flex-shrink-0" />
    </Link>
  )
}
