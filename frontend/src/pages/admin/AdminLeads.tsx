/**
 * AdminLeads — landing'dan kelgan arizalarni boshqarish.
 *
 * Backend endpoints:
 *   GET    /api/admin/leads           — ro'yxat (status filter + qidiruv)
 *   GET    /api/admin/leads/:id       — bitta ariza
 *   PATCH  /api/admin/leads/:id       — status/notes yangilash
 *   DELETE /api/admin/leads/:id       — o'chirish
 *
 * Status pipeline:
 *   new → contacted → converted (mijoz bo'ldi) | rejected | spam
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import {
  Inbox, Phone, Mail, Building2, Truck, MessageSquare, Calendar,
  Search, Trash2, X, Check, AlertTriangle, Eye, RefreshCw,
} from 'lucide-react'
import ConfirmDialog from '../../components/ui/ConfirmDialog'

interface Lead {
  id: string
  fullName: string
  phone: string
  email: string | null
  organizationName: string | null
  fleetSize: number | null
  message: string | null
  source: string
  referrer: string | null
  ipAddress: string | null
  userAgent: string | null
  status: 'new' | 'contacted' | 'converted' | 'rejected' | 'spam'
  notes: string | null
  contactedAt: string | null
  convertedAt: string | null
  createdAt: string
  updatedAt: string
}

interface LeadsResponse {
  success: true
  data: Lead[]
  meta: { total: number; page: number; limit: number; totalPages: number }
  stats: Partial<Record<Lead['status'], number>>
}

const STATUS_CONFIG: Record<Lead['status'], { label: string; bg: string; text: string; ring: string }> = {
  new:        { label: "Yangi",         bg: 'bg-blue-500/20',   text: 'text-blue-300',   ring: 'ring-blue-500/40' },
  contacted:  { label: "Bog'lanildi",   bg: 'bg-amber-500/20',  text: 'text-amber-300',  ring: 'ring-amber-500/40' },
  converted:  { label: "Mijoz bo'ldi",  bg: 'bg-green-500/20',  text: 'text-green-300',  ring: 'ring-green-500/40' },
  rejected:   { label: "Rad etildi",    bg: 'bg-rose-500/20',   text: 'text-rose-300',   ring: 'ring-rose-500/40' },
  spam:       { label: "Spam",          bg: 'bg-gray-500/20',   text: 'text-gray-300',   ring: 'ring-gray-500/40' },
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtRelative(d: string): string {
  const ms = Date.now() - new Date(d).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec} sek oldin`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} daq oldin`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} soat oldin`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} kun oldin`
  return new Date(d).toLocaleDateString('uz-UZ')
}

export default function AdminLeads() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Lead['status'] | ''>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data, isLoading, isFetching, refetch } = useQuery<LeadsResponse>({
    queryKey: ['admin', 'leads', status, search, page],
    queryFn: () => api.get('/admin/leads', { params: { status: status || undefined, search: search || undefined, page, limit: 20 } }).then(r => r.data),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<Lead, 'status' | 'notes'>> }) =>
      api.patch(`/admin/leads/${id}`, body).then(r => r.data),
    onSuccess: () => {
      toast.success('Yangilandi')
      qc.invalidateQueries({ queryKey: ['admin', 'leads'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Xatolik'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/leads/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      qc.invalidateQueries({ queryKey: ['admin', 'leads'] })
      setDeleteId(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Xatolik'),
  })

  const leads = data?.data || []
  const stats = data?.stats || {}
  const total = data?.meta?.total ?? 0
  const totalPages = data?.meta?.totalPages ?? 1
  const selected = selectedId ? leads.find(l => l.id === selectedId) : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="w-6 h-6 text-red-400" />
            Arizalar
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Landing sahifadan kelgan arizalarni boshqarish · Jami: <span className="text-white font-semibold">{total}</span>
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(['new', 'contacted', 'converted', 'rejected', 'spam'] as Lead['status'][]).map(s => {
          const cfg = STATUS_CONFIG[s]
          const count = stats[s] || 0
          const isActive = status === s
          return (
            <button
              key={s}
              onClick={() => { setStatus(isActive ? '' : s); setPage(1) }}
              className={`text-left rounded-xl border p-3 transition-all ${
                isActive
                  ? 'bg-gray-800 border-gray-600 ring-2 ring-red-500/40'
                  : 'bg-gray-900 border-gray-800 hover:border-gray-700'
              }`}
            >
              <div className={`text-xs font-semibold ${cfg.text} mb-1`}>{cfg.label}</div>
              <div className="text-2xl font-bold">{count}</div>
            </button>
          )
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="F.I.O. / telefon / email / tashkilot..."
            className="w-full pl-9 pr-9 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm focus:outline-none focus:border-gray-600 text-base"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {status && (
          <button
            onClick={() => setStatus('')}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Filter: {STATUS_CONFIG[status].label}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">Yuklanmoqda...</div>
        ) : leads.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Inbox className="w-12 h-12 mx-auto mb-3 text-gray-700" />
            <div>Arizalar topilmadi</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-950 text-xs text-gray-400 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">F.I.O.</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Aloqa</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Tashkilot</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Sana</th>
                <th className="px-4 py-3 text-right">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {leads.map(lead => {
                const cfg = STATUS_CONFIG[lead.status]
                return (
                  <tr key={lead.id} className="hover:bg-gray-800/40 cursor-pointer" onClick={() => setSelectedId(lead.id)}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{lead.fullName}</div>
                      <a href={`tel:${lead.phone}`} className="text-xs text-blue-400 hover:underline" onClick={e => e.stopPropagation()}>
                        {lead.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">
                      {lead.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{lead.email}</div>}
                      {lead.fleetSize != null && <div className="flex items-center gap-1 mt-1"><Truck className="w-3 h-3" />{lead.fleetSize} ta texnika</div>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-300">
                      {lead.organizationName || <span className="text-gray-600 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500">
                      {fmtRelative(lead.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => setSelectedId(lead.id)}
                          className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                          title="Batafsil"
                        ><Eye className="w-4 h-4" /></button>
                        <button
                          onClick={() => setDeleteId(lead.id)}
                          className="p-1.5 hover:bg-rose-900/40 rounded text-gray-400 hover:text-rose-400"
                          title="O'chirish"
                        ><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg"
          >Oldingi</button>
          <span className="text-gray-400">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg"
          >Keyingi</button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <LeadDetailModal
          lead={selected}
          onClose={() => setSelectedId(null)}
          onUpdate={(body) => updateMut.mutate({ id: selected.id, body })}
          isUpdating={updateMut.isPending}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Arizani o'chirish"
        message="Ushbu ariza butunlay o'chiriladi. Davom etamizmi?"
        confirmLabel="O'chirish"
        danger
        loading={deleteMut.isPending}
      />
    </div>
  )
}

// ─── Detail modal ───────────────────────────────────────────────────────────
function LeadDetailModal({
  lead, onClose, onUpdate, isUpdating,
}: {
  lead: Lead
  onClose: () => void
  onUpdate: (body: Partial<Pick<Lead, 'status' | 'notes'>>) => void
  isUpdating: boolean
}) {
  const [notes, setNotes] = useState(lead.notes || '')
  const [status, setStatus] = useState(lead.status)
  const cfg = STATUS_CONFIG[lead.status]

  const dirty = notes !== (lead.notes || '') || status !== lead.status

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <div className="text-lg font-bold">{lead.fullName}</div>
            <div className="text-xs text-gray-500 mt-0.5">{fmtDate(lead.createdAt)} · {fmtRelative(lead.createdAt)}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Contact info */}
          <div className="grid sm:grid-cols-2 gap-3">
            <a href={`tel:${lead.phone}`} className="flex items-center gap-2 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg hover:bg-blue-900/30">
              <Phone className="w-4 h-4 text-blue-400" />
              <div>
                <div className="text-[10px] uppercase text-blue-300">Telefon</div>
                <div className="text-sm font-semibold">{lead.phone}</div>
              </div>
            </a>
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-2 p-3 bg-purple-900/20 border border-purple-500/30 rounded-lg hover:bg-purple-900/30">
                <Mail className="w-4 h-4 text-purple-400" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase text-purple-300">Email</div>
                  <div className="text-sm font-semibold truncate">{lead.email}</div>
                </div>
              </a>
            )}
            {lead.organizationName && (
              <div className="flex items-center gap-2 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                <Building2 className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-[10px] uppercase text-gray-400">Tashkilot</div>
                  <div className="text-sm font-semibold">{lead.organizationName}</div>
                </div>
              </div>
            )}
            {lead.fleetSize != null && (
              <div className="flex items-center gap-2 p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg">
                <Truck className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-[10px] uppercase text-amber-300">Avtopark hajmi</div>
                  <div className="text-sm font-semibold">{lead.fleetSize} ta texnika</div>
                </div>
              </div>
            )}
          </div>

          {/* Message */}
          {lead.message && (
            <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-4">
              <div className="text-[10px] uppercase text-gray-400 flex items-center gap-1.5 mb-2">
                <MessageSquare className="w-3 h-3" />
                Mijoz xabari
              </div>
              <p className="text-sm whitespace-pre-wrap">{lead.message}</p>
            </div>
          )}

          {/* Status changer */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {(['new', 'contacted', 'converted', 'rejected', 'spam'] as Lead['status'][]).map(s => {
                const c = STATUS_CONFIG[s]
                const active = status === s
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      active ? `${c.bg} ${c.text} ring-2 ${c.ring}` : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase mb-2 block">Eslatma</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Mijoz bilan suhbat tafsilotlari, kelishuvlar..."
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-gray-500 resize-none text-base"
            />
          </div>

          {/* Metadata (collapsed by default) */}
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-300">Texnik ma'lumotlar</summary>
            <div className="mt-2 space-y-1 text-gray-500">
              {lead.contactedAt && <div>Bog'lanildi: {fmtDate(lead.contactedAt)}</div>}
              {lead.convertedAt && <div>Mijoz bo'ldi: {fmtDate(lead.convertedAt)}</div>}
              {lead.source && <div>Manba: {lead.source}</div>}
              {lead.referrer && <div className="truncate">Referrer: {lead.referrer}</div>}
              {lead.ipAddress && <div>IP: {lead.ipAddress}</div>}
              {lead.userAgent && <div className="truncate">UA: {lead.userAgent}</div>}
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-800 sticky bottom-0 bg-gray-900">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
            Joriy: {cfg.label}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium">Yopish</button>
            <button
              onClick={() => onUpdate({ status, notes: notes || null as any })}
              disabled={!dirty || isUpdating}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-bold flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Saqlash
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
