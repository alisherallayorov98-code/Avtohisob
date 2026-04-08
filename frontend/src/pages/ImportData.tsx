import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Upload, Download, CheckCircle, AlertTriangle, FileText, ChevronRight, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import Button from '../components/ui/Button'
import { useAuthStore } from '../stores/authStore'
import { apiBaseUrl } from '../lib/api'

const IMPORT_TYPES = [
  {
    id: 'vehicles',    label: 'Avtomobillar',     icon: '🚗', color: 'blue',
    description: 'Avtomobil ro\'yxatini import qilish',
    required: ['registrationNumber', 'brand', 'model', 'year', 'fuelType', 'branchName'],
  },
  {
    id: 'spare_parts', label: 'Ehtiyot qismlar',  icon: '🔩', color: 'orange',
    description: 'Ehtiyot qismlar ro\'yxatini import qilish',
    required: ['name', 'partCode', 'category', 'unitPrice', 'supplierId'],
  },
  {
    id: 'inventory',   label: 'Ombor stok',        icon: '📦', color: 'green',
    description: 'Filiallar bo\'yicha stok kiritish',
    required: ['partCode', 'branchName', 'quantity'],
  },
  {
    id: 'suppliers',   label: 'Yetkazuvchilar',    icon: '🏭', color: 'purple',
    description: 'Yetkazuvchilar ro\'yxatini import qilish',
    required: ['name', 'phone'],
  },
  {
    id: 'fuel',        label: 'Yoqilg\'i yozuvlari', icon: '⛽', color: 'yellow',
    description: 'Yoqilg\'i kirim tarixini import qilish',
    required: ['vehicleId', 'fuelType', 'amountLiters', 'cost', 'odometerReading', 'refuelDate'],
  },
]

