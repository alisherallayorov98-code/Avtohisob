import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Archive as ArchiveIcon, RotateCcw, Trash2, Search, Wrench, Lightbulb, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import Button from '../components/ui/Button'
import Pagination from '../components/ui/Pagination'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'

interface ArchiveItem {
  id: string
  entityType: string
  entityId: string
  entityLabel: string
  organizationId: string | null
  deletedAt: string
  expiresAt: string
  reason: string | null
  isRestored: boolean
  restoredAt: string | null
  deletedBy: { fullName: string }
}

interface ArchiveStat {
  entityType: string
  count: number
}

const ENTITY_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  MaintenanceRecord: { label: 'Texnik xizmat', icon: Wrench, color: 'text-orange-600 bg-orange-50' },
}

function formatDt(dt: string) {
  return new Date(dt).toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function daysUntil(dt: string) {
  return Math.max(0, Math.ceil((new Date(dt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
}

export default function Archive() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const isAdmin = hasRole('admin', 'super_admin')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [entityType, setEntityType] = useState('')
  const [search, setSearch] = useState('')
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [permanentDeleteId, setPermanentDeleteId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['archive', page, limit, entityType, search],
    queryFn: () => api.get('/archive', {
      params: { page, limit, entityType: entityType || undefined, search: search || undefined },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.post(`/archive/${id}/restore`),
    onSuccess: () => {
      toast.success('Yozuv tiklandi')
      qc.invalidateQueries({ queryKey: ['archive'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      setRestoreId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Tiklab bo\'lmadi'),
  })

  const permDeleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/archive/${id}`),
    onSuccess: () => {
      toast.success("Butunlay o'chirildi")
      qc.invalidateQueries({ queryKey: ['archive'] })
      setPermanentDeleteId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const items: ArchiveItem[] = data?.data || []
  const stats: ArchiveStat[] = data?.stats || []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Arxiv</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
          O'chirilgan ma'lumotlar shu yerga tushadi va 90 kun ichida tiklash mumkin
        </p>
      </div>

      {/* Yo'l-yo'riq paneli */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1.5 text-blue-900 dark:text-blue-100">
            <p className="font-semibold">Bu nima?</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Adashib o'chirgan yozuvlarni tiklash uchun joy</li>
              <li>Hozircha qo'llab-quvvatlanadi: <b>Texnik xizmat</b></li>
              <li>Avto-tozalash: o'chirilgan yozuv 90 kun saqlanadi, keyin butunlay yo'qoladi</li>
              <li>Tiklangan yozuv yangi id oladi (ammo bog'liq ma'lumotlar saqlanadi)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Statistika kartalari */}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {stats.map(s => {
            const cfg = ENTITY_LABELS[s.entityType] || { label: s.entityType, icon: ArchiveIcon, color: 'text-gray-600 bg-gray-50' }
            const Icon = cfg.icon
            return (
              <button
                key={s.entityType}
                onClick={() => setEntityType(entityType === s.entityType ? '' : s.entityType)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${
                  entityType === s.entityType
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className={`w-4 h-4 ${cfg.color.split(' ')[0]}`} />
                <span className="text-sm font-medium">{cfg.label}</span>
                <span className="text-xs bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full font-bold">{s.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Qidiruv */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Yozuv nomi bo'yicha qidirish..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {(entityType || search) && (
          <button
            onClick={() => { setEntityType(''); setSearch(''); setPage(1) }}
            className="px-3 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-300"
          >
            Tozalash
          </button>
        )}
      </div>

      {/* Ro'yxat */}
      {isLoading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 py-16 text-center">
          <ArchiveIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">{search || entityType ? 'Mos yozuv topilmadi' : "Arxiv bo'sh"}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {items.map(item => {
            const cfg = ENTITY_LABELS[item.entityType] || { label: item.entityType, icon: ArchiveIcon, color: 'text-gray-600 bg-gray-50' }
            const Icon = cfg.icon
            const days = daysUntil(item.expiresAt)
            const expiringSoon = days <= 7
            return (
              <div key={item.id} className="border-b border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cfg.color} dark:bg-opacity-20`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full">{cfg.label}</span>
                    <p className="font-medium text-gray-800 dark:text-white truncate">{item.entityLabel}</p>
                    {expiringSoon && (
                      <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {days} kun qoldi
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    O'chirgan: {item.deletedBy?.fullName || '—'} · {formatDt(item.deletedAt)}
                    {item.reason && ` · "${item.reason}"`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<RotateCcw className="w-3.5 h-3.5 text-emerald-600" />}
                    onClick={() => setRestoreId(item.id)}
                  >
                    Tiklash
                  </Button>
                  {isAdmin && (
                    <button
                      onClick={() => setPermanentDeleteId(item.id)}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                      title="Butunlay o'chirish (qaytarib bo'lmaydi)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={data?.meta?.totalPages || 1}
        total={data?.meta?.total || 0}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />

      <ConfirmDialog
        open={!!restoreId}
        title="Yozuvni tiklash"
        message="Bu yozuvni tiklamoqchimisiz? Yozuv yangi id bilan asl jadvalga qaytariladi."
        confirmLabel="Ha, tikla"
        loading={restoreMut.isPending}
        onConfirm={() => restoreId && restoreMut.mutate(restoreId)}
        onCancel={() => setRestoreId(null)}
      />

      <ConfirmDialog
        open={!!permanentDeleteId}
        title="Butunlay o'chirish"
        message="Bu yozuvni butunlay o'chirmoqchimisiz? Bu amal QAYTARIB BO'LMAYDI."
        confirmLabel="Ha, butunlay o'chir"
        loading={permDeleteMut.isPending}
        onConfirm={() => permanentDeleteId && permDeleteMut.mutate(permanentDeleteId)}
        onCancel={() => setPermanentDeleteId(null)}
      />
    </div>
  )
}
