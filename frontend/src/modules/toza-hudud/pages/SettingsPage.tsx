import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Wifi, WifiOff, Save, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import api from '../../../lib/api'

interface ThSettingsData {
  suspiciousSpeedKmh: number
  autoMonitorEnabled: boolean
  coverageGreenPct: number
  coverageYellowPct: number
  gps?: {
    connected: boolean
    host?: string
    lastSyncAt?: string | null
    lastSyncStatus?: string | null
    lastSyncError?: string | null
    tokenExpiresAt?: string | null
  }
}

function formatDt(dt?: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('uz-UZ', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<ThSettingsData>({
    queryKey: ['th-settings'],
    queryFn: () => api.get('/th/settings').then(r => r.data.data),
  })

  // Local form state — server'dan kelgan qiymatlar bilan inicializatsiya
  const [form, setForm] = useState<{
    suspiciousSpeedKmh: number
    autoMonitorEnabled: boolean
    coverageGreenPct: number
    coverageYellowPct: number
  } | null>(null)

  useEffect(() => {
    if (data) {
      setForm({
        suspiciousSpeedKmh: data.suspiciousSpeedKmh,
        autoMonitorEnabled: data.autoMonitorEnabled,
        coverageGreenPct: data.coverageGreenPct,
        coverageYellowPct: data.coverageYellowPct,
      })
    }
  }, [data])

  const updateMut = useMutation({
    mutationFn: (body: typeof form) => api.put('/th/settings', body),
    onSuccess: () => {
      toast.success('Sozlamalar saqlandi')
      qc.invalidateQueries({ queryKey: ['th-settings'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const dirty = data && form && (
    form.suspiciousSpeedKmh !== data.suspiciousSpeedKmh ||
    form.autoMonitorEnabled !== data.autoMonitorEnabled ||
    form.coverageGreenPct !== data.coverageGreenPct ||
    form.coverageYellowPct !== data.coverageYellowPct
  )

  if (isLoading || !form) {
    return (
      <div className="p-6 flex items-center justify-center h-full text-gray-400">
        Yuklanmoqda...
      </div>
    )
  }

  const gps = data?.gps
  const syncOk = gps?.lastSyncStatus === 'ok'

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Sozlamalar</h1>
        <p className="text-sm text-gray-500 mt-0.5">Toza-Hudud monitoring tizimi parametrlari</p>
      </div>

      {/* GPS holat (faqat ko'rsatish) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          {gps?.connected
            ? <Wifi className="w-5 h-5 text-emerald-600" />
            : <WifiOff className="w-5 h-5 text-gray-400" />}
          <p className="font-semibold text-gray-800">GPS ulanishi</p>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
            gps?.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {gps?.connected ? 'Ulangan' : 'Ulanmagan'}
          </span>
        </div>
        {gps?.connected ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Server</p>
              <p className="text-gray-700 font-mono text-xs">{gps.host || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Oxirgi sinx</p>
              <p className="text-gray-700 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                {formatDt(gps.lastSyncAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Sinx holati</p>
              <p className={`flex items-center gap-1 ${syncOk ? 'text-emerald-700' : 'text-red-600'}`}>
                {syncOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {gps.lastSyncStatus || 'noma\'lum'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Token muddati</p>
              <p className="text-gray-700">{formatDt(gps.tokenExpiresAt)}</p>
            </div>
            {gps.lastSyncError && (
              <div className="col-span-2 bg-red-50 border border-red-200 rounded-lg p-2">
                <p className="text-xs font-medium text-red-700">Oxirgi xato:</p>
                <p className="text-xs text-red-600">{gps.lastSyncError}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            GPS ulanishi sozlanmagan. AutoHisob → Sozlamalar → GPS bo'limidan ulang.
          </p>
        )}
      </div>

      {/* Monitoring sozlamalari */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <p className="font-semibold text-gray-800">Monitoring sozlamalari</p>
          <p className="text-xs text-gray-500 mt-0.5">Kunlik tahlil va shubhali holatlarni aniqlash</p>
        </div>

        {/* Avto-monitoring toggle */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoMonitorEnabled}
            onChange={e => setForm(f => f ? { ...f, autoMonitorEnabled: e.target.checked } : f)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">Avtomatik monitoring</p>
            <p className="text-xs text-gray-500">
              Har kuni 20:00 da kechagi kun bo'yicha tahlil avtomatik ishga tushadi
            </p>
          </div>
        </label>

        {/* Suspicious tezlik */}
        <div>
          <label className="block">
            <p className="text-sm font-medium text-gray-800 mb-1">Shubhali tezlik chegarasi</p>
            <p className="text-xs text-gray-500 mb-2">
              MFY ichida bu tezlikdan oshib o'tgan mashina "shubhali" deb belgilanadi
              (chiqindi to'plash uchun ortiqcha tez)
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5} max={200}
                value={form.suspiciousSpeedKmh}
                onChange={e => setForm(f => f ? { ...f, suspiciousSpeedKmh: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">km/h</span>
            </div>
          </label>
        </div>
      </div>

      {/* Hisobot sozlamalari */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <p className="font-semibold text-gray-800">Hisobotlar uchun rang chegaralari</p>
          <p className="text-xs text-gray-500 mt-0.5">Qoplama foiziga qarab ranglarning chegarasi</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label>
            <p className="text-sm font-medium text-gray-800 mb-1">
              <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 mr-1.5 align-middle" />
              Yashil chegarasi (≥)
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={100}
                value={form.coverageGreenPct}
                onChange={e => setForm(f => f ? { ...f, coverageGreenPct: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </label>
          <label>
            <p className="text-sm font-medium text-gray-800 mb-1">
              <span className="inline-block w-3 h-3 rounded-full bg-yellow-400 mr-1.5 align-middle" />
              Sariq chegarasi (≥)
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={100}
                value={form.coverageYellowPct}
                onChange={e => setForm(f => f ? { ...f, coverageYellowPct: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Sariq chegarasidan past = qizil. Yashil chegarasi sariqdan baland bo'lishi shart.
        </p>
      </div>

      {/* Saqlash tugmasi */}
      <div className="flex justify-end gap-2 sticky bottom-0 bg-gray-50 py-3">
        <button
          onClick={() => data && setForm({
            suspiciousSpeedKmh: data.suspiciousSpeedKmh,
            autoMonitorEnabled: data.autoMonitorEnabled,
            coverageGreenPct: data.coverageGreenPct,
            coverageYellowPct: data.coverageYellowPct,
          })}
          disabled={!dirty || updateMut.isPending}
          className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          Bekor qilish
        </button>
        <button
          onClick={() => updateMut.mutate(form)}
          disabled={!dirty || updateMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"
        >
          <Save className="w-4 h-4" />
          {updateMut.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
        </button>
      </div>
    </div>
  )
}
