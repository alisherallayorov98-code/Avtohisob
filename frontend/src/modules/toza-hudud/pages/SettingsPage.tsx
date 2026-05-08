import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Wifi, WifiOff, Save, AlertTriangle, CheckCircle2, Clock,
  Bell, BellOff, QrCode, Key, Shield, Eye, EyeOff,
  Brain, Loader2, RefreshCw,
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
  gridCellM: number
  coverageRadiusM: number
  minVisitSec: number
  monitorStartHour: number
  monitorEndHour: number
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

// ── AI Coverage Fingerprint bo'limi ──────────────────────────────────────────

function AiTrainingSection() {
  const [started, setStarted] = useState(false)

  const { data: status } = useQuery<{
    total: number; trained: number; lastUpdated: string | null; trainingInProgress: boolean
  }>({
    queryKey: ['th-ai-status'],
    queryFn: () => api.get('/th/ai/status').then(r => r.data.data),
    // Backend trainingInProgress=true bo'lganida 3 soniyada bir yangilanadi
    refetchInterval: (query) => (query.state.data?.trainingInProgress || started) ? 3000 : false,
  })

  const isRunning = status?.trainingInProgress || started

  const handleTrain = async () => {
    if (isRunning) return
    setStarted(true)
    try {
      await api.post('/th/ai/train')
      toast.success("AI o'qitish ishga tushdi. Bu bir necha daqiqa davom etadi.")
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Xatolik yuz berdi")
      setStarted(false)
    }
  }

  // Backend "done" deb aytganda (trainingInProgress=false bo'lganda) started ni tozalaymiz
  useEffect(() => {
    if (started && status && !status.trainingInProgress) {
      setStarted(false)
    }
  }, [started, status?.trainingInProgress])

  const lastUpdated = status?.lastUpdated
    ? new Date(status.lastUpdated).toLocaleString('uz-UZ', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-purple-600" />
        <div>
          <p className="font-semibold text-gray-800">AI Ko'cha Tahlili</p>
          <p className="text-xs text-gray-500 mt-0.5">
            6 oylik GPS tarix asosida har bir mashina + MFY uchun "ko'cha xotirasi" tuziladi.
            Keyinchalik chala qolgan ko'chalar sariq rangda ajratib ko'rsatiladi.
          </p>
        </div>
      </div>

      {status && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-lg font-bold text-gray-800">{status.total}</p>
            <p className="text-xs text-gray-500">Jami jadval</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-3">
            <p className="text-lg font-bold text-purple-700">{status.trained}</p>
            <p className="text-xs text-purple-600">O'rganilgan</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-bold text-gray-700 leading-tight">{lastUpdated || '—'}</p>
            <p className="text-xs text-gray-500">Oxirgi o'qitish</p>
          </div>
        </div>
      )}

      {status && status.trained < status.total && status.trained === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <b>Diqqat:</b> AI hali o'qitilmagan. Tugmani bosib 6 oylik GPS tarixdan o'rganish ishga tushiriladi.
          Bu bir necha daqiqa davom etishi mumkin.
        </div>
      )}

      {isRunning && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-800 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-purple-600 animate-spin flex-shrink-0" />
          GPS tarixlari tahlil qilinmoqda... Bu bir necha daqiqa davom etadi.
        </div>
      )}

      {!isRunning && status && status.trained > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          {status.trained} ta jadval o'rganilgan. Qamrov xaritasida sariq rangda ko'rinadi.
        </div>
      )}

      <button
        onClick={handleTrain}
        disabled={isRunning}
        className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
      >
        {isRunning
          ? <><Loader2 className="w-4 h-4 animate-spin" /> AI o'qitilmoqda...</>
          : <><RefreshCw className="w-4 h-4" /> {status?.trained ? 'AI ni qayta o\'qitish' : 'AI ni o\'qitish'} (6 oy)</>
        }
      </button>

      <p className="text-xs text-gray-400 text-center">
        Har oy bir marta o'qitish yetarli. Yangi mashinalar yoki MFYlar qo'shilganda ham qayta o'qiting.
      </p>
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
        gridCellM: data.gridCellM ?? 35,
        coverageRadiusM: data.coverageRadiusM ?? 40,
        minVisitSec: data.minVisitSec ?? 30,
        monitorStartHour: data.monitorStartHour ?? 6,
        monitorEndHour: data.monitorEndHour ?? 18,
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

      {/* GPS monitoring parametrlari */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <SectionTitle
          title="GPS monitoring parametrlari"
          desc="Qoplama hisoblash va tashrif aniqlash uchun texnik sozlamalar"
        />
        <div className="grid grid-cols-2 gap-4">
          <label>
            <p className="text-sm font-medium text-gray-800 mb-1">Katak o'lchami</p>
            <p className="text-xs text-gray-500 mb-1">Grid katagi kengligi metrda (kichik = aniqroq, sekinroq)</p>
            <div className="flex items-center gap-2">
              <input type="number" min={10} max={100}
                value={form.gridCellM}
                onChange={e => setForm(f => f ? { ...f, gridCellM: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">m</span>
            </div>
          </label>
          <label>
            <p className="text-sm font-medium text-gray-800 mb-1">Qoplama radiusi</p>
            <p className="text-xs text-gray-500 mb-1">GPS nuqtasi atrofida qoplanadigan hudud</p>
            <div className="flex items-center gap-2">
              <input type="number" min={10} max={200}
                value={form.coverageRadiusM}
                onChange={e => setForm(f => f ? { ...f, coverageRadiusM: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">m</span>
            </div>
          </label>
          <label>
            <p className="text-sm font-medium text-gray-800 mb-1">Min. tashrif vaqti</p>
            <p className="text-xs text-gray-500 mb-1">Shu vaqtdan kam bo'lsa — tashrif hisoblanmaydi</p>
            <div className="flex items-center gap-2">
              <input type="number" min={5} max={300}
                value={form.minVisitSec}
                onChange={e => setForm(f => f ? { ...f, minVisitSec: Number(e.target.value) } : f)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">sek</span>
            </div>
          </label>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-800">Monitoring soati (UZT)</p>
            <p className="text-xs text-gray-500">Faqat shu soat oralig'idagi GPS trek tahlil qilinadi</p>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={23}
                value={form.monitorStartHour}
                onChange={e => setForm(f => f ? { ...f, monitorStartHour: Number(e.target.value) } : f)}
                className="w-20 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">—</span>
              <input type="number" min={0} max={23}
                value={form.monitorEndHour}
                onChange={e => setForm(f => f ? { ...f, monitorEndHour: Number(e.target.value) } : f)}
                className="w-20 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-500">soat</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Standart: katak 35m, radius 40m, min. vaqt 30 sek, soat 06:00–18:00
        </p>
      </div>

      {/* AI Coverage Fingerprint */}
      <AiTrainingSection />

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
              gridCellM: data.gridCellM ?? 35,
              coverageRadiusM: data.coverageRadiusM ?? 40,
              minVisitSec: data.minVisitSec ?? 30,
              monitorStartHour: data.monitorStartHour ?? 6,
              monitorEndHour: data.monitorEndHour ?? 18,
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
