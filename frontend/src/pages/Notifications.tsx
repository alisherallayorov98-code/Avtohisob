import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Trash2, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import api from '../lib/api'
import { formatDateTime } from '../lib/utils'

interface Notification {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  isRead: boolean
  link?: string
  createdAt: string
}

const TYPE_FILTERS = [
  { key: 'all',     label: 'Barchasi' },
  { key: 'info',    label: 'Ma\'lumot' },
  { key: 'success', label: 'Muvaffaqiyat' },
  { key: 'warning', label: 'Ogohlantirish' },
  { key: 'error',   label: 'Xato' },
]

const TYPE_ICONS: Record<string, React.ElementType> = {
  info:    Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error:   XCircle,
}

const TYPE_COLORS: Record<string, string> = {
  info:    'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
  success: 'text-green-500 bg-green-50 dark:bg-green-900/20',
  warning: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
  error:   'text-red-500 bg-red-50 dark:bg-red-900/20',
}

function groupByDate(notifications: Notification[]) {
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7)

  const groups: { label: string; items: Notification[] }[] = [
    { label: 'Bugun', items: [] },
    { label: 'Kecha', items: [] },
    { label: 'Bu hafta', items: [] },
    { label: 'Eski', items: [] },
  ]

  for (const n of notifications) {
    const d = new Date(n.createdAt); d.setHours(0,0,0,0)
    if (d >= today)          groups[0].items.push(n)
    else if (d >= yesterday) groups[1].items.push(n)
    else if (d >= weekAgo)   groups[2].items.push(n)
    else                     groups[3].items.push(n)
  }

  return groups.filter(g => g.items.length > 0)
}

export default function Notifications() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState('all')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data.data),
    refetchInterval: 30_000,
  })

  const notifications: Notification[] = data?.notifications || []
  const unreadCount: number = data?.unreadCount || 0

  const markRead = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllRead = useMutation({
    mutationFn: () => api.put('/notifications/all/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const deleteNotif = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const filtered = notifications
    .filter(n => typeFilter === 'all' || n.type === typeFilter)
    .filter(n => !unreadOnly || !n.isRead)

  const groups = groupByDate(filtered)

  function handleClick(n: Notification) {
    if (!n.isRead) markRead.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell className="w-7 h-7 text-blue-600" />
            Bildirishnomalar
            {unreadCount > 0 && (
              <span className="text-base font-normal text-red-500">({unreadCount} o'qilmagan)</span>
            )}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Tizim xabarlari va ogohlantirishlar tarixi
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <CheckCheck className="w-4 h-4" />
            Hammasini o'qildi
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Type filter */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === f.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Unread toggle */}
        <button
          onClick={() => setUnreadOnly(o => !o)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            unreadOnly
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
              : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'
          }`}
        >
          Faqat o'qilmaganlar
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <div className="text-gray-500 dark:text-gray-400">
            {unreadOnly ? "O'qilmagan bildirishnomalar yo'q" : "Bildirishnomalar yo'q"}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.label}>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map(n => {
                  const Icon = TYPE_ICONS[n.type] || Info
                  const colors = TYPE_COLORS[n.type] || TYPE_COLORS.info
                  return (
                    <div
                      key={n.id}
                      className={`flex gap-3 p-4 rounded-xl border transition-colors ${
                        !n.isRead
                          ? 'bg-blue-50/60 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30'
                          : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'
                      } ${n.link ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''}`}
                      onClick={() => handleClick(n)}
                    >
                      {/* Icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colors}`}>
                        <Icon className="w-4 h-4" />
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium ${!n.isRead ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                            {n.title}
                          </p>
                          <span className="text-xs text-gray-400 flex-shrink-0">{formatDateTime(n.createdAt)}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{n.message}</p>
                        {!n.isRead && (
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                        )}
                      </div>

                      {/* Delete */}
                      <button
                        onClick={e => { e.stopPropagation(); deleteNotif.mutate(n.id) }}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-300 hover:text-gray-500 flex-shrink-0 self-start"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
