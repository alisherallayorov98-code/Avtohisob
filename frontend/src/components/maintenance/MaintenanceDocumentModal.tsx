import { useQuery } from '@tanstack/react-query'
import { X, Printer, Loader2 } from 'lucide-react'
import api, { getFileUrl } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'

interface Props {
  maintenanceId: string
  onClose: () => void
}

export default function MaintenanceDocumentModal({ maintenanceId, onClose }: Props) {
  const { data: record, isLoading } = useQuery({
    queryKey: ['maintenance-detail', maintenanceId],
    queryFn: () => api.get(`/maintenance/${maintenanceId}`).then(r => r.data.data),
  })

  const { data: evidence } = useQuery({
    queryKey: ['maintenance-evidence', maintenanceId],
    queryFn: () => api.get(`/maintenance/${maintenanceId}/evidence`).then(r => r.data.data),
  })

  if (isLoading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Loader2 className="w-8 h-8 animate-spin text-white" />
    </div>
  )
  if (!record) return null

  const items = record.items?.length > 0 ? record.items : (record.sparePart ? [{ sparePart: record.sparePart, quantityUsed: record.quantityUsed, unitCost: record.cost }] : [])
  const totalParts = items.reduce((s: number, i: any) => s + Number(i.unitCost) * i.quantityUsed, 0)
  const totalAll = totalParts + Number(record.laborCost || 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Toolbar — print da ko'rinmaydi */}
        <div className="flex items-center justify-between px-5 py-3 border-b print:hidden">
          <h2 className="font-semibold text-gray-800">Texnik xizmat dalolatnomasi</h2>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Printer className="w-4 h-4" /> Chop etish
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Hujjat — scroll */}
        <div className="overflow-y-auto flex-1 p-6" id="maintenance-doc">
          {/* Sarlavha */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900 uppercase tracking-wide">Dalolatnoma</h1>
            <p className="text-sm text-gray-500 mt-1">Texnik xizmat ko'rsatish hujjati</p>
          </div>

          {/* Asosiy ma'lumotlar */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-5 text-sm">
            <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Sana:</span><span className="font-medium">{formatDate(record.installationDate)}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Holat:</span>
              <span className={`font-medium ${record.status === 'approved' ? 'text-green-600' : record.status === 'rejected' ? 'text-red-500' : 'text-amber-600'}`}>
                {record.status === 'approved' ? 'Tasdiqlangan' : record.status === 'rejected' ? 'Rad etilgan' : 'Kutmoqda'}
              </span>
            </div>
            <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Avtomashina:</span><span className="font-medium font-mono">{record.vehicle?.registrationNumber}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Model:</span><span className="font-medium">{record.vehicle?.brand} {record.vehicle?.model}</span></div>
            <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Bajardi:</span><span className="font-medium">{record.performedBy?.fullName}</span></div>
            {record.workerName && <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Usta:</span><span className="font-medium">{record.workerName}</span></div>}
            {record.supplier?.name && <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Yetkazuvchi:</span><span className="font-medium">{record.supplier.name}</span></div>}
            {record.approvedBy?.fullName && <div className="flex gap-2"><span className="text-gray-500 w-32 shrink-0">Tasdiqladi:</span><span className="font-medium">{record.approvedBy.fullName}</span></div>}
          </div>

          {/* Ehtiyot qismlar jadvali */}
          {items.length > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Ehtiyot qismlar</h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border border-gray-200">
                    <th className="text-left px-3 py-2 border-r border-gray-200 font-medium text-gray-600">#</th>
                    <th className="text-left px-3 py-2 border-r border-gray-200 font-medium text-gray-600">Nomi</th>
                    <th className="text-center px-3 py-2 border-r border-gray-200 font-medium text-gray-600">Miqdor</th>
                    <th className="text-right px-3 py-2 border-r border-gray-200 font-medium text-gray-600">Narxi</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Jami</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => (
                    <tr key={i} className="border border-gray-200">
                      <td className="px-3 py-2 border-r border-gray-200 text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2 border-r border-gray-200">{item.sparePart?.name}</td>
                      <td className="px-3 py-2 border-r border-gray-200 text-center">{item.quantityUsed} ta</td>
                      <td className="px-3 py-2 border-r border-gray-200 text-right">{formatCurrency(Number(item.unitCost))}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(Number(item.unitCost) * item.quantityUsed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Xarajatlar xulosasi */}
          <div className="flex justify-end mb-5">
            <div className="w-64 text-sm space-y-1">
              {totalParts > 0 && <div className="flex justify-between"><span className="text-gray-500">Qism narxi:</span><span>{formatCurrency(totalParts)}</span></div>}
              {Number(record.laborCost) > 0 && <div className="flex justify-between"><span className="text-gray-500">Usta haqi:</span><span>{formatCurrency(Number(record.laborCost))}</span></div>}
              <div className="flex justify-between border-t border-gray-200 pt-1 font-bold"><span>Jami:</span><span>{formatCurrency(totalAll)}</span></div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>To'lov:</span>
                <span>{record.paymentType === 'cash' ? 'Naqd' : record.isPaid ? 'Qarz (to\'langan)' : 'Qarz (qarzdor)'}</span>
              </div>
            </div>
          </div>

          {/* Izoh */}
          {record.notes && (
            <div className="mb-5 text-sm">
              <span className="text-gray-500 font-medium">Izoh: </span>
              <span className="text-gray-700 italic">{record.notes}</span>
            </div>
          )}

          {/* Fotolar */}
          {(evidence || []).length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Fotolar</h3>
              <div className="flex gap-3 flex-wrap">
                {(evidence || []).map((ev: any) => (
                  <img
                    key={ev.id}
                    src={getFileUrl(ev.fileUrl)}
                    alt="evidence"
                    className="w-32 h-32 object-cover rounded-lg border border-gray-200"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Imzo qatorlari */}
          <div className="grid grid-cols-2 gap-8 mt-8 pt-4 border-t border-gray-200 text-sm">
            <div>
              <p className="text-gray-500 mb-6">Bajardi:</p>
              <div className="border-b border-gray-400 mb-1" />
              <p className="text-xs text-gray-400">{record.performedBy?.fullName}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-6">Tasdiqladi:</p>
              <div className="border-b border-gray-400 mb-1" />
              <p className="text-xs text-gray-400">{record.approvedBy?.fullName || '_______________'}</p>
            </div>
          </div>

          <p className="text-center text-xs text-gray-300 mt-6">AutoHisob · {new Date().toLocaleDateString('uz-UZ')}</p>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body > *:not(#maintenance-doc) { display: none !important; }
          .fixed { position: static !important; background: none !important; }
          .overflow-y-auto { overflow: visible !important; max-height: none !important; }
          .print\\:hidden { display: none !important; }
          .rounded-xl { border-radius: 0 !important; }
          .shadow-2xl { box-shadow: none !important; }
        }
      `}</style>
    </div>
  )
}
