import { useQuery } from '@tanstack/react-query'
import { PackagePlus, Wrench, ArrowLeftRight, RotateCcw, Loader2, Building2, Truck, User as UserIcon, FileText } from 'lucide-react'
import api from '../lib/api'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Badge from './ui/Badge'
import { formatCurrency, formatDate } from '../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  sparePartId: string | null
  sparePartName?: string
}

interface HistoryEvent {
  type: 'receipt' | 'used' | 'transfer' | 'return'
  date: string
  quantity: number
  direction: 'in' | 'out' | 'move'
  details: any
}

interface HistoryData {
  sparePart: { id: string; name: string; partCode: string; category: string; unitPrice: number }
  events: HistoryEvent[]
  summary: {
    totalReceived: number
    totalUsed: number
    totalReturned: number
    totalTransferredOut: number
    currentTotal: number
  }
  currentInventory: { warehouse: { id: string; name: string }; quantity: number }[]
}

const TYPE_CONFIG: Record<HistoryEvent['type'], { label: string; icon: React.ElementType; color: string; bg: string }> = {
  receipt:  { label: 'Kirim',         icon: PackagePlus,    color: 'text-green-700',  bg: 'bg-green-50 dark:bg-green-900/20'   },
  used:     { label: 'Ishlatildi',    icon: Wrench,         color: 'text-blue-700',   bg: 'bg-blue-50 dark:bg-blue-900/20'    },
  transfer: { label: 'Ko\'chirildi',  icon: ArrowLeftRight, color: 'text-purple-700', bg: 'bg-purple-50 dark:bg-purple-900/20'},
  return:   { label: 'Qaytarildi',    icon: RotateCcw,      color: 'text-amber-700',  bg: 'bg-amber-50 dark:bg-amber-900/20'  },
}

const TRANSFER_STATUS_LABEL: Record<string, string> = {
  pending:   'Kutmoqda',
  approved:  'Tasdiqlangan',
  shipped:   'Yuborildi',
  received:  'Qabul qilindi',
  cancelled: 'Bekor qilindi',
  rejected:  'Rad etildi',
}

const MAINT_STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Tasdiqlash kutmoqda',
  approved:         'Tasdiqlangan',
  rejected:         'Rad etilgan',
}

const RETURN_STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Tasdiqlash kutmoqda',
  approved:         'Tasdiqlangan',
  rejected:         'Rad etilgan',
}

