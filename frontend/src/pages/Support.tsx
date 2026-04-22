import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MessageSquare, Clock, CheckCircle, XCircle, AlertCircle, Send, ChevronRight, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

const statusColors: Record<string, any> = {
  open: 'warning', in_progress: 'primary', resolved: 'success', closed: 'secondary'
}
const statusLabels: Record<string, string> = {
  open: 'Ochiq', in_progress: 'Jarayonda', resolved: 'Hal qilindi', closed: 'Yopildi'
}
const priorityColors: Record<string, any> = {
  low: 'secondary', medium: 'primary', high: 'warning', urgent: 'danger'
}
const priorityLabels: Record<string, string> = {
  low: 'Past', medium: "O'rta", high: 'Yuqori', urgent: 'Shoshilinch'
}
const categoryLabels: Record<string, string> = {
  technical: 'Texnik', billing: "To'lov", feature_request: 'Taklif', other: 'Boshqa'
}

interface TicketForm { subject: string; description: string; category: string; priority: string }

export default function Support() {
  const qc = useQueryClient()
  const { user, isAdmin, isManager } = useAuthStore()
  const isStaff = isAdmin() || isManager()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [createModal, setCreateModal] = useState(false)
  const [detailTicket, setDetailTicket] = useState<any>(null)
  const [replyText, setReplyText] = useState('')
  const [resolutionMode, setResolutionMode] = useState(false)
  const [resolutionText, setResolutionText] = useState('')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TicketForm>({
    defaultValues: { category: 'technical', priority: 'medium' }
  })

  const { data: stats } = useQuery({
    queryKey: ['ticket-stats'],
    queryFn: () => api.get('/support/stats').then(r => r.data.data),
    enabled: isStaff,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', page, statusFilter, priorityFilter, search],
    queryFn: () => api.get('/support', { params: { page, limit: 20, status: statusFilter || undefined, priority: priorityFilter || undefined, search: search || undefined } }).then(r => r.data),
  })

  const { data: ticketDetail, refetch: refetchDetail } = useQuery({
    queryKey: ['ticket-detail', detailTicket?.id],
    queryFn: () => api.get(`/support/${detailTicket.id}`).then(r => r.data.data),
    enabled: !!detailTicket,
  })

  const createMutation = useMutation({
    mutationFn: (d: TicketForm) => api.post('/support', d),
    onSuccess: () => {
      toast.success("Ticket yuborildi")
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.invalidateQueries({ queryKey: ['ticket-stats'] })
      setCreateModal(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const replyMutation = useMutation({
    mutationFn: ({ id, message }: any) => api.post(`/support/${id}/reply`, { message }),
    onSuccess: () => {
      toast.success('Javob yuborildi')
      setReplyText('')
      refetchDetail()
      qc.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status, resolution }: any) => api.patch(`/support/${id}/status`, { status, resolution }),
    onSuccess: () => {
      toast.success('Status yangilandi')
      refetchDetail()
      qc.invalidateQueries({ queryKey: ['tickets'] })
      qc.invalidateQueries({ queryKey: ['ticket-stats'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    {
      key: 'ticketNumber', title: 'Ticket', render: (t: any) => (
        <div>
          <p className="font-mono text-sm font-medium text-blue-600">{t.ticketNumber}</p>
          <p className="text-xs text-gray-400">{formatDate(t.createdAt)}</p>
        </div>
      )
    },
    {
      key: 'subject', title: 'Mavzu', render: (t: any) => (
        <div>
          <p className="font-medium text-gray-900 dark:text-white line-clamp-1">{t.subject}</p>
          <p className="text-xs text-gray-500">{categoryLabels[t.category] || t.category}</p>
        </div>
      )
    },
    isStaff && { key: 'user', title: 'Foydalanuvchi', render: (t: any) => <span className="text-sm">{t.user?.fullName}</span> },
    { key: 'priority', title: 'Muhimlik', render: (t: any) => <Badge variant={priorityColors[t.priority]}>{priorityLabels[t.priority]}</Badge> },
    { key: 'status', title: 'Status', render: (t: any) => <Badge variant={statusColors[t.status]}>{statusLabels[t.status]}</Badge> },
    {
      key: 'replies', title: '', render: (t: any) => (
        <div className="flex items-center gap-2">
          {t._count?.replies > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <MessageSquare className="w-3.5 h-3.5" />{t._count.replies}
            </span>
          )}
          <button onClick={() => setDetailTicket(t)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            Ko'rish <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    },
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Support</h1>
          <p className="text-gray-500 text-sm">Texnik yordam va murojaatlar</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setCreateModal(true) }}>
          Ticket yaratish
        </Button>
      </div>

      {/* Stats (admin only) */}
      {isStaff && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Jami', value: stats.total, color: 'gray' },
            { label: 'Ochiq', value: stats.open, color: 'yellow' },
            { label: 'Jarayonda', value: stats.inProgress, color: 'blue' },
            { label: 'Hal qilindi', value: stats.resolved, color: 'green' },
            { label: 'Shoshilinch', value: stats.urgent, color: 'red' },
          ].map(s => (
            <div key={s.label} className={`bg-${s.color}-50 dark:bg-${s.color}-900/20 rounded-xl p-4`}>
              <p className={`text-sm text-${s.color}-600 dark:text-${s.color}-400`}>{s.label}</p>
              <p className={`text-2xl font-bold text-${s.color}-900 dark:text-${s.color}-100`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Ticket raqami, mavzu yoki foydalanuvchi..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha statuslar</option>
            <option value="open">Ochiq</option>
            <option value="in_progress">Jarayonda</option>
            <option value="resolved">Hal qilindi</option>
            <option value="closed">Yopildi</option>
          </select>
          <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha muhimliklar</option>
            <option value="low">Past</option>
            <option value="medium">O'rta</option>
            <option value="high">Yuqori</option>
            <option value="urgent">Shoshilinch</option>
          </select>
          {(search || statusFilter || priorityFilter) && (
            <button onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setPage(1) }}
              className="px-3 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-300">Tozalash</button>
          )}
        </div>
        <Table columns={columns as any} data={data?.data || []} loading={isLoading} numbered page={page} limit={20} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={20} onPageChange={setPage} />
      </div>

      {/* Create Ticket Modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Yangi ticket yaratish" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateModal(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Yuborish</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Mavzu *" placeholder="Muammoni qisqacha tavsiflab bering" error={errors.subject?.message}
            {...register('subject', { required: 'Talab qilinadi' })} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Kategoriya</label>
              <select {...register('category')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="technical">Texnik muammo</option>
                <option value="billing">To'lov masalasi</option>
                <option value="feature_request">Taklif/So'rov</option>
                <option value="other">Boshqa</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Muhimlik</label>
              <select {...register('priority')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="low">Past</option>
                <option value="medium">O'rta</option>
                <option value="high">Yuqori</option>
                <option value="urgent">Shoshilinch</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tavsif *</label>
            <textarea {...register('description', { required: 'Talab qilinadi' })} rows={5}
              placeholder="Muammoni batafsil tavsiflab bering..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
          </div>
        </div>
      </Modal>

      {/* Ticket Detail Modal */}
      <Modal open={!!detailTicket} onClose={() => { setDetailTicket(null); setReplyText(''); setResolutionMode(false); setResolutionText('') }}
        title={`${ticketDetail?.ticketNumber || ''} — ${ticketDetail?.subject || ''}`} size="lg">
        {ticketDetail && (
          <div className="space-y-5">
            {/* Meta */}
            <div className="flex flex-wrap gap-3">
              <Badge variant={statusColors[ticketDetail.status]}>{statusLabels[ticketDetail.status]}</Badge>
              <Badge variant={priorityColors[ticketDetail.priority]}>{priorityLabels[ticketDetail.priority]}</Badge>
              <span className="text-sm text-gray-500">{categoryLabels[ticketDetail.category]}</span>
              <span className="text-sm text-gray-500">{formatDate(ticketDetail.createdAt)}</span>
              {isStaff && <span className="text-sm text-gray-600 font-medium">{ticketDetail.user?.fullName}</span>}
            </div>

            {/* Description */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{ticketDetail.description}</p>
            </div>

            {/* Resolution (if any) */}
            {ticketDetail.resolution && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">Yechim:</p>
                <p className="text-sm text-green-700 dark:text-green-400 whitespace-pre-wrap">{ticketDetail.resolution}</p>
              </div>
            )}

            {/* Replies */}
            {ticketDetail.replies?.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Suhbat</h4>
                {ticketDetail.replies.map((r: any) => (
                  <div key={r.id} className={`flex gap-3 ${r.isStaff ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${r.isStaff ? 'bg-blue-500' : 'bg-gray-400'}`}>
                      {r.user?.fullName?.charAt(0)}
                    </div>
                    <div className={`max-w-[75%] rounded-xl px-4 py-2.5 ${r.isStaff ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>
                      <p className={`text-xs font-medium mb-1 ${r.isStaff ? 'text-blue-100' : 'text-gray-500'}`}>
                        {r.isStaff ? 'Support' : r.user?.fullName} • {formatDate(r.createdAt)}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{r.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Admin status controls */}
            {isStaff && ticketDetail.status !== 'closed' && (
              <div className="flex gap-2 flex-wrap pt-2 border-t border-gray-100 dark:border-gray-700">
                {ticketDetail.status === 'open' && (
                  <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: ticketDetail.id, status: 'in_progress' })}>
                    Jarayonga olish
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setResolutionMode(true)}>
                  Hal qilindi deb belgilash
                </Button>
                <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: ticketDetail.id, status: 'closed' })}>
                  Yopish
                </Button>
              </div>
            )}

            {/* Resolution input */}
            {resolutionMode && (
              <div className="flex flex-col gap-2 pt-2 border-t border-green-100 dark:border-green-800 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                <p className="text-xs font-medium text-green-700 dark:text-green-400">Yechim matni kiriting:</p>
                <textarea
                  value={resolutionText}
                  onChange={e => setResolutionText(e.target.value)}
                  rows={2}
                  placeholder="Muammo qanday hal qilindi..."
                  className="px-3 py-2 text-sm border border-green-300 dark:border-green-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
                <div className="flex gap-2">
                  <Button size="sm"
                    disabled={!resolutionText.trim()}
                    loading={statusMutation.isPending}
                    onClick={() => {
                      statusMutation.mutate({ id: ticketDetail.id, status: 'resolved', resolution: resolutionText.trim() })
                      setResolutionMode(false); setResolutionText('')
                    }}>
                    Tasdiqlash
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setResolutionMode(false); setResolutionText('') }}>
                    Bekor
                  </Button>
                </div>
              </div>
            )}

            {/* Reply box */}
            {ticketDetail.status !== 'closed' && (
              <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={2}
                  placeholder="Javob yozing..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                <Button icon={<Send className="w-4 h-4" />}
                  loading={replyMutation.isPending}
                  disabled={!replyText.trim()}
                  onClick={() => replyMutation.mutate({ id: ticketDetail.id, message: replyText.trim() })}>
                  Yuborish
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
