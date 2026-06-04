import { useState, useEffect, useCallback } from 'react'
import { Building2, CheckCircle2, AlertCircle, DollarSign, ChevronDown, ChevronRight, Loader2, RefreshCw, CalendarPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import { useEkoAuthStore } from '../stores/ekoAuthStore'

const UZ_MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
]

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  return `${UZ_MONTHS[parseInt(m) - 1]} ${year}`
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('uz-UZ') + " so'm"
}

interface Stats {
  totalEntities: number
  paidThisMonth: number
  unpaidThisMonth: number
  collectedAmount: number
}

interface Entity {
  id: string
  name: string
  address: string
  monthlyFee: number
  unpaidMonths: string[]
  paidToday?: boolean
}

interface MahallaGroup {
  mahallId: string
  mahallName: string
  entities: Entity[]
}

interface District {
  id: string
  name: string
}

interface Mahalla {
  id: string
  name: string
  districtId: string
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [groups, setGroups] = useState<MahallaGroup[]>([])
  const [paidToday, setPaidToday] = useState<Entity[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [mahallas, setMahallas] = useState<Mahalla[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [selectedMahalla, setSelectedMahalla] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [collapsedMahallaIds, setCollapsedMahallaIds] = useState<Set<string>>(new Set())
  const [paymentEntity, setPaymentEntity] = useState<EntityBasic | null>(null)
  const [activeTab, setActiveTab] = useState<'unpaid' | 'paid'>('unpaid')
  const [generating, setGenerating] = useState(false)
  const isAdmin = useEkoAuthStore(s => s.user?.role === 'admin')

  async function handleGenerateCharges() {
    setGenerating(true)
    try {
      const res = await ekoApi.post('/charges/generate', { month })
      const created = res.data.data?.created ?? 0
      toast.success(`${created} ta hisob yaratildi`)
      fetchStats()
      fetchDaily()
    } catch {
      toast.error('Hisoblarni yaratishda xato')
    } finally {
      setGenerating(false)
    }
  }

  // Fetch districts
  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  // Fetch mahallas when district changes
  useEffect(() => {
    if (!selectedDistrict) {
      setMahallas([])
      setSelectedMahalla('')
      return
    }
    ekoApi.get(`/mahallas?districtId=${selectedDistrict}`).then(res => {
      const data = res.data.data ?? res.data
      setMahallas(Array.isArray(data) ? data : [])
      setSelectedMahalla('')
    }).catch(() => {})
  }, [selectedDistrict])

  const fetchStats = useCallback(() => {
    setStatsLoading(true)
    ekoApi.get(`/dashboard/stats?districtId=${selectedDistrict}`)
      .then(res => {
        const data = res.data.data ?? res.data
        setStats(data)
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [selectedDistrict])

  const fetchDaily = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedDistrict) params.set('districtId', selectedDistrict)
    if (selectedMahalla) params.set('mahallId', selectedMahalla)
    params.set('month', month)
    ekoApi.get(`/dashboard/daily?${params.toString()}`)
      .then(res => {
        const data = res.data.data ?? res.data
        const groupList: MahallaGroup[] = data.groups ?? []
        const paid: Entity[] = data.paidToday ?? []
        setGroups(groupList)
        setPaidToday(paid)
      })
      .catch(() => {
        setGroups([])
        setPaidToday([])
      })
      .finally(() => setLoading(false))
  }, [selectedDistrict, selectedMahalla, month])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    fetchDaily()
  }, [fetchDaily])

