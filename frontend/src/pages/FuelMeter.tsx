import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Gauge, CheckCircle, XCircle, Edit2, Cpu, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiBaseUrl } from '../lib/api'
import { formatDateTime } from '../lib/utils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'

interface MeterReading {
  id: string
  imageUrl: string
  extractedValue?: number
  confidenceScore?: number
  rawOcrText?: string
  status: string
  processedAt?: string
  createdAt: string
  fuelRecord?: { vehicle?: { registrationNumber: string } }
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 90 ? 'text-green-600 bg-green-50' : pct >= 75 ? 'text-yellow-600 bg-yellow-50' : 'text-red-600 bg-red-50'
  const dot = pct >= 90 ? 'bg-green-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {pct}%
    </span>
  )
}

export default function FuelMeter() {
  const qc = useQueryClient()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [lastResult, setLastResult] = useState<MeterReading | null>(null)

  const { data: history, isLoading } = useQuery({
    queryKey: ['fuel-meter-history'],
    queryFn: () => api.get('/fuel-meter/history').then(r => r.data.data),
  })

  const analyzeMutation = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error('Rasm tanlanmadi')
      const fd = new FormData()
      fd.append('image', selectedFile)
      return api.post('/fuel-meter/analyze', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => {
      toast.success('Tahlil tugadi!')
      setLastResult(res.data.data)
      qc.invalidateQueries({ queryKey: ['fuel-meter-history'] })
      setSelectedFile(null); setPreview(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'AI tahlilida xato'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => api.put(`/fuel-meter/${id}`, { extractedValue: value }),
    onSuccess: () => {
      toast.success('Qiymat yangilandi')
      qc.invalidateQueries({ queryKey: ['fuel-meter-history'] })
      setEditId(null)
      if (lastResult?.id === editId) setLastResult(r => r ? { ...r, extractedValue: parseFloat(editValue) } : r)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleFileChange = (file: File) => {
    setSelectedFile(file)
    setLastResult(null)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const statusInfo: Record<string, { label: string; variant: any }> = {
    success: { label: 'Muvaffaqiyatli', variant: 'success' },
    failed: { label: "O'qib bo'lmadi", variant: 'danger' },
    processing: { label: 'Tahlil qilinmoqda...', variant: 'warning' },
    manually_corrected: { label: "Qo'lda to'g'irlandi", variant: 'info' },
    pending: { label: 'Kutilmoqda', variant: 'gray' },
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Hisoblagich Tahlili</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
          Gaz/benzin hisoblagich rasmini yuklab, AI orqali qiymatni avtomatik o'qing
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Rasm yuklash</h3>
          </div>
          <div className="p-5 space-y-4">
            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                preview
                  ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-900/10'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
              }`}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f) }}
              onDragOver={e => e.preventDefault()}
              onClick={() => document.getElementById('meter-upload')?.click()}
            >
              {preview ? (
                <div className="space-y-2">
                  <img src={preview} alt="Preview" className="max-h-44 mx-auto rounded-lg object-contain shadow-sm" />
                  <p className="text-xs text-blue-600 font-medium">{selectedFile?.name}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-14 h-14 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto">
                    <Gauge className="w-7 h-7 text-gray-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-700 dark:text-gray-300">Rasm yuklash</p>
                    <p className="text-sm text-gray-400 mt-0.5">Sudrab olib tashlang yoki bosing</p>
                  </div>
                  <p className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-700 px-3 py-1.5 rounded-lg inline-block">
                    JPG · PNG · WEBP · Max 5 MB
                  </p>
                </div>
              )}
              <input id="meter-upload" type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }} />
            </div>

            <Button
              disabled={!selectedFile}
              loading={analyzeMutation.isPending}
              icon={<Cpu className="w-4 h-4" />}
              onClick={() => analyzeMutation.mutate()}
              className="w-full"
              size="lg"
            >
              AI Tahlil Qilish
            </Button>
            {selectedFile && (
              <Button variant="outline" className="w-full" onClick={() => { setSelectedFile(null); setPreview(null); setLastResult(null) }}>
                Bekor qilish
              </Button>
            )}
          </div>
        </div>

        {/* Analysis Results Panel */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">AI Tahlil Natijalari</h3>
          </div>
          <div className="p-5">
            {analyzeMutation.isPending ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-blue-200 rounded-full" />
                  <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin absolute inset-0" />
                  <Cpu className="w-6 h-6 text-blue-500 absolute inset-0 m-auto" />
                </div>
                <p className="text-sm text-gray-500 font-medium">AI tahlil qilmoqda...</p>
              </div>
            ) : lastResult ? (
              <div className="space-y-5">
                {/* Status */}
                <div className={`flex items-center gap-3 p-4 rounded-xl ${
                  lastResult.status === 'success' ? 'bg-green-50 dark:bg-green-900/20' :
                  'bg-red-50 dark:bg-red-900/20'
                }`}>
                  {lastResult.status === 'success'
                    ? <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
                    : <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
                  }
                  <div>
                    <p className={`font-semibold ${lastResult.status === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                      {lastResult.status === 'success' ? 'Muvaffaqiyatli tahlil qilindi' : "Rasm o'qib bo'lmadi"}
                    </p>
                    <p className="text-xs text-gray-500">{formatDateTime(lastResult.createdAt)}</p>
                  </div>
                </div>

                {/* Extracted Value */}
                {lastResult.extractedValue != null && (
                  <div className="text-center py-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Ajratib olingan qiymat</p>
                    <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                      {Number(lastResult.extractedValue).toFixed(2)}
                      <span className="text-lg font-normal text-gray-400 ml-1">Litr</span>
                    </p>
                  </div>
                )}

                {/* Confidence */}
                {lastResult.confidenceScore != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Ishonch darajasi</span>
                    <ConfidenceBadge score={Number(lastResult.confidenceScore)} />
                  </div>
                )}
                {lastResult.confidenceScore != null && (
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full">
                    <div
                      className={`h-full rounded-full transition-all ${
                        Number(lastResult.confidenceScore) >= 0.9 ? 'bg-green-500' :
                        Number(lastResult.confidenceScore) >= 0.75 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Number(lastResult.confidenceScore) * 100}%` }}
                    />
                  </div>
                )}

                {/* Manual correction */}
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                  <p className="text-xs text-gray-500 mb-2">Qo'lda tuzatish</p>
                  {editId === lastResult.id ? (
                    <div className="flex gap-2">
                      <input type="number" step="0.01" placeholder="Yangi qiymat"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={editValue} onChange={e => setEditValue(e.target.value)} />
                      <Button size="sm" onClick={() => updateMutation.mutate({ id: lastResult.id, value: editValue })} loading={updateMutation.isPending}>
                        Saqlash
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Bekor</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" icon={<Edit2 className="w-3.5 h-3.5" />}
                      onClick={() => { setEditId(lastResult.id); setEditValue(String(lastResult.extractedValue || '')) }}>
                      Qiymatni tuzatish
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <div className="w-16 h-16 bg-gray-50 dark:bg-gray-700 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-gray-300" />
                </div>
                <p className="text-gray-500 font-medium">Natijalar bu yerda ko'rinadi</p>
                <p className="text-gray-400 text-sm">Rasm yuklang va tahlil boshlang</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white">Tahlil Tarixi</h3>
          <span className="text-xs text-gray-400">{(history || []).length} ta yozuv</span>
        </div>

        {/* Table Header */}
        <div className="hidden sm:grid grid-cols-5 gap-4 px-5 py-2.5 bg-gray-800 dark:bg-gray-900 text-white text-xs font-semibold rounded-none">
          <span>Rasm</span>
          <span>Qiymat</span>
          <span>Ishonch</span>
          <span>Holat</span>
          <span>Vaqt</span>
        </div>

        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {isLoading ? (
            <div className="py-12 text-center">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (history || []).length === 0 ? (
            <div className="py-12 text-center">
              <Gauge className="w-10 h-10 text-gray-200 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Tahlil qilingan rasmlar yo'q</p>
            </div>
          ) : (history || []).map((r: MeterReading) => {
            const info = statusInfo[r.status] || statusInfo.pending
            return (
              <div key={r.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                {/* Image */}
                <div className="w-14 h-14 flex-shrink-0">
                  <img
                    src={`${apiBaseUrl}${r.imageUrl}`}
                    alt="meter"
                    className="w-14 h-14 object-cover rounded-lg border border-gray-200 dark:border-gray-600"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>

                {/* Value */}
                <div className="flex-1 min-w-0">
                  {editId === r.id ? (
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.01"
                        className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-28"
                        value={editValue} onChange={e => setEditValue(e.target.value)} />
                      <Button size="sm" onClick={() => updateMutation.mutate({ id: r.id, value: editValue })} loading={updateMutation.isPending}>OK</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditId(null)}>✕</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-gray-900 dark:text-white">
                        {r.extractedValue != null ? `${Number(r.extractedValue).toFixed(2)} L` : '—'}
                      </span>
                      {r.extractedValue != null && (
                        <button className="text-gray-300 hover:text-gray-500 transition-colors"
                          onClick={() => { setEditId(r.id); setEditValue(String(r.extractedValue)) }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  {r.confidenceScore != null && (
                    <ConfidenceBadge score={Number(r.confidenceScore)} />
                  )}
                </div>

                {/* Status */}
                <div className="flex-shrink-0">
                  <Badge variant={info.variant}>{info.label}</Badge>
                </div>

                {/* Time */}
                <div className="text-xs text-gray-400 flex-shrink-0 hidden sm:block">
                  {formatDateTime(r.createdAt)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
