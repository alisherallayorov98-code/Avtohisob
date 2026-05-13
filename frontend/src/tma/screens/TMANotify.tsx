import { useEffect, useState } from 'react'
import { AxiosInstance } from 'axios'
import { Info, CheckCircle, AlertTriangle, XCircle, Bell } from 'lucide-react'

interface Props {
  api: AxiosInstance
  user: { id: string; fullName: string; role: string }
  tg: any
}

interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  isRead: boolean
  createdAt: string
  link: string | null
}

const TYPE_ICON: Record<string, React.ElementType> = {
  info:    Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error:   XCircle,
}
const TYPE_COLOR: Record<string, string> = {
  info:    'text-blue-500',
  success: 'text-green-500',
  warning: 'text-amber-500',
  error:   'text-red-500',
}

export default function TMANotify({ api, tg }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadOnly, setUnreadOnly] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const res = await api.get('/notifications?limit=50')
      setNotifications(res.data.notifications || res.data || [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  async function markRead(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    } catch {}
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/mark-all-read')
      tg?.HapticFeedback?.impactOccurred('medium')
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    } catch {}
  }

  const filtered = unreadOnly ? notifications.filter(n => !n.isRead) : notifications
  const unreadCount = notifications.filter(n => !n.isRead).length

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Xabarlar</h1>
          {unreadCount > 0 && (
            <p className="text-xs opacity-50">{unreadCount} ta o'qilmagan</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs px-3 py-1.5 rounded-full"
            style={{
              background: 'var(--tg-theme-secondary-bg-color, #fff)',
              color: 'var(--tg-theme-button-color, #3b82f6)',
            }}
          >
            Barchani o'qi
          </button>
        )}
      </div>

      {/* Unread toggle */}
      <button
        onClick={() => { tg?.HapticFeedback?.impactOccurred('light'); setUnreadOnly(p => !p) }}
        className="flex items-center gap-2 text-sm"
      >
        <div
          className="w-10 h-5 rounded-full transition-colors relative"
          style={{ background: unreadOnly ? 'var(--tg-theme-button-color, #3b82f6)' : 'var(--tg-theme-hint-color, #ccc)' }}
        >
          <div
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
            style={{ transform: unreadOnly ? 'translateX(21px)' : 'translateX(2px)' }}
          />
        </div>
        <span className="opacity-70">Faqat o'qilmaganlar</span>
      </button>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 opacity-50">
          <Bell className="w-10 h-10 mb-2" />
          <p className="text-sm">
            {unreadOnly ? "O'qilmagan xabar yo'q" : "Xabarlar yo'q"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => {
            const Icon = TYPE_ICON[n.type] || Info
            return (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.isRead) markRead(n.id)
                  tg?.HapticFeedback?.impactOccurred('light')
                }}
                className="rounded-2xl p-3 flex gap-3 transition-opacity"
                style={{
                  background: 'var(--tg-theme-secondary-bg-color, #fff)',
                  opacity: n.isRead ? 0.7 : 1,
                }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  <Icon className={`w-5 h-5 ${TYPE_COLOR[n.type]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{n.title}</p>
                    {!n.isRead && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" />
                    )}
                  </div>
                  <p className="text-xs opacity-60 mt-0.5 leading-snug">{n.message}</p>
                  <p className="text-xs opacity-40 mt-1">
                    {new Date(n.createdAt).toLocaleDateString('uz-UZ', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