  function toggleMahalla(id: string) {
    setCollapsedMahallaIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const statsCards = [
    { label: 'Jami tashkilotlar', value: stats?.totalEntities ?? 0, icon: Building2, color: 'bg-blue-50 text-blue-600' },
    { label: 'Bu oy to\'lagan', value: stats?.paidThisMonth ?? 0, icon: CheckCircle2, color: 'bg-green-50 text-green-600' },
    { label: "Bu oy to'lamagan", value: stats?.unpaidThisMonth ?? 0, icon: AlertCircle, color: 'bg-red-50 text-red-600' },
    { label: 'Yig\'ilgan summa', value: formatAmount(stats?.collectedAmount ?? 0), icon: DollarSign, color: 'bg-emerald-50 text-emerald-600', isAmount: true },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statsCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 leading-tight">{label}</p>
                <p className={`font-bold text-gray-900 truncate ${statsLoading ? 'opacity-50' : ''} ${typeof value === 'string' ? 'text-sm' : 'text-lg'}`}>
                  {statsLoading ? '...' : String(value)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tuman</label>
            <select
              value={selectedDistrict}
              onChange={e => setSelectedDistrict(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[140px]"
            >
              <option value="">Barcha tumanlar</option>
              {districts.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {selectedDistrict && mahallas.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mahalla</label>
              <select
                value={selectedMahalla}
                onChange={e => setSelectedMahalla(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[140px]"
              >
                <option value="">Barcha mahallalar</option>
                {mahallas.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Oy</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <button
            onClick={() => { fetchStats(); fetchDaily() }}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Yangilash
          </button>

          {isAdmin && (
            <button
              onClick={handleGenerateCharges}
              disabled={generating}
              title="Belgilangan-oylik tashkilotlarga shu oy uchun hisob yaratadi"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
              Hisoblarni yarat
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('unpaid')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'unpaid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          To'lanmaganlar
        </button>
        <button
          onClick={() => setActiveTab('paid')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'paid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Bugun to'langanlar ({paidToday.length})
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      )}

      {/* Unpaid tab */}
      {!loading && activeTab === 'unpaid' && (
        <div className="space-y-3">
          {groups.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">{formatMonth(month)} uchun barcha to'lovlar amalga oshirilgan</p>
              <p className="text-gray-400 text-sm mt-1">Tabriklaymiz!</p>
            </div>
          ) : (
            groups.map(group => {
              const isCollapsed = collapsedMahallaIds.has(group.mahallId)
              return (
                <div key={group.mahallId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  {/* Mahalla header */}
                  <button
                    onClick={() => toggleMahalla(group.mahallId)}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                      <span className="font-semibold text-gray-800">{group.mahallName}</span>
                      <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
                        {group.entities.length} ta
                      </span>
                    </div>
                  </button>

                  {/* Entities */}
                  {!isCollapsed && (
                    <div className="divide-y divide-gray-50">
                      {group.entities.map(entity => (
                        <div
                          key={entity.id}
                          className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="min-w-0 flex-1 mr-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900 truncate">{entity.name}</p>
                              {entity.unpaidMonths.length > 1 && (
                                <span className="bg-orange-100 text-orange-700 text-xs font-medium px-2 py-0.5 rounded-full shrink-0">
                                  {entity.unpaidMonths.length} oy qarzdor
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{entity.address}</p>
                            <p className="text-xs text-green-700 font-medium mt-0.5">{formatAmount(entity.monthlyFee)}/oy</p>
                          </div>
                          <button
                            onClick={() => setPaymentEntity({
                              id: entity.id,
                              name: entity.name,
                              address: entity.address,
                              monthlyFee: entity.monthlyFee,
                              unpaidMonths: entity.unpaidMonths,
                            })}
                            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            To'landi
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Paid today tab */}
      {!loading && activeTab === 'paid' && (
        <div className="space-y-2">
          {paidToday.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
              <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Bugun hali to'lov qayd etilmagan</p>
            </div>
          ) : (
            paidToday.map(entity => (
              <div
                key={entity.id}
                className="bg-white rounded-xl flex items-center gap-4 px-5 py-3 shadow-sm border border-green-100"
              >
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{entity.name}</p>
                  <p className="text-xs text-gray-500 truncate">{entity.address}</p>
                </div>
                <span className="text-sm font-semibold text-green-700 shrink-0">{formatAmount(entity.monthlyFee)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Payment Modal */}
      {paymentEntity && (
        <PaymentModal
          entity={paymentEntity}
          onClose={() => setPaymentEntity(null)}
          onSuccess={() => {
            fetchStats()
            fetchDaily()
          }}
        />
      )}
    </div>
  )
}
