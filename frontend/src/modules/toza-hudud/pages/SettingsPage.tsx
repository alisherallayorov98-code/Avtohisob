import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Wifi, WifiOff, Save, AlertTriangle, CheckCircle2, Clock,
  Bell, BellOff, QrCode, Key, Shield, Eye, EyeOff,
} from 'lucide-react'
import api from '../../../lib/api'

interface ThSettingsData {
  suspiciousSpeedKmh: number
  autoMonitorEnabled: boolean
  coverageGreenPct: number
  coverageYellowPct: number
  notifyOnMonitorComplete: boolean
  notifyOnLowCoverage: boolean
  notifyMinCoveragePct: number
  driverAccessEnabled: boolean
  driverPinSet: boolean
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

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-4">
      <p className="font-semibold text-gray-800">{title}</p>
      {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<ThSettingsData>({
    queryKey: ['th-settings'],
    queryFn: () => api.get('/th/settings').then(r => r.data.data),
  })

  const [form, setForm] = useState<Omit<ThSettingsData, 'gps' | 'driverPinSet'> | null>(null)
  const [newPin, setNewPin] = useState('')
  const [showPin, setShowPin] = useState(false)

  useEffect(() => {
    if (data && !form) {
      setForm({
        suspiciousSpeedKmh: data.suspiciousSpeedKmh,
        autoMonitorEnabled: data.autoMonitorEnabled,
        coverageGreenPct: data.coverageGreenPct,
        coverageYellowPct: data.coverageYellowPct,
        notifyOnMonitorComplete: data.notifyOnMonitorComplete,
        notifyOnLowCoverage: data.notifyOnLowCoverage,
        notifyMinCoveragePct: data.notifyMinCoveragePct,
        driverAccessEnabled: data.driverAccessEnabled,
      })
    }
  }, [data])

  const updateMut = useMutation({
    mutationFn: (body: any) => api.put('/th/settings', body),
    onSuccess: () => {
      toast.success('Sozlamalar saqlandi')
      qc.invalidateQueries({ queryKey: ['th-settings'] })
      setNewPin('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleSave = () => {
    if (!form) return
    const body: any = { ...form }
    if (newPin) body.driverPin = newPin
    updateMut.mutate(body)
  }

  const dirty = !!form

  if (isLoading || !form) return (
    <div className="p-6 flex items-center justify-center h-full text-gray-400">Yuklanmoqda...</div>
  )

  const gps = data?.gps
  const syncOk = gps?.lastSyncStatus === 'ok'

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Sozlamalar</h1>
        <p className="text-sm text-gray-500 mt-0.5">Toza-Hudud monitoring tizimi parametrlari</p>
      </div>

      {/* GPS holat */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <SectionTitle title="GPS ulanishi" />
        <div className="flex items-center gap-2 mb-3">
          {gps?.connected
            ? <Wifi className="w-5 h-5 text-emerald-600" />
            : <WifiOff className="w-5 h-5 text-gray-400" />}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
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
              <p className="text-gray-700 flex items-center gap-1 text-xs">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                {formatDt(gps.lastSyncAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Sinx holati</p>
              <p className={`flex items-center gap-1 text-sm ${syncOk ? 'text-emerald-700' : 'text-red-600'}`}>
                {syncOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {gps.lastSyncStatus || 'noma\'lum'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Token muddati</p>
              <p className="text-gray-700 text-xs">{formatDt(gps.tokenExpiresAt)}</p>
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
        <SectionTitle
          title="Monitoring sozlamalari"
          desc="Kunlik tahlil va shubhali holatlarni aniqlash"
        />

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoMonitorEnabled}
            onChange={e => setForm(f => f ? { ...f, autoMonitorEnabled: e.target.checked } : f)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">Avtomatik monitoring</p>
            <p className="text-xs text-gray-500">Har kuni 20:00 da avtomatik tahlil ishga tushadi</p>
          </div>
        </label>

        <div>
          <label className="block">
            <p className="text-sm font-medium text-gray-800 mb-1">Shubhali tezlik chegarasi</p>
            <p className="text-xs text-gray-500 mb-2">MFY ichida bu tezlikdan oshsa — "shubhali" belgilanadi</p>
            <div className="flex items-center gap-2">
              <input
                type="number" min={5} max={200}
                value={form.suspiciousSpeedKmh}
                onChange={e => setForm(f => f ? { ...f, suspiciousSpeedKmh: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">km/h</span>
            </div>
          </label>
        </div>
      </div>

      {/* Hisobot rang chegaralari */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <SectionTitle
          title="Rang chegaralari"
          desc="Qoplama foiziga qarab hisobotlarda ranglarning chegarasi"
        />
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
        <p className="text-xs text-gray-500">Sariq chegarasidan past = qizil. Yashil sariqdan baland bo'lishi shart.</p>
      </div>

      {/* Telegram bildirishnomalar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-4 h-4 text-blue-600" />
          <SectionTitle
            title="Telegram bildirishnomalar"
            desc="Monitoring tugagach va qoplama past bo'lganda xabar yuboriladi"
          />
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.notifyOnMonitorComplete}
            onChange={e => setForm(f => f ? { ...f, notifyOnMonitorComplete: e.target.checked } : f)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">Monitoring tugagach xabar</p>
            <p className="text-xs text-gray-500">Har kungi 20:00 monitoring tugagach natijalar Telegram'ga yuboriladi</p>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.notifyOnLowCoverage}
            onChange={e => setForm(f => f ? { ...f, notifyOnLowCoverage: e.target.checked } : f)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">Past qoplama ogohlantirishi</p>
            <p className="text-xs text-gray-500">Qoplama belgilangan chegaradan past bo'lganda alohida ogohlantirish</p>
          </div>
        </label>

        {form.notifyOnLowCoverage && (
          <div className="ml-7">
            <p className="text-sm font-medium text-gray-800 mb-1">Ogohlantirish chegarasi</p>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={100}
                value={form.notifyMinCoveragePct}
                onChange={e => setForm(f => f ? { ...f, notifyMinCoveragePct: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">% dan past bo'lsa ogohlantirish</span>
            </div>
          </div>
        )}

        {!data?.gps?.connected && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
            <BellOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Telegram bot ulangan bo'lmasa xabarlar ketmaydi. AutoHisob → Sozlamalar → Telegram bo'limidan ulang.
            </p>
          </div>
        )}
      </div>

      {/* Haydovchi kirish tizimi */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <QrCode className="w-4 h-4 text-emerald-600" />
          <SectionTitle
            title="Haydovchi kirish tizimi"
            desc="Haydovchilar QR kod orqali o'z mashinasining bugungi jadvalini ko'ra oladi"
          />
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.driverAccessEnabled}
            onChange={e => setForm(f => f ? { ...f, driverAccessEnabled: e.target.checked } : f)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">Haydovchi kirish tizimini yoqish</p>
            <p className="text-xs text-gray-500">
              Yoqilgandan so'ng "Haydovchi" bo'limidan har mashina uchun QR kod yaratish mumkin
            </p>
          </div>
        </label>

        {form.driverAccessEnabled && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Key className="w-4 h-4 text-gray-500" />
              <p className="text-sm font-medium text-gray-800">Haydovchi PIN kodi</p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                data?.driverPinSet
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {data?.driverPinSet ? 'O\'rnatilgan' : 'O\'rnatilmagan'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Ixtiyoriy — PIN bo'lmasa haydovchilar QR koddan bevosita kirishi mumkin
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  placeholder="Yangi PIN (4-8 raqam)"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  maxLength={8}
                  className="w-44 px-3 py-2 pr-9 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono tracking-widest"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <span className="text-xs text-gray-400">{newPin.length}/8 raqam</span>
            </div>
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                PIN saqlashdan so'ng "Haydovchi" bo'limiga o'ting va har mashina uchun QR kod yarating.
                Haydovchi QR kodni skanerlaydi → PIN kiritadi → o'z jadvalini ko'radi.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Saqlash */}
      <div className="flex justify-end gap-2 sticky bottom-0 bg-gray-50 py-3">
        <button
          onClick={() => {
            if (data) setForm({
              suspiciousSpeedKmh: data.suspiciousSpeedKmh,
              autoMonitorEnabled: data.autoMonitorEnabled,
              coverageGreenPct: data.coverageGreenPct,
              coverageYellowPct: data.coverageYellowPct,
              notifyOnMonitorComplete: data.notifyOnMonitorComplete,
              notifyOnLowCoverage: data.notifyOnLowCoverage,
              notifyMinCoveragePct: data.notifyMinCoveragePct,
              driverAccessEnabled: data.driverAccessEnabled,
            })
            setNewPin('')
          }}
          disabled={updateMut.isPending}
          className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          Bekor qilish
        </button>
        <button
          onClick={handleSave}
          disabled={updateMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"
        >
          <Save className="w-4 h-4" />
          {updateMut.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
        </button>
      </div>
    </div>
  )
}