function EventCard({ event }: { event: HistoryEvent }) {
  const cfg = TYPE_CONFIG[event.type]
  const Icon = cfg.icon
  const d = event.details || {}

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-700 p-4 ${cfg.bg}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${cfg.bg} ${cfg.color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{formatDate(event.date)} · {new Date(event.date).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${event.direction === 'in' ? 'text-green-600' : event.direction === 'out' ? 'text-red-600' : 'text-purple-600'}`}>
            {event.direction === 'in' ? '+' : event.direction === 'out' ? '−' : '↔'} {event.quantity} ta
          </div>
        </div>
      </div>

      {/* Type-specific details */}
      {event.type === 'receipt' && (
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
          {d.warehouse && <div className="flex items-center gap-1.5"><Building2 className="w-3 h-3" /> Ombor: <b>{d.warehouse.name}</b></div>}
          {d.unitPrice > 0 && <div>1 dona: {formatCurrency(d.unitPrice)} · Jami: {formatCurrency(d.unitPrice * event.quantity)}</div>}
          {d.receivedBy && <div className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Qabul qildi: {d.receivedBy.fullName}</div>}
          {!d.isOfficial && <Badge variant="warning">Norasmiy</Badge>}
          {d.notes && <div className="italic text-gray-500">{d.notes}</div>}
        </div>
      )}

      {event.type === 'used' && (
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
          {d.vehicle && <div className="flex items-center gap-1.5"><Truck className="w-3 h-3" /> Mashina: <b>{d.vehicle.registrationNumber}</b> · {d.vehicle.brand} {d.vehicle.model}</div>}
          {d.warehouse && <div className="flex items-center gap-1.5"><Building2 className="w-3 h-3" /> Ombordan: {d.warehouse.name}</div>}
          {d.workerName && <div className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Usta: {d.workerName}</div>}
          {d.performedBy && <div className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Yozdi: {d.performedBy.fullName}</div>}
          {d.unitCost > 0 && <div>1 dona narxi: {formatCurrency(d.unitCost)}</div>}
          <div className="flex items-center gap-2">
            <Badge variant={d.maintenanceStatus === 'approved' ? 'success' : d.maintenanceStatus === 'rejected' ? 'danger' : 'warning'}>
              {MAINT_STATUS_LABEL[d.maintenanceStatus] || d.maintenanceStatus}
            </Badge>
            {!d.isOfficial && <Badge variant="warning">Norasmiy</Badge>}
          </div>
        </div>
      )}

      {event.type === 'transfer' && (
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3 h-3" />
            <b>{d.fromWarehouse?.name || '—'}</b>
            <span>→</span>
            <b>{d.toWarehouse?.name || '—'}</b>
          </div>
          {d.batch?.documentNumber && (
            <div className="flex items-center gap-1.5"><FileText className="w-3 h-3" /> Hujjat: {d.batch.documentNumber}</div>
          )}
          {d.approvedBy && <div className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Tasdiq: {d.approvedBy.fullName}</div>}
          <Badge variant={d.status === 'received' ? 'success' : d.status === 'cancelled' || d.status === 'rejected' ? 'danger' : 'info'}>
            {TRANSFER_STATUS_LABEL[d.status] || d.status}
          </Badge>
          {d.notes && <div className="italic text-gray-500">{d.notes}</div>}
        </div>
      )}

      {event.type === 'return' && (
        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
          {d.vehicle && <div className="flex items-center gap-1.5"><Truck className="w-3 h-3" /> Qaysi mashinadan: {d.vehicle.registrationNumber}</div>}
          {d.reason && <div className="font-medium">Sabab: {d.reason}</div>}
          {d.returnedBy && <div className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Qaytardi: {d.returnedBy.fullName}</div>}
          {d.approvedBy && <div className="flex items-center gap-1.5"><UserIcon className="w-3 h-3" /> Tasdiq: {d.approvedBy.fullName}</div>}
          {d.unitCost > 0 && <div>1 dona narxi: {formatCurrency(d.unitCost)}</div>}
          <Badge variant={d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'danger' : 'warning'}>
            {RETURN_STATUS_LABEL[d.status] || d.status}
          </Badge>
        </div>
      )}
    </div>
  )
}

export default function SparePartHistoryModal({ open, onClose, sparePartId, sparePartName }: Props) {
  const { data, isLoading } = useQuery<HistoryData>({
    queryKey: ['spare-part-history', sparePartId],
    queryFn: async () => {
      const r = await api.get(`/spare-parts/${sparePartId}/history`)
      return r.data.data
    },
    enabled: open && !!sparePartId,
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`📋 ${sparePartName || 'Ehtiyot qism'} — harakat tarixi`}
      size="lg"
      footer={<Button variant="outline" onClick={onClose}>Yopish</Button>}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : !data ? (
        <p className="py-8 text-center text-gray-400">Ma'lumot yo'q</p>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">Kirim</div>
              <div className="text-lg font-bold text-green-600">{data.summary.totalReceived}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">Ishlatildi</div>
              <div className="text-lg font-bold text-blue-600">{data.summary.totalUsed}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">Qaytarildi</div>
              <div className="text-lg font-bold text-amber-600">{data.summary.totalReturned}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">Ko'chirildi</div>
              <div className="text-lg font-bold text-purple-600">{data.summary.totalTransferredOut}</div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center border border-blue-200 dark:border-blue-700">
              <div className="text-xs text-blue-600 dark:text-blue-400">Hozir</div>
              <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{data.summary.currentTotal}</div>
            </div>
          </div>

          {/* Current inventory */}
          {data.currentInventory.length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1.5">📦 Hozirda omborlarda:</div>
              <div className="flex flex-wrap gap-2">
                {data.currentInventory.map((inv, i) => (
                  <div key={i} className="bg-white dark:bg-gray-800 px-2.5 py-1 rounded-lg text-xs">
                    <span className="text-gray-600 dark:text-gray-300">{inv.warehouse.name}:</span>{' '}
                    <span className="font-bold text-gray-900 dark:text-white">{inv.quantity} ta</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Events timeline */}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.events.length === 0 ? (
              <p className="py-8 text-center text-gray-400">Hech qanday harakat topilmadi</p>
            ) : (
              data.events.map((event, i) => <EventCard key={i} event={event} />)
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
