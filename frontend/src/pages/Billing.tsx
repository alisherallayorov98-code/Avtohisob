import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Star, Zap, Shield, Building2, CreditCard, Receipt, AlertTriangle, Loader2, Clock, Truck, GitBranch, Users, Lock } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ui/ConfirmDialog'

interface Plan {
  id: string
  name: string
  type: 'free' | 'starter' | 'professional' | 'enterprise'
  priceMonthly: number
  priceYearly: number
  maxVehicles: number
  maxBranches: number
  maxUsers: number
  features: string[]
}

interface Subscription {
  id: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  plan: Plan
  invoices: Invoice[]
}

interface Invoice {
  id: string
  amount: number
  currency: string
  status: string
  paidAt: string | null
  createdAt: string
}

interface UsageItem { current: number; max: number }
interface Usage {
  vehicles: UsageItem
  branches: UsageItem
  users: UsageItem
  plan: { name: string; type: string }
}

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Shield className="w-6 h-6" />,
  starter: <Zap className="w-6 h-6" />,
  professional: <Star className="w-6 h-6" />,
  enterprise: <Building2 className="w-6 h-6" />,
}

const PLAN_COLORS: Record<string, string> = {
  free: 'border-gray-200 dark:border-gray-700',
  starter: 'border-blue-300 dark:border-blue-700',
  professional: 'border-blue-500 ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900',
  enterprise: 'border-purple-500 dark:border-purple-700',
}

const PLAN_BADGE: Record<string, string | null> = {
  free: null,
  starter: null,
  professional: 'Eng mashhur',
  enterprise: 'Korporativ',
}

function fmt(n: number) {
  if (n === 0) return 'Bepul'
  return new Intl.NumberFormat('uz-UZ').format(n) + ' UZS'
}

function fmtLimit(n: number) {
  return n === -1 ? 'Cheksiz' : String(n)
}

