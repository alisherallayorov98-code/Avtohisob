import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CreditCard, X, Clock, ShieldAlert } from 'lucide-react'
import { useState, useEffect } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

interface Subscription {
  status: string
  currentPeriodEnd: string
  plan?: { name: string } | null
}

const SESSION_KEY = 'sub_modal_dismissed'

export default function SubscriptionBanner() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [modalDismissed, setModalDismissed] = useState(
    () => !!sessionStorage.getItem(SESSION_KEY)
  )
  const [bannerDismissed, setBannerDismissed] = useState(false)

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

  // Yangi sessiyada modal yana chiqsin
  useEffect(() => {
    if (subscription && (subscription.status === 'past_due' || subscription.status === 'expired')) {
      const alreadySeen = sessionStorage.getItem(SESSION_KEY)
      if (!alreadySeen) setModalDismissed(false)
    }
  }, [subscription?.status])

  function dismissModal() {
    sessionStorage.setItem(SESSION_KEY, '1')
    setModalDismissed(true)
  }

  function goToBilling() {
    dismissModal()
    navigate('/billing')
  }

  if (!subscription) return null
  const status = subscription.status
  if (status !== 'past_due' && status !== 'expired') return null

  const isExpired = status === 'expired'
  const daysLeft = subscription.currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / 86400000))
    : 0

  return (
    <>
      {/* ── Markaziy modal (sessiyada bir marta) ── */}
      {!modalDismissed && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Yuqori rangli chiziq */}
            <div className={`h-1.5 w-full ${isExpired ? 'bg-red-500' : 'bg-amber-400'}`} />

            <div className="p-6">
              {/* Icon + sarlavha */}
              <div className="flex flex-col items-center text-center mb-5">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                  isExpired
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                }`}>
                  {isExpired
                    ? <ShieldAlert className="w-8 h-8" />
                    : <Clock className="w-8 h-8" />}
                </div>

                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {isExpired ? 'Obuna muddati tugagan' : "To'lov muddati o'tib ketdi"}
                </h2>

                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                  {isExpired
                    ? `"${subscription.plan?.name || 'Obuna'}" tarifi faol emas. Hozirda faqat bepul rejaning imkoniyatlaridan foydalana olasiz (3 avtomobil, 2 foydalanuvchi).`
                    : `Obuna muddati ${daysLeft > 0 ? `${daysLeft} kun ichida` : 'bugun'} tugaydi. To'lovni amalga oshirmасангиз, tez orada cheklovlar kuchga kiradi.`}
                </p>
              </div>

              {/* Plan ma'lumoti */}
              <div className={`rounded-xl px-4 py-3 mb-5 flex items-center gap-3 text-sm ${
                isExpired
                  ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                  : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
              }`}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  {isExpired
                    ? 'Premium funksiyalar (Excel, AI, anomaliya va b.) vaqtincha cheklangan'
                    : "To'lovni o'z vaqtida amalga oshiring — ma'lumotlaringiz saqlanib qoladi"}
                </span>
              </div>

              {/* Tugmalar */}
              <div className="flex gap-3">
                <button
                  onClick={dismissModal}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  Keyinroq
                </button>
                <button
                  onClick={goToBilling}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${
                    isExpired
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-amber-500 hover:bg-amber-600'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  Obunani yangilash
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Yuqori tor banner (modal yopilgandan keyin eslatma) ── */}
      {modalDismissed && !bannerDismissed && (
        <div className={`flex items-center gap-3 px-4 py-2 ${
          isExpired ? 'bg-red-600' : 'bg-amber-500'
        } text-white text-sm`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">
              {isExpired ? 'Obuna muddati tugagan.' : "To'lov muddati o'tib ketdi."}
            </span>{' '}
            <span className="opacity-90">
              {isExpired
                ? 'Cheklovlar kuchga kirgan.'
                : 'Tez orada cheklovlar boshlanadi.'}
            </span>
          </div>
          <button
            onClick={() => { dismissModal(); navigate('/billing') }}
            className="flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Yangilash
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            className="p-1 hover:bg-white/20 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  )
}
