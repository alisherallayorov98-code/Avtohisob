import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Clock, CheckCircle, XCircle, Package, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import SparePartReturnPending from '../components/maintenance/SparePartReturnPending'

interface ReturnItem {
  id: string
  quantity: number
  unitCost: number
  sparePart: { name: string; partCode: string }
}

interface ReturnRecord {
  id: string
  status: 'pending_approval' | 'approved' | 'rejected'
  reason: string
  notes: string | null
  returnDate: string | null
  createdAt: string
  returnedBy: { fullName: string }
  approvedBy: { fullName: string } | null
  rejectionReason: string | null
  maintenance: { id: string; installationDate: string; vehicle: { registrationNumber: string } } | null
  items: ReturnItem[]
  evidence: { id: string; fileUrl: string }[]
}

const STATUS_MAP = {
  pending_approval: { label: 'Kutayotgan', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  approved:         { label: 'Tasdiqlangan', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rejected:         { label: 'Rad etildi', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

function totalAmount(items: ReturnItem[]) {
  return items.reduce((s, i) => s + i.quantity * i.unitCost, 0)
}

function ReturnRow({ r }: { r: ReturnRecord }) {
  const [open, setOpen] = useState(false)
  const st = STATUS_MAP[r.status]
  const total = totalAmount(r.items)
  const date = new Date(r.createdAt).toLocaleDateString('uz-UZ')

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
      >
        <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {r.maintenance?.vehicle?.registrationNumber && (
              <span className="font-medium text-gray-900 dark:text-white text-sm">
                {r.maintenance.vehicle.registrationNumber}
              </span>
            )}
            <span className="text-xs text-gray-400">{r.items.length} ta zapchast</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{r.reason}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(total)}</div>
          <div className="text-xs text-gray-400">{date}</div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 space-y-3">
          {/* Items */}
          <div className="space-y-1">
            {r.items.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {item.sparePart.name}
                  {item.sparePart.partCode && <span className="text-gray-400 ml-1 text-xs">({item.sparePart.partCode})</span>}
                </span>
                <span className="text-gray-500">
                  {item.quantity} × {formatCurrency(item.unitCost)} = {formatCurrency(item.quantity * item.unitCost)}
                </span>
              </div>
            ))}
          </div>

          {/* Notes */}
          {r.notes && (
            <div className="text-xs text-gray-500 dark:text-gray-400">Izoh: {r.notes}</div>
          )}

          {/* Rejection reason */}
          {r.status === 'rejected' && r.rejectionReason && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              Rad sababi: {r.rejectionReason}
            </div>
          )}

          {/* Approved by */}
          {r.status === 'approved' && r.approvedBy && (
            <div className="text-xs text-green-600 dark:text-green-400">
              Tasdiqladi: {r.approvedBy.fullName}
            </div>
          )}

          {/* Evidence photos */}
          {r.evidence.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {r.evidence.map(ev => (
                <a key={ev.id} href={ev.fileUrl} target="_blank" rel="noopener noreferrer">
                  <img src={ev.fileUrl} alt="rasm" className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-600" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SparePartReturns() {
  const { hasRole } = useAuthStore()
  const isManager = hasRole('admin', 'super_admin', 'manager')
  const [tab, setTab] = useState<'mine' | 'pending'>('mine')

  const { data: myReturns, isLoading } = useQuery<ReturnRecord[]>({
    queryKey: ['spare-part-returns'],
    queryFn: () => api.get('/spare-part-returns').then(r => r.data.data),
    staleTime: 30_000,
    enabled: tab === 'mine',
  })

  const records = myReturns ?? []
  const pending = records.filter(r => r.status === 'pending_approval').length
  const approved = records.filter(r => r.status === 'approved').length
  const rejected = records.filter(r => r.status === 'rejected').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <RotateCcw className="w-7 h-7 text-blue-600" />
          Zapchast qaytarish
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Ta'mirlashdan ortiqcha qaytarilgan ehtiyot qismlar
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <Clock className="w-8 h-8 text-amber-500 flex-shrink-0" />
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{pending}</div>
            <div className="text-xs text-gray-500">Kutayotgan</div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <CheckCircle className="w-8 h-8 text-green-500 flex-shrink-0" />
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{approved}</div>
            <div className="text-xs text-gray-500">Tasdiqlangan</div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <XCircle className="w-8 h-8 text-red-500 flex-shrink-0" />
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{rejected}</div>
            <div className="text-xs text-gray-500">Rad etildi</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab('mine')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'mine' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          So'rovlarim
        </button>
        {isManager && (
          <button
            onClick={() => setTab('pending')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'pending' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            Kutayotganlar tasdiqlash
          </button>
        )}
      </div>

      {/* Content */}
      {tab === 'mine' && (
        <div className="space-y-2">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-16 text-center">
              <RotateCcw className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <div className="text-gray-500 dark:text-gray-400">Hali qaytarish so'rovlari yo'q</div>
              <div className="text-xs text-gray-400 mt-1">
                Ta'mirlash yozuvi ichidan zapchastni qaytarish so'rovini yarating
              </div>
            </div>
          ) : (
            records.map(r => <ReturnRow key={r.id} r={r} />)
          )}
        </div>
      )}

      {tab === 'pending' && isManager && (
        <SparePartReturnPending />
      )}
    </div>
  )
}