export default function Billing() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [upgrading, setUpgrading] = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: async () => {
      const r = await api.get('/billing/plans')
      return r.data.data
    },
  })

  const { data: subscription } = useQuery<Subscription | null>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const r = await api.get('/billing/subscription')
      return r.data.data
    },
  })

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: async () => {
      const r = await api.get('/billing/invoices')
      return r.data.data
    },
  })

  const { data: usage } = useQuery<Usage>({
    queryKey: ['billing-usage'],
    queryFn: async () => {
      const r = await api.get('/billing/usage')
      return r.data.data
    },
    enabled: user?.role === 'admin',
  })

  const upgradeMutation = useMutation({
    mutationFn: async (planId: string) => {
      setUpgrading(planId)
      const r = await api.post('/billing/upgrade', { planId, billingCycle })
      return r.data
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['subscription'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      toast.success(res.message || 'Tarif so\'rovi yuborildi. Admin tasdiqlashini kuting.')
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Xatolik'),
    onSettled: () => setUpgrading(null),
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      await api.post('/billing/cancel')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription'] })
      toast.success('Obuna bekor qilindi')
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Xatolik'),
  })

  const STATUS_COLORS: Record<string, string> = {
    active: 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400',
    trialing: 'text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
    past_due: 'text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400',
    canceled: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
    expired: 'text-gray-700 bg-gray-100 dark:bg-gray-700 dark:text-gray-400',
  }

  // Trial countdown
  const trialDaysLeft = subscription?.status === 'trialing' && subscription.currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Obuna va to'lov</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Tarif rejangizni boshqaring va to'lov tarixini ko'ring</p>
      </div>

      {/* Trial countdown banner */}
      {trialDaysLeft !== null && (
        <div className={`rounded-2xl p-5 flex items-center gap-4 ${
          trialDaysLeft <= 3
            ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700'
            : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700'
        }`}>
          <Clock className={`w-8 h-8 flex-shrink-0 ${trialDaysLeft <= 3 ? 'text-red-500' : 'text-blue-500'}`} />
          <div className="flex-1">
            <p className={`font-semibold ${trialDaysLeft <= 3 ? 'text-red-800 dark:text-red-300' : 'text-blue-800 dark:text-blue-300'}`}>
              {trialDaysLeft === 0 ? 'Sinov davri bugun tugaydi!' : `Sinov davri: ${trialDaysLeft} kun qoldi`}
            </p>
            <p className={`text-sm mt-0.5 ${trialDaysLeft <= 3 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
              Xizmatdan uzluksiz foydalanish uchun tarifni tanlang
            </p>
          </div>
        </div>
      )}

      {/* Pending approval banner */}
      {subscription?.status === 'pending' && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-5 flex items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-500 flex-shrink-0 animate-spin" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300">To'lovingiz tasdiqlanmoqda</p>
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
              <strong>{subscription.plan.name}</strong> tarifi uchun so'rovingiz yuborildi. Admin tasdiqlashidan so'ng tarif faollashadi.
            </p>
          </div>
        </div>
      )}

      {/* Past due warning */}
      {subscription?.status === 'past_due' && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-2xl p-5 flex items-center gap-4">
          <AlertTriangle className="w-8 h-8 text-yellow-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-yellow-800 dark:text-yellow-300">To'lov kechikmoqda</p>
            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-0.5">Hisob ma'lumotlaringizni yangilang yoki muammo hal qilindi</p>
          </div>
        </div>
      )}

      {/* Current Subscription Banner */}
      {subscription && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                {PLAN_ICONS[subscription.plan.type]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900 dark:text-white text-lg">{subscription.plan.name} rejasi</h2>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[subscription.status] || ''}`}>
                    {subscription.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Keyingi to'lov: {new Date(subscription.currentPeriodEnd).toLocaleDateString('uz-UZ')}
                </p>
                {subscription.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                    Obuna davr oxirida bekor qilinadi
                  </div>
                )}
              </div>
            </div>
            {!subscription.cancelAtPeriodEnd && subscription.plan.type !== 'free' && (
              <button
                onClick={() => setCancelConfirm(true)}
                disabled={cancelMutation.isPending}
                className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700 px-4 py-2 rounded-lg transition-colors"
              >
                Obunani bekor qilish
              </button>
            )}
          </div>
        </div>
      )}

      {/* Usage Meters */}
      {usage && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Joriy foydalanish</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[
              { key: 'vehicles', label: 'Avtomobillar', icon: <Truck className="w-5 h-5" />, color: 'blue',  data: usage.vehicles },
              { key: 'branches', label: 'Filiallar',    icon: <GitBranch className="w-5 h-5" />, color: 'purple', data: usage.branches },
              { key: 'users',    label: 'Foydalanuvchilar', icon: <Users className="w-5 h-5" />, color: 'green', data: usage.users },
            ].map(({ key, label, icon, color, data }) => {
              const isUnlimited = data.max === -1
              const pct = isUnlimited ? 0 : Math.min(100, Math.round((data.current / data.max) * 100))
              const isWarning = !isUnlimited && pct >= 80
              const isFull    = !isUnlimited && pct >= 100
              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <span className={`text-${color}-500`}>{icon}</span>
                      {label}
                    </div>
                    <span className={`text-sm font-semibold ${
                      isFull ? 'text-red-600 dark:text-red-400' :
                      isWarning ? 'text-amber-600 dark:text-amber-400' :
                      'text-gray-700 dark:text-gray-300'
                    }`}>
                      {data.current} / {isUnlimited ? '∞' : data.max}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    {!isUnlimited && (
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isFull ? 'bg-red-500' : isWarning ? 'bg-amber-400' : `bg-${color}-500`
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                    {isUnlimited && <div className="h-full bg-green-400 rounded-full w-full opacity-30" />}
                  </div>
                  {isFull && (
                    <p className="text-xs text-red-500 dark:text-red-400">
                      Chegara to'ldi — yangi {label.toLowerCase()} qo'sha olmaysiz
                    </p>
                  )}
                  {isWarning && !isFull && (
                    <p className="text-xs text-amber-500 dark:text-amber-400">
                      Chegaragacha {data.max - data.current} ta qoldi
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Feature availability by plan */}
      {subscription && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Funksiyalar holati</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'excel_export',            name: 'Excel eksport',                minPlan: 'starter',      plans: ['starter','professional','enterprise'] },
              { key: 'ai_analysis',             name: 'AI kalonka tahlili (OCR)',      minPlan: 'starter',      plans: ['starter','professional','enterprise'] },
              { key: 'fuel_analytics',          name: "Yoqilg'i analitikasi",         minPlan: 'starter',      plans: ['starter','professional','enterprise'] },
              { key: 'anomaly_detection',       name: 'Anomaliya aniqlash',           minPlan: 'professional', plans: ['professional','enterprise'] },
              { key: 'health_monitoring',       name: 'Texnika holati monitoringi',   minPlan: 'professional', plans: ['professional','enterprise'] },
              { key: 'maintenance_predictions', name: "Ta'mirlash bashorati",         minPlan: 'professional', plans: ['professional','enterprise'] },
              { key: 'api_access',              name: 'API integratsiya',             minPlan: 'enterprise',   plans: ['enterprise'] },
            ].map(feat => {
              const available = feat.plans.includes(subscription.plan.type)
              return (
                <div key={feat.key} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${
                  available
                    ? 'border-green-100 dark:border-green-900/40 bg-green-50/60 dark:bg-green-900/10'
                    : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30'
                }`}>
                  <div className="flex items-center gap-2.5">
                    {available
                      ? <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      : <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    }
                    <span className={`text-sm ${available ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                      {feat.name}
                    </span>
                  </div>
                  {!available && (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 capitalize">
                      {feat.minPlan === 'starter' ? 'Starter+' : feat.minPlan === 'professional' ? 'Pro+' : 'Enterprise'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Billing Cycle Toggle */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        <button
          onClick={() => setBillingCycle('monthly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${billingCycle === 'monthly' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
        >
          Oylik
        </button>
        <button
          onClick={() => setBillingCycle('yearly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${billingCycle === 'yearly' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
        >
          Yillik
          <span className="ml-1.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded">-17%</span>
        </button>
      </div>

      {/* Plans Grid */}
      {plansLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          {plans.map(plan => {
            const price = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly
            const isCurrentPlan = subscription?.plan.id === plan.id
            const badge = PLAN_BADGE[plan.type]

            return (
              <div key={plan.id} className={`relative bg-white dark:bg-gray-800 rounded-2xl border p-6 flex flex-col ${PLAN_COLORS[plan.type]}`}>
                {badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full shadow">{badge}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                    {PLAN_ICONS[plan.type]}
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{plan.name}</h3>
                </div>

                <div className="mb-6">
                  <span className="text-3xl font-bold text-gray-900 dark:text-white">
                    {plan.priceMonthly === 0 ? 'Bepul' : new Intl.NumberFormat('uz-UZ').format(Number(price))}
                  </span>
                  {plan.priceMonthly > 0 && (
                    <span className="text-sm text-gray-500 ml-1">UZS / {billingCycle === 'yearly' ? 'yil' : 'oy'}</span>
                  )}
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 mb-4">
                  <div>{fmtLimit(plan.maxVehicles)} avtomobil</div>
                  <div>{fmtLimit(plan.maxBranches)} filial</div>
                  <div>{fmtLimit(plan.maxUsers)} foydalanuvchi</div>
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {(Array.isArray(plan.features) ? plan.features : JSON.parse(plan.features as unknown as string || '[]')).map((f: string) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => !isCurrentPlan && subscription?.status !== 'pending' && upgradeMutation.mutate(plan.id)}
                  disabled={isCurrentPlan || upgrading === plan.id || subscription?.status === 'pending'}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${
                    isCurrentPlan || subscription?.status === 'pending'
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-default'
                      : plan.type === 'professional'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-900 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white'
                  }`}
                >
                  {upgrading === plan.id ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : isCurrentPlan ? (
                    'Joriy reja'
                  ) : subscription?.status === 'pending' ? (
                    'Kutilmoqda...'
                  ) : (
                    'Tanlash'
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Payment Methods */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">To'lov usullari</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Obunangizni quyidagi to'lov tizimlari orqali to'lashingiz mumkin
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Payme */}
          <div className="relative flex items-center gap-4 p-4 rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 opacity-70 cursor-not-allowed">
            <span className="absolute top-2 right-2 text-[10px] font-bold bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full">Tez Orada</span>
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-md">
              <span className="text-white font-black text-lg tracking-tight">P</span>
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900 dark:text-white">Payme</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Karta yoki Payme ilovasi orqali</p>
            </div>
          </div>

          {/* Click */}
          <div className="relative flex items-center gap-4 p-4 rounded-xl border-2 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 opacity-70 cursor-not-allowed"
          >
            <span className="absolute top-2 right-2 text-[10px] font-bold bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 px-1.5 py-0.5 rounded-full">Tez Orada</span>
            <div className="w-12 h-12 rounded-xl bg-green-600 flex items-center justify-center flex-shrink-0 shadow-md">
              <span className="text-white font-black text-lg tracking-tight">C</span>
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900 dark:text-white">Click</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Click ilovasi yoki internet-bank</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
          To'lov integratsiyasi tez orada ishga tushiriladi. Hozircha admin bilan bog'laning.
        </p>
      </div>

      {/* Invoice History */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <Receipt className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">To'lov tarixi</h2>
        </div>
        {invoices.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-40" />
            To'lovlar hali yo'q
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  {['Sana', 'Summa', 'Valyuta', 'Holat', 'To\'langan'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-6 py-4 text-gray-900 dark:text-white">{new Date(inv.createdAt).toLocaleDateString('uz-UZ')}</td>
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{new Intl.NumberFormat('uz-UZ').format(Number(inv.amount))}</td>
                    <td className="px-6 py-4 text-gray-500">{inv.currency}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                        {inv.status === 'paid' ? 'To\'langan' : 'Kutilmoqda'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('uz-UZ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={cancelConfirm}
        title="Obunani bekor qilish"
        message="Obunani bekor qilishni tasdiqlaysizmi? Joriy davr oxirigacha foydalanishingiz mumkin."
        confirmLabel="Ha, bekor qilish"
        loading={cancelMutation.isPending}
        onConfirm={() => { cancelMutation.mutate(); setCancelConfirm(false) }}
        onCancel={() => setCancelConfirm(false)}
      />
    </div>
  )
}
