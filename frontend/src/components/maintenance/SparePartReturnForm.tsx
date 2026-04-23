import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, X, Camera, Loader2, AlertTriangle, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

interface ReturnableItem {
  sparePartId: string
  name: string
  partCode: string
  originalQty: number
  returnedQty: number
  canReturnQty: number
  unitCost: number
  warehouseId: string
}

interface Props {
  maintenanceId: string
  vehicleLabel: string
  warehouseId: string
  onClose: () => void
  onDone: () => void
}

export default function SparePartReturnForm({ maintenanceId, vehicleLabel, warehouseId, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([])
  const [step, setStep] = useState<'form' | 'photo'>('form')
  const [createdReturnId, setCreatedReturnId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { data: returnableData, isLoading } = useQuery({
    queryKey: ['returnable-items', maintenanceId],
    queryFn: () => api.get(`/spare-part-returns/returnable/${maintenanceId}`).then(r => r.data.data),
  })

  const items: ReturnableItem[] = returnableData || []

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/spare-part-returns', body),
    onSuccess: (res) => {
      const id = res.data?.data?.id
      if (id) {
        setCreatedReturnId(id)
        setStep('photo')
      } else {
        toast.success('Qaytarish so\'rovi yuborildi')
        qc.invalidateQueries({ queryKey: ['spare-part-returns'] })
        qc.invalidateQueries({ queryKey: ['returns-pending'] })
        onDone()
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleSubmit = () => {
    if (!reason.trim()) { toast.error('Sabab kiritilishi shart'); return }
    const selectedItems = items
      .filter(i => (quantities[i.sparePartId] || 0) > 0)
      .map(i => ({ sparePartId: i.sparePartId, quantity: quantities[i.sparePartId], unitCost: i.unitCost, warehouseId: i.warehouseId }))
    if (selectedItems.length === 0) { toast.error('Kamida bitta qism tanlang'); return }

    createMutation.mutate({
      maintenanceId,
      warehouseId,
      reason,
      notes,
      items: selectedItems,
    })
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - photos.length)
    setPhotos(p => [...p, ...files.map(f => ({ file: f, url: URL.createObjectURL(f) }))])
    e.target.value = ''
  }

  const handlePhotoUpload = async () => {
    if (!createdReturnId) return
    if (photos.length === 0) {
      toast.error('Kamida 1 ta foto yuklash shart')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      photos.forEach(p => form.append('photos', p.file))
      await api.post(`/spare-part-returns/${createdReturnId}/evidence`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Qaytarish so\'rovi yuborildi. Admin tasdiqlashi kutilmoqda.')
      qc.invalidateQueries({ queryKey: ['spare-part-returns'] })
      qc.invalidateQueries({ queryKey: ['returns-pending'] })
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Rasm yuklanmadi')
    } finally {
      setUploading(false)
    }
  }

  const totalValue = items.reduce((sum, i) => sum + (quantities[i.sparePartId] || 0) * i.unitCost, 0)

  if (step === 'photo') {
    return (
      <Modal open onClose={onClose} title="Foto-otchet (majburiy)" size="md">
        <div className="space-y-4">
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-3">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Foto-otchet yuborilmasa tasdiqlashga qabul qilinmaydi
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 opacity-80">
              Ehtiyot qismlarni qaytarayotgan paytingizni yoki qismlarning holatini ko'rsating (1-5 ta rasm).
            </p>
          </div>

          {photos.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.url} alt="preview" className="w-24 h-24 object-cover rounded-lg border-2 border-blue-400" />
                  <button
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {photos.length < 5 && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
            >
              <Camera className="mx-auto w-8 h-8 text-gray-400 mb-2" />
              <p className="text-sm text-gray-500">Rasm tanlash ({photos.length}/5)</p>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handlePhotoChange} />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose} disabled={uploading}>Bekor qilish</Button>
            <Button onClick={handlePhotoUpload} disabled={uploading || photos.length === 0} className="gap-2">
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Yuklanmoqda...</> : <><Upload className="w-4 h-4" /> Yuborish</>}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="Ehtiyot qism qaytarish" size="lg">
      <div className="space-y-4">
        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
          <span className="font-medium text-gray-700 dark:text-gray-300">Avtomashina:</span> {vehicleLabel}
        </div>

        {/* Sabab — majburiy */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Qaytarish sababi <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="Nima uchun qaytarilmoqda? (masalan: qism o'rnatilmadi, noto'g'ri qism keldi...)"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Qismlar tanlash */}
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Qaytariladigan qismlar <span className="text-red-500">*</span>
          </p>
          {isLoading ? (
            <div className="text-center py-6 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-400 italic py-4 text-center">
              Bu ta'mirlash yozuvidan qaytarilishi mumkin bo'lgan qism qolmagan
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {items.map(item => (
                <div key={item.sparePartId} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">{item.partCode} • {formatCurrency(item.unitCost)} / ta</p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Max qaytarish: {item.canReturnQty} ta
                      {item.returnedQty > 0 && <span className="text-gray-400 ml-1">(avval {item.returnedQty} ta qaytarilgan)</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setQuantities(q => ({ ...q, [item.sparePartId]: Math.max(0, (q[item.sparePartId] || 0) - 1) }))}
                      className="w-7 h-7 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-600 text-lg font-bold"
                    >−</button>
                    <span className="w-8 text-center text-sm font-semibold text-gray-800 dark:text-gray-200">
                      {quantities[item.sparePartId] || 0}
                    </span>
                    <button
                      onClick={() => setQuantities(q => ({ ...q, [item.sparePartId]: Math.min(item.canReturnQty, (q[item.sparePartId] || 0) + 1) }))}
                      className="w-7 h-7 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-600 text-lg font-bold"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {totalValue > 0 && (
          <div className="flex justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
            <span>Qaytariladigan qiymat:</span>
            <span className="text-blue-600 dark:text-blue-400">{formatCurrency(totalValue)}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Qo'shimcha izoh</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={1}
            placeholder="Ixtiyoriy..."
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Keyingi bosqichda <strong>foto-otchet yuklash majburiy</strong>. Fotosiz so'rov admin tomonidan qabul qilinmaydi.</span>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>Bekor qilish</Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || items.length === 0}
            className="gap-2"
          >
            {createMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saqlanmoqda...</>
              : <><RotateCcw className="w-4 h-4" /> Keyingisi: Foto yuklash</>}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
