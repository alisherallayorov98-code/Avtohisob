import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, Clock, XCircle, Upload, Camera, X, Loader2, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { getFileUrl } from '../../lib/api'
import { formatDate } from '../../lib/utils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

interface OldPartDebt {
  id: string
  vehicleLabel: string
  sparePartName: string
  quantity: number
  status: 'open' | 'submitted' | 'cleared' | 'rejected'
  submittedAt?: string
  deliveryMethod?: string
  submissionNote?: string
  rejectedReason?: string
  approvedAt?: string
  createdAt: string
  evidence: Array<{ id: string; fileUrl: string }>
}

function StatusBadge({ status }: { status: OldPartDebt['status'] }) {
  const map = {
    open:      { label: 'Topshirilmagan', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: <AlertTriangle className="w-3 h-3" /> },
    submitted: { label: 'Tekshirilmoqda', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <Clock className="w-3 h-3" /> },
    cleared:   { label: 'Qabul qilindi',  cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: <CheckCircle className="w-3 h-3" /> },
    rejected:  { label: 'Rad etildi',     cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: <XCircle className="w-3 h-3" /> },
  }
  const s = map[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  )
}

interface SubmitModalProps {
  debt: OldPartDebt
  onClose: () => void
  onDone: () => void
}

function SubmitModal({ debt, onClose, onDone }: SubmitModalProps) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [method, setMethod] = useState<'photo' | 'physical'>('photo')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([])
  const [step, setStep] = useState<'form' | 'upload'>('form')
  const [uploading, setUploading] = useState(false)

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/old-part-debts/${debt.id}/submit`, {
      deliveryMethod: method,
      submissionNote: note || undefined,
    }),
    onSuccess: () => {
      if (method === 'photo') {
        setStep('upload')
      } else {
        toast.success('Topshirish so\'rovi yuborildi. Admin tasdiqlaydi.')
        qc.invalidateQueries({ queryKey: ['my-old-part-debts'] })
        onDone()
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - photos.length)
    setPhotos(p => [...p, ...files.map(f => ({ file: f, url: URL.createObjectURL(f) }))])
    e.target.value = ''
  }

  const handleUpload = async () => {
    if (photos.length === 0) { toast.error('Kamida 1 ta foto yuklang'); return }
    setUploading(true)
    try {
      for (const p of photos) {
        const form = new FormData()
        form.append('photos', p.file)
        await api.post(`/old-part-debts/${debt.id}/evidence`, form)
      }
      toast.success('Yuborildi. Admin tasdiqlaydi.')
      qc.invalidateQueries({ queryKey: ['my-old-part-debts'] })
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Rasm yuklanmadi')
    } finally {
      setUploading(false)
    }
  }

  if (step === 'upload') {
    return (
      <Modal open onClose={onClose} title="Eski qism fotosi" size="md">
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-semibold">Eski qismning fotosini yuboring</p>
            <p className="text-xs mt-1 opacity-80">Buzilgan yoki ishlatilgan qismni ko'rsating (1-5 ta rasm).</p>
          </div>

          {photos.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.url} alt="" className="w-20 h-20 object-cover rounded-lg border-2 border-blue-400" />
                  <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {photos.length < 5 && (
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 transition-colors">
              <Camera className="mx-auto w-8 h-8 text-gray-400 mb-2" />
              <p className="text-sm text-gray-500">Rasm tanlash ({photos.length}/5)</p>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoChange} />
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={uploading}>Keyinroq</Button>
            <Button onClick={handleUpload} disabled={uploading || photos.length === 0}>
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Yuklanmoqda...</> : <><Upload className="w-4 h-4" /> Yuborish</>}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="Eski qismni topshirish" size="md">
      <div className="space-y-4">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-sm">
          <p className="font-medium text-gray-800 dark:text-gray-200">{debt.sparePartName} × {debt.quantity}</p>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{debt.vehicleLabel}</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Topshirish usuli</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMethod('photo')}
              className={`p-3 rounded-lg border-2 text-left transition-colors ${method === 'photo' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">📷 Foto yuborish</p>
              <p className="text-xs text-gray-500 mt-0.5">Buzilgan qismning rasmini yuboring</p>
            </button>
            <button onClick={() => setMethod('physical')}
              className={`p-3 rounded-lg border-2 text-left transition-colors ${method === 'physical' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">🏢 Filialni olib borish</p>
              <p className="text-xs text-gray-500 mt-0.5">Qismni jismoniy olib kelasiz</p>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh (ixtiyoriy)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Qo'shimcha ma'lumot..."
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>

        {debt.rejectedReason && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
            <p className="font-semibold">Oldingi urinish rad etildi:</p>
            <p className="mt-0.5">{debt.rejectedReason}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={submitMutation.isPending}>Bekor qilish</Button>
          <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
            {submitMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saqlanmoqda...</> : 'Topshirish'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function OldPartDebtWorker() {
  const [submitDebt, setSubmitDebt] = useState<OldPartDebt | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data, isLoading } = useQuery<OldPartDebt[]>({
    queryKey: ['my-old-part-debts'],
    queryFn: () => api.get('/old-part-debts/my').then(r => r.data.data),
  })

  const debts = data || []
  const openCount = debts.filter(d => d.status === 'open' || d.status === 'rejected').length
  const submittedCount = debts.filter(d => d.status === 'submitted').length

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  }

  if (debts.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">Eski qism qarzi yo'q</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {(openCount > 0 || submittedCount > 0) && (
        <div className="flex gap-3 flex-wrap">
          {openCount > 0 && (
            <div className="flex-1 min-w-[140px] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{openCount}</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Topshirilmagan qarz</p>
            </div>
          )}
          {submittedCount > 0 && (
            <div className="flex-1 min-w-[140px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{submittedCount}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Tekshirilmoqda</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {debts.map(debt => (
          <div key={debt.id} className={`rounded-xl border p-4 ${
            debt.status === 'cleared' ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 opacity-60' :
            debt.status === 'submitted' ? 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10' :
            'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-800 dark:text-gray-200">{debt.sparePartName} × {debt.quantity}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{debt.vehicleLabel}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(debt.createdAt)}</p>
                {debt.rejectedReason && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">⚠ {debt.rejectedReason}</p>
                )}
                {debt.submissionNote && debt.status === 'submitted' && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Izoh: {debt.submissionNote}</p>
                )}
                {debt.evidence.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {debt.evidence.map(ev => (
                      <img key={ev.id} src={getFileUrl(ev.fileUrl)} alt=""
                        onClick={() => setLightbox(getFileUrl(ev.fileUrl))}
                        className="w-12 h-12 object-cover rounded cursor-zoom-in border border-gray-200 hover:opacity-80 transition-opacity" />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <StatusBadge status={debt.status} />
                {(debt.status === 'open' || debt.status === 'rejected') && (
                  <Button size="sm" onClick={() => setSubmitDebt(debt)}>
                    Topshirish
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {submitDebt && (
        <SubmitModal
          debt={submitDebt}
          onClose={() => setSubmitDebt(null)}
          onDone={() => setSubmitDebt(null)}
        />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 cursor-zoom-out" onClick={() => setLightbox(null)}>
          <button onClick={e => { e.stopPropagation(); setLightbox(null) }}
            className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full">
            <X className="w-5 h-5" />
          </button>
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
