import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Satellite, Wifi, WifiOff, RefreshCw, Trash2, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import Button from './ui/Button'
import Input from './ui/Input'
import { formatDate } from '../lib/utils'

interface GpsStatus {
  id: string
  provider: string
  host: string
  username: string
  isActive: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  createdAt: string
}

export default function GpsConnectPanel() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ username: '', password: '', host: 'https://2.smartgps.uz' })
  const [showForm, setShowForm] = useState(false)

  const { data: statusData, isLoading } = useQuery({
    queryKey: ['gps-status'],
    queryFn: () => api.get('/gps/status').then(r => r.data.data as GpsStatus | null),
  })
  const status = statusData ?? null

  const connectMut = useMutation({
    mutationFn: (body: { username: string; password: string; host: string }) =>
      api.post('/gps/connect', body).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['gps-status'] })
      setShowForm(false)
      setForm(f => ({ ...f, password: '' }))
      toast.success(`GPS ulandi! ${data.meta?.unitCount ?? 0} ta mashina topildi.`)
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'GPS ulanishda xato'),
  })

  const syncMut = useMutation({
    mutationFn: () => api.post('/gps/sync').then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['gps-status'] })
      const { synced, skipped, errors } = data.data
      if (errors?.length > 0) {
        toast.error(`Sync: ${synced} yangilandi, ${skipped} o'tkazildi. Xato: ${errors[0]}`)
      } else {
        toast.success(`Sync tugadi: ${synced} mashina yangilandi, ${skipped} o'tkazildi`)
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Sync xatosi'),
  })

  const disconnectMut = useMutation({
    mutationFn: () => api.delete('/gps/disconnect').then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gps-status'] })
      toast.success('GPS ulanishi o\'chirildi')
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Xato'),
  })

  if (isLoading) return <div className="text-sm text-gray-400 py-4">Yuklanmoqda...</div>

  return (
    <div className="space-y-4">
      {/* Status card */}
      {status ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Satellite className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="font-semibold text-gray-900 dark:text-white">SmartGPS ulangan</div>
                <div className="text-sm text-gray-500">{status.username} · {status.host}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                icon={<RefreshCw className="w-4 h-4" />}
                onClick={() => syncMut.mutate()}
                loading={syncMut.isPending}
                size="sm"
              >
                Sync
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => {
                  if (confirm('GPS ulanishini o\'chirmoqchimisiz?')) disconnectMut.mutate()
                }}
                loading={disconnectMut.isPending}
                size="sm"
              >
                Uzish
              </Button>
            </div>
          </div>

          {/* Last sync info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-400" />
              <div>
                <div className="text-xs text-gray-400">Oxirgi sync</div>
                <div className="text-gray-700 dark:text-gray-200">
                  {status.lastSyncAt ? formatDate(status.lastSyncAt) : 'Hali sync qilinmagan'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {status.lastSyncStatus === 'ok' ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : status.lastSyncStatus === 'error' ? (
                <AlertCircle className="w-4 h-4 text-red-500" />
              ) : (
                <div className="w-4 h-4" />
              )}
              <div>
                <div className="text-xs text-gray-400">Holat</div>
                <div className={
                  status.lastSyncStatus === 'ok' ? 'text-green-600 font-medium' :
                  status.lastSyncStatus === 'error' ? 'text-red-600 font-medium' :
                  'text-gray-400'
                }>
                  {status.lastSyncStatus === 'ok' ? 'Muvaffaqiyatli' :
                   status.lastSyncStatus === 'error' ? 'Xato' : '—'}
                </div>
              </div>
            </div>
            {status.lastSyncError && (
              <div className="text-xs text-red-500 dark:text-red-400 break-words">{status.lastSyncError}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
          <WifiOff className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <div className="font-medium text-gray-600 dark:text-gray-300">GPS ulanmagan</div>
          <div className="text-sm text-gray-400 mt-1 mb-4">
            SmartGPS (Wialon) login va parolingizni kiriting — mashinalar km avtomatik yangilanadi
          </div>
          {!showForm && (
            <Button
              variant="primary"
              icon={<Wifi className="w-4 h-4" />}
              onClick={() => setShowForm(true)}
            >
              GPS ulash
            </Button>
          )}
        </div>
      )}

      {/* Connect form */}
      {(showForm || (!status && showForm)) && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <div className="font-semibold text-gray-900 dark:text-white">GPS ulanish sozlamalari</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="SmartGPS server"
              value={form.host}
              onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
              placeholder="https://2.smartgps.uz"
            />
            <Input
              label="Login (username)"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="admin@company.uz"
            />
            <div className="sm:col-span-2">
              <Input
                label="Parol"
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(f => ({ ...f, password: '' })) }}>
              Bekor
            </Button>
            <Button
              variant="primary"
              icon={<Satellite className="w-4 h-4" />}
              onClick={() => connectMut.mutate(form)}
              loading={connectMut.isPending}
              disabled={!form.username || !form.password}
            >
              Ulash
            </Button>
          </div>
        </div>
      )}

      {/* Info block */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
        <div className="font-medium mb-1">Qanday ishlaydi?</div>
        <ul className="space-y-1 text-xs list-disc list-inside">
          <li>SmartGPS dagi mashina nomi AvtoHisob dagi davlat raqami bilan mos kelishi kerak</li>
          <li>Har 6 soatda avtomatik sync — mashinalar km yangilanadi</li>
          <li>GPS 0 yoki kamayib ketgan ko'rsatsa xavfsizlik uchun o'tkazib yuboriladi</li>
          <li>Parol saqlanmaydi — faqat token ishlatiladi (90 kun)</li>
        </ul>
      </div>
    </div>
  )
}
