import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Upload, X, Loader2, CheckCircle, Image } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
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
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([])
  const [uploading, setUploading] = useState(false)

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

  return (
    <Modal open onClose={onClose} title="Foto-otchet yuklash" size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-medium">Tasdiqlash uchun foto kerak</p>
          <p className="text-xs mt-1 opacity-80">
            Ehtiyot qism o'rnatilganligini tasdiqlovchi 1-3 ta rasm yuboring. Admin ko'rib chiqadi.
          </p>
        </div>

        {existingCount > 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Allaqachon yuklangan: {existingCount} ta rasm
          </div>
        )}

        {/* Existing photos */}
        {(existing || []).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {(existing || []).map((ev: any) => (
              <div key={ev.id} className="relative">
                <img
                  src={ev.fileUrl}
                  alt="evidence"
                  className="w-24 h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <CheckCircle className="absolute top-1 right-1 w-4 h-4 text-green-500 bg-white rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* New previews */}
        {previews.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {previews.map((p, i) => (
              <div key={i} className="relative">
                <img src={p.url} alt="preview" className="w-24 h-24 object-cover rounded-lg border-2 border-blue-400" />
                <button
                  onClick={() => removePreview(i)}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload area */}
        {canUploadMore && (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <Camera className="mx-auto w-8 h-8 text-gray-400 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Rasm tanlash (max {3 - existingCount} ta)
            </p>
            <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP • Har biri max 10MB</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            Keyinroq
          </Button>
          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Yuklanmoqda...</>
            ) : previews.length > 0 ? (
              <><Upload className="w-4 h-4" /> {previews.length} ta rasm yuborish</>
            ) : (
              <><CheckCircle className="w-4 h-4" /> Tayyor</>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