export default function ImportData() {
  const { accessToken } = useAuthStore()
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [csvText, setCsvText] = useState('')
  const [step, setStep] = useState<'select' | 'upload' | 'preview' | 'result'>('select')
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [fileMode, setFileMode] = useState<'csv' | 'xlsx' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const previewMutation = useMutation({
    mutationFn: (data: any) => api.post('/data/preview', data).then(r => r.data.data),
    onSuccess: (data) => { setPreview(data); setStep('preview') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Preview xatosi'),
  })

  const importMutation = useMutation({
    mutationFn: (data: any) => api.post('/data/import', data).then(r => r.data.data),
    onSuccess: (data) => { setResult(data); setStep('result') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Import xatosi'),
  })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

    if (isExcel) {
      setFileMode('xlsx')
      // Send to parse-excel endpoint
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('type', selectedType || '')
        const res = await fetch(`${apiBaseUrl}/api/data/parse-excel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })
        const json = await res.json()
        if (!res.ok) { toast.error(json.error || 'Excel o\'qishda xato'); return }
        const { csvText: parsed } = json.data
        setCsvText(parsed)
        toast.success(`Excel o'qildi: ${json.data.rowCount} ta qator`)
      } catch {
        toast.error('Excel faylni o\'qishda xato')
      }
    } else {
      setFileMode('csv')
      const reader = new FileReader()
      reader.onload = (ev) => setCsvText(ev.target?.result as string || '')
      reader.readAsText(file, 'utf-8')
    }
  }

  const handleDownloadTemplate = async () => {
    if (!selectedType) return
    try {
      const res = await fetch(`${apiBaseUrl}/api/data/template/${selectedType}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) { toast.error('Shablon yuklab olishda xato'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedType}-shablon.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Shablon yuklab olindi')
    } catch {
      toast.error('Shablon yuklab olishda xato')
    }
  }

  const reset = () => {
    setSelectedType(null); setCsvText(''); setStep('select')
    setPreview(null); setResult(null); setFileMode(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectedMeta = IMPORT_TYPES.find(t => t.id === selectedType)
  const lineCount = csvText.split('\n').filter(l => l.trim()).length - 1

  const colorMap: Record<string, string> = {
    blue: 'border-blue-400 bg-blue-50 hover:border-blue-500',
    orange: 'border-orange-400 bg-orange-50 hover:border-orange-500',
    green: 'border-green-400 bg-green-50 hover:border-green-500',
    purple: 'border-purple-400 bg-purple-50 hover:border-purple-500',
    yellow: 'border-yellow-400 bg-yellow-50 hover:border-yellow-500',
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ma'lumot Import</h1>
        <p className="text-gray-500 text-sm">Excel (.xlsx) yoki CSV fayl orqali ma'lumotlarni tizimga kiritish</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: 'select', label: 'Tur tanlash' },
          { key: 'upload', label: 'Fayl yuklash' },
          { key: 'preview', label: 'Tekshirish' },
          { key: 'result', label: 'Natija' },
        ].map((s, i, arr) => {
          const done = ['result', 'preview', 'upload'].indexOf(step) > i
          const active = step === s.key
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${active ? 'text-blue-600 font-medium' : done ? 'text-green-600' : 'text-gray-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${active ? 'bg-blue-600 text-white' : done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Select type */}
      {step === 'select' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {IMPORT_TYPES.map(t => (
            <button key={t.id} onClick={() => { setSelectedType(t.id); setStep('upload') }}
              className={`text-left p-5 bg-white dark:bg-gray-800 border-2 rounded-xl shadow-sm transition-all
                hover:shadow-md ${colorMap[t.color] || 'border-gray-200 hover:border-gray-400'}`}>
              <span className="text-3xl">{t.icon}</span>
              <h3 className="font-semibold text-gray-900 dark:text-white mt-2">{t.label}</h3>
              <p className="text-sm text-gray-500 mt-1">{t.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {t.required.map(r => (
                  <span key={r} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-mono">{r}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Upload */}
      {step === 'upload' && selectedMeta && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">

            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800 dark:text-white text-lg">
                {selectedMeta.icon} {selectedMeta.label}
              </h3>
              <button onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                  bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
                <Download className="w-4 h-4" />
                Excel shablonini yuklab olish
              </button>
            </div>

            {/* Format info */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Kerakli ustunlar (birinchi qatorda):</p>
              <div className="flex flex-wrap gap-2">
                {selectedMeta.required.map(f => (
                  <code key={f} className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-900 dark:text-blue-100 px-2 py-0.5 rounded font-mono">{f}</code>
                ))}
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                💡 Shablon yuklab oling — to'ldirib, shu yerga yuklang. Excel (.xlsx) va CSV (.csv) formatlar qabul qilinadi.
              </p>
            </div>

            {/* File drop zone */}
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center
                cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors">
              <div className="flex justify-center gap-3 mb-3">
                <FileSpreadsheet className="w-8 h-8 text-emerald-500" />
                <Upload className="w-8 h-8 text-blue-400" />
              </div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Excel (.xlsx) yoki CSV fayl tanlang</p>
              <p className="text-sm text-gray-400 mt-1">Bosing yoki sudrab tashlang</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt"
                onChange={handleFileChange} className="hidden" />
            </div>

            {/* Status */}
            {fileMode && csvText && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg
                ${fileMode === 'xlsx' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                {fileMode === 'xlsx' ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                <span>
                  {fileMode === 'xlsx' ? 'Excel' : 'CSV'} fayl o\'qildi —{' '}
                  <strong>{lineCount}</strong> ta qator aniqlandi
                </span>
              </div>
            )}

            {/* Manual CSV paste */}
            <details className="group">
              <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                Yoki CSV matnini qo'lda joylashtiring ▾
              </summary>
              <div className="mt-2">
                <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setFileMode('csv') }} rows={5}
                  placeholder="registrationNumber,brand,model,year,fuelType&#10;01A123AA,Toyota,Camry,2020,petrol"
                  className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600
                    dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
              </div>
            </details>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset}>Orqaga</Button>
            <Button
              disabled={!csvText.trim() || lineCount < 1}
              loading={previewMutation.isPending}
              onClick={() => previewMutation.mutate({ type: selectedType, csvText })}>
              Tekshirish ({lineCount > 0 ? `${lineCount} ta qator` : '...'})
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Jami qatorlar', value: preview.totalRows, color: 'blue' },
              { label: 'Yaroqli', value: preview.validRows, color: 'green' },
              { label: 'Xatolar', value: preview.errorCount, color: preview.errorCount > 0 ? 'red' : 'gray' },
              { label: 'Ustunlar', value: preview.headers?.length, color: 'gray' },
            ].map(s => (
              <div key={s.label} className={`bg-${s.color}-50 dark:bg-${s.color}-900/20 rounded-xl p-4`}>
                <p className={`text-xs text-${s.color}-500`}>{s.label}</p>
                <p className={`text-2xl font-bold text-${s.color}-900 dark:text-${s.color}-100`}>{s.value}</p>
              </div>
            ))}
          </div>

          {preview.errors?.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Xatolar ({preview.errors.length})</p>
              </div>
              <ul className="text-xs text-red-700 dark:text-red-400 space-y-1 max-h-32 overflow-y-auto">
                {preview.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Birinchi 5 qator ko'rinishi:</p>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="text-xs w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>{preview.headers?.map((h: string) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.preview?.map((row: any, i: number) => (
                    <tr key={i} className={`border-t border-gray-100 dark:border-gray-700 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      {preview.headers?.map((h: string) => (
                        <td key={h} className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[160px] truncate">{row[h] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('upload')}>Orqaga</Button>
            {preview.validRows > 0 && (
              <Button loading={importMutation.isPending}
                onClick={() => importMutation.mutate({ type: selectedType, csvText })}>
                {preview.validRows} ta qatorni import qilish
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Result */}
      {step === 'result' && result && (
        <div className="space-y-5">
          <div className={`rounded-xl p-6 text-center ${result.imported > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-yellow-50 dark:bg-yellow-900/20'}`}>
            <CheckCircle className={`w-12 h-12 mx-auto mb-3 ${result.imported > 0 ? 'text-green-500' : 'text-yellow-500'}`} />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Import yakunlandi!</h3>
            <p className="text-sm text-gray-500 mt-1">{result.imported} ta yozuv muvaffaqiyatli qo'shildi</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Jami', value: result.total, color: 'blue' },
              { label: 'Import qilindi', value: result.imported, color: 'green' },
              { label: 'O\'tkazib yuborildi', value: result.skipped, color: 'yellow' },
              { label: 'Xatolar', value: result.errorCount, color: 'red' },
            ].map(s => (
              <div key={s.label} className={`bg-${s.color}-50 dark:bg-${s.color}-900/20 rounded-xl p-4`}>
                <p className={`text-xs text-${s.color}-500`}>{s.label}</p>
                <p className={`text-2xl font-bold text-${s.color}-900 dark:text-${s.color}-100`}>{s.value}</p>
              </div>
            ))}
          </div>

          {result.errors?.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">Xatolar:</p>
              <ul className="text-xs text-red-700 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          <Button onClick={reset}>Yangi import boshlash</Button>
        </div>
      )}
    </div>
  )
}
