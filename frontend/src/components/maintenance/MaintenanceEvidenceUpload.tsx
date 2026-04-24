import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Upload, X, Loader2, CheckCircle, Smartphone, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { getFileUrl } from '../../lib/api'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

interface Props {
  maintenanceId: string
  onClose: () => void
  onDone: () => void
}

export default function MaintenanceEvidenceUpload({ maintenanceId, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'choose' | 'computer' | 'telegram'>('choose')
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([])
  const [uploading, setUploading] = useState(false)
  const [otpData, setOtpData] = useState<{ code: string; expiresAt: string } | null>(null)
  const [otpLoading, setOtpLoading] = useState(false)
  const [timeLeft, setTimeLeft] = useState(600)

  const { data: existing } = useQuery({
    queryKey: ['maintenance-evidence', maintenanceId],
    queryFn: () => api.get(`/maintenance/${maintenanceId}/evidence`).then(r => r.data.data),
  })

  const existingCount = existing?.length || 0
  const canUploadMore = existingCount + previews.length < 3

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const remaining = 3 - existingCount - previews.length
    const toAdd = files.slice(0, remaining)
    const newPreviews = toAdd.map(f => ({ file: f, url: URL.createObjectURL(f) }))
    setPreviews(p => [...p, ...newPreviews])
    e.target.value = ''
  }

  const removePreview = (idx: number) => {
    setPreviews(p => {
      URL.revokeObjectURL(p[idx].url)
      return p.filter((_, i) => i !== idx)
    })
  }

  const handleUpload = async () => {
    if (previews.length === 0) { onDone(); return }
    setUploading(true)
    try {
      const form = new FormData()
      previews.forEach(p => form.append('photos', p.file))
      await api.post(`/maintenance/${maintenanceId}/evidence`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(`${previews.length} ta rasm yuklandi`)
      qc.invalidateQueries({ queryKey: ['maintenance-evidence', maintenanceId] })
      qc.invalidateQueries({ queryKey: ['maintenance-pending'] })
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Rasm yuklanmadi')
    } finally {
      setUploading(false)
    }
  }

  const generateOtp = async () => {
    setOtpLoading(true)
    try {
      const res = await api.post(`/maintenance/${maintenanceId}/evidence-otp`)
      setOtpData(res.data.data)
      setTimeLeft(600)
      // Countdown
      const interval = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) { clearInterval(interval); return 0 }
          return t - 1
        })
      }, 1000)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Kod yaratilmadi')
    } finally {
      setOtpLoading(false)
    }
  }

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  return (
    <Modal open onClose={onClose} title="Foto-otchet yuklash" size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-medium">Tasdiqlash uchun foto kerak</p>
          <p className="text-xs mt-1 opacity-80">Ehtiyot qism o'rnatilganligini tasdiqlovchi 1–3 ta rasm yuboring.</p>
        </div>

        {existingCount > 0 && (
          <div className="flex gap-2 flex-wrap">
            {(existing || []).map((ev: any) => (
              <div key={ev.id} className="relative">
                <img src={getFileUrl(ev.fileUrl)} alt="evidence"
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                <CheckCircle className="absolute top-1 right-1 w-4 h-4 text-green-500 bg-white rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Usul tanlash */}
        {mode === 'choose' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('computer')}
              className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
            >
              <Camera className="w-8 h-8 text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Kompyuterdan</span>
              <span className="text-xs text-gray-400">Fayl tanlang</span>
            </button>
            <button
              onClick={() => { setMode('telegram'); generateOtp() }}
              className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
            >
              <Smartphone className="w-8 h-8 text-blue-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Telefondan</span>
              <span className="text-xs text-gray-400">Telegram bot orqali</span>
            </button>
          </div>
        )}

        {/* Kompyuterdan yuklash */}
        {mode === 'computer' && (
          <div className="space-y-3">
            <button onClick={() => setMode('choose')} className="text-xs text-blue-500 hover:underline">← Orqaga</button>
            {previews.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {previews.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.url} alt="preview" className="w-20 h-20 object-cover rounded-lg border-2 border-blue-400" />
                    <button onClick={() => removePreview(i)}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {canUploadMore && (
              <div onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 transition-colors">
                <Camera className="mx-auto w-8 h-8 text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Rasm tanlash (max {3 - existingCount} ta)</p>
                <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP</p>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose} disabled={uploading}>Keyinroq</Button>
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Yuklanmoqda...</>
                  : previews.length > 0 ? <><Upload className="w-4 h-4" /> {previews.length} ta yuborish</>
                  : <><CheckCircle className="w-4 h-4" /> Tayyor</>}
              </Button>
            </div>
          </div>
        )}

        {/* Telegram OTP */}
        {mode === 'telegram' && (
          <div className="space-y-3">
            <button onClick={() => setMode('choose')} className="text-xs text-blue-500 hover:underline">← Orqaga</button>
            {otpLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : otpData ? (
              <div className="space-y-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 text-center">
                  <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">Telegram botga rasm yuboring, keyin shu kodni yozing:</p>
                  <div className="text-4xl font-black tracking-widest text-blue-700 dark:text-blue-300 font-mono my-2">
                    {otpData.code}
                  </div>
                  {timeLeft > 0 ? (
                    <p className="text-xs text-gray-500">{minutes}:{String(seconds).padStart(2, '0')} qoldi</p>
                  ) : (
                    <p className="text-xs text-red-500">Kod eskirdi</p>
                  )}
                </div>
                <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Telefoningizda <b>@AvtohisobAlertBot</b> ni oching</li>
                  <li>Rasmni yuboring</li>
                  <li>Bot so'raganda yuqoridagi <b>{otpData.code}</b> kodni yozing</li>
                </ol>
                {timeLeft === 0 && (
                  <Button variant="outline" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={generateOtp}>
                    Yangi kod olish
                  </Button>
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={onClose}>Keyinroq</Button>
                  <Button onClick={onDone}>Tayyor</Button>
                </div>
              </div>
            ) : (
              <Button onClick={generateOtp}>Kod olish</Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
