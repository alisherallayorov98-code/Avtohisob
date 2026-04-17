import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Smartphone, ChevronDown, ChevronUp, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../lib/api'

interface TelegramLink { id: string; deviceLabel: string | null }

interface UserPref {
  insurance: boolean
  techInspection: boolean
  oilChange: boolean
  fuelAnomaly: boolean
  sparePart: boolean
  maintenance: boolean
  monthlyInspection: boolean
  vehicleIds: string[]
}

interface OrgUser {
  id: string
  fullName: string
  role: string
  telegramLinks: TelegramLink[]
  pref: UserPref | null
}

interface Vehicle { id: string; brand: string; model: string; registrationNumber: string }

const ALERT_TYPES: { key: keyof Omit<UserPref, 'vehicleIds'>; label: string; icon: string }[] = [
  { key: 'insurance',         label: "Sug'urta",         icon: '🛡' },
  { key: 'techInspection',    label: 'Texosmotr',         icon: '🔧' },
  { key: 'oilChange',         label: "Motor yog'i",       icon: '🛢' },
  { key: 'fuelAnomaly',       label: "Yoqilg'i anomaliya",icon: '⛽' },
  { key: 'sparePart',         label: 'Ehtiyot qism',      icon: '📦' },
  { key: 'maintenance',       label: "Ta'mirlash",        icon: '🔩' },
  { key: 'monthlyInspection', label: 'Oylik ko\'rik',     icon: '📋' },
]

const DEFAULT_PREF: UserPref = {
  insurance: true, techInspection: true, oilChange: true,
  fuelAnomaly: true, sparePart: true, maintenance: true,
  monthlyInspection: true, vehicleIds: [],
}

function roleBadge(role: string) {
  const map: Record<string, { label: string; cls: string }> = {
    admin:          { label: 'Admin',          cls: 'bg-purple-100 text-purple-700' },
    branch_manager: { label: 'Filial boshqaruvchi', cls: 'bg-blue-100 text-blue-700' },
    super_admin:    { label: 'Super Admin',    cls: 'bg-red-100 text-red-700' },
  }
  const r = map[role] ?? { label: role, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.cls}`}>{r.label}</span>
}

export default function TelegramAdmin() {
  const qc = useQueryClient()
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set())
  const [localPrefs, setLocalPrefs] = useState<Map<string, UserPref>>(new Map())

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['telegram', 'admin', 'prefs'],
    queryFn: () => api.get<any>('/telegram/admin/prefs').then(r => r.data.data as OrgUser[]),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api.get<any>('/vehicles?limit=500').then(r => r.data.data?.items ?? r.data.data ?? []),
  })

  const vehicles: Vehicle[] = vehiclesData ?? []
  const users: OrgUser[] = usersData ?? []

  const saveMutation = useMutation({
    mutationFn: ({ userId, pref }: { userId: string; pref: UserPref }) =>
      api.put(`/telegram/admin/prefs/${userId}`, pref),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegram', 'admin', 'prefs'] })
      toast.success('Saqlandi')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const getPref = useCallback((user: OrgUser): UserPref => {
    return localPrefs.get(user.id) ?? user.pref ?? DEFAULT_PREF
  }, [localPrefs])

  const toggleAlert = useCallback((user: OrgUser, key: keyof Omit<UserPref, 'vehicleIds'>) => {
    const current = getPref(user)
    const updated = { ...current, [key]: !current[key] }
    setLocalPrefs(prev => new Map(prev).set(user.id, updated))
    saveMutation.mutate({ userId: user.id, pref: updated })
  }, [getPref, saveMutation])

  const toggleVehicle = useCallback((user: OrgUser, vehicleId: string) => {
    const current = getPref(user)
    const ids = current.vehicleIds.includes(vehicleId)
      ? current.vehicleIds.filter(id => id !== vehicleId)
      : [...current.vehicleIds, vehicleId]
    const updated = { ...current, vehicleIds: ids }
    setLocalPrefs(prev => new Map(prev).set(user.id, updated))
  }, [getPref])

  const saveVehicles = useCallback((user: OrgUser) => {
    saveMutation.mutate({ userId: user.id, pref: getPref(user) })
  }, [getPref, saveMutation])

  const toggleExpand = (userId: string) => {
    setExpandedVehicles(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 rounded-xl">
          <Send className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Telegram Xabarnomalar Boshqaruvi</h1>
          <p className="text-sm text-gray-500">Har bir xodim qaysi ogohlantirishlarni qaysi mashinalar uchun olishini belgilang</p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Send className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Tashkilotda admin yoki filial boshqaruvchisi topilmadi</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map(user => {
            const pref = getPref(user)
            const isExpanded = expandedVehicles.has(user.id)
            const hasVehicleFilter = pref.vehicleIds.length > 0

            return (
              <div key={user.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* User header */}
                <div className="flex items-center gap-4 p-4 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{user.fullName}</span>
                      {roleBadge(user.role)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 shrink-0">
                    <Smartphone className="w-4 h-4" />
                    <span>{user.telegramLinks.length} ta qurilma</span>
                    {user.telegramLinks.length === 0 && (
                      <span className="text-xs text-orange-500">(ulanmagan)</span>
                    )}
                  </div>
                </div>

                {/* Alert type toggles */}
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  {ALERT_TYPES.map(({ key, label, icon }) => {
                    const enabled = pref[key]
                    return (
                      <button
                        key={key}
                        onClick={() => toggleAlert(user, key)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${
                          enabled
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-gray-50 text-gray-400'
                        }`}
                      >
                        <span className="text-xl leading-none">{icon}</span>
                        <span className="text-xs font-medium leading-tight">{label}</span>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          enabled ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                        }`}>
                          {enabled && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Vehicle filter */}
                <div className="border-t border-gray-100 px-4 py-3">
                  <button
                    onClick={() => toggleExpand(user.id)}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <span className="font-medium">Mashinalar filtri:</span>
                    {hasVehicleFilter
                      ? <span className="text-blue-600">{pref.vehicleIds.length} ta tanlangan</span>
                      : <span className="text-green-600">Hammasi</span>
                    }
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-400">Bo'sh qoldiring = barcha mashinalar uchun ogohlantirish keladi</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                        {vehicles.map(v => {
                          const selected = pref.vehicleIds.includes(v.id)
                          return (
                            <label
                              key={v.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                selected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleVehicle(user, v.id)}
                                className="w-4 h-4 accent-blue-500"
                              />
                              <span className="text-sm text-gray-700 truncate">
                                {v.brand} {v.model} <span className="text-gray-400">({v.registrationNumber})</span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                      <button
                        onClick={() => saveVehicles(user)}
                        disabled={saveMutation.isPending}
                        className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        Saqlash
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500 space-y-1">
        <p className="font-medium text-gray-700">Eslatma:</p>
        <p>• Har bir toggle — o'sha turdagi ogohlantirish foydalanuvchining Telegram qurilmalariga yetib boradi yoki yo'q</p>
        <p>• Mashinalar filtri bo'sh bo'lsa — barcha mashinalar uchun xabar keladi</p>
        <p>• Qurilma ulanmagan xodimga Telegram xabar bormaydi (saytdagi bildiriishnomalar ishlayveradi)</p>
      </div>
    </div>
  )
}
