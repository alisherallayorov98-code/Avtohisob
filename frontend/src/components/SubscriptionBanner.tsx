import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CreditCard, X } from 'lucide-react'
import { useState } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

interface Subscription {
  status: string
  currentPeriodEnd: string
  plan?: { name: string } | null
}

export default function SubscriptionBanner() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)

  const { data: subscription } = useQuery<Subscription | null>({
    queryKey: ['subscription', 'banner'],
    queryFn: async () => {
      const r = await api.get('/billing/subscription')
      return r.data.data
    },
    enabled: user?.role === 'admin',
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  })

  if (!subscription || dismissed) return null
  const status = subscription.status
  if (status !== 'past_due' && status !== 'expired') return null

  const isExpired = status === 'expired'
  const bg = isExpired ? 'bg-red-600' : 'bg-amber-500'
  const title = isExpired
    ? "Obuna muddati tugagan"
    : "To'lov muddati o'tib ketdi"
  const msg = isExpired
    ? "Yangi xususiyatlarga kirish cheklangan. Yangilang."
    : "Obunangizni yangilamasangiz, tez orada cheklovlar kuchga kiradi."

  return (
    <div className={`flex items-center gap-3 px-4 py-2 ${bg} text-white text-sm`}>
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">{title}.</span>{' '}
        <span className="opacity-90">{msg}</span>
      </div>
      <button
        onClick={() => navigate('/billing')}
        className="flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
      >
        <CreditCard className="w-3.5 h-3.5" />
        Yangilash
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 hover:bg-white/20 rounded transition-colors"
        aria-label="Yopish"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
