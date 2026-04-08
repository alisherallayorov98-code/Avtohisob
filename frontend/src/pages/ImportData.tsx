import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Upload, Download, CheckCircle, XCircle, AlertTriangle, FileText, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import Button from '../components/ui/Button'

const IMPORT_TYPES = [
  {
    id: 'vehicles', label: 'Avtomobillar', icon: '🚗', color: 'blue',
    description: 'Avtomobil ro\'yxatini import qilish',
    fields: ['registrationNumber *', 'brand *', 'model *', 'year *', 'fuelType * (petrol/diesel/gas/electric)', 'mileage', 'purchaseDate (YYYY-MM-DD)', 'notes'],
  },
  {
    id: 'fuel', label: 'Yoqilg\'i yozuvlari', icon: '⛽', color: 'green',
    description: 'Yoqilg\'i kirim tarixini import qilish',
    fields: ['vehicleId * (UUID)', 'fuelType * (petrol/diesel/gas/electric)', 'amountLiters *', 'cost *', 'odometerReading *', 'refuelDate * (YYYY-MM-DD)', 'supplierId (UUID)'],
  },
  {
    id: 'spare_parts', label: 'Ehtiyot qismlar', icon: '🔩', color: 'orange',
    description: 'Ehtiyot qismlar ro\'yxatini import qilish',
    fields: ['name *', 'partCode *', 'category *', 'unitPrice *', 'supplierId * (UUID)', 'description'],
  },
]

export default function ImportData() {
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [csvText, setCsvText] = useState('')
  const [step, setStep] = useState<'select' | 'upload' | 'preview' | 'result'>('select')
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const previewMutation = useMutation({
    mutationFn: (data: any) => api.post('/data/preview', data).then(r => r.data.data),
    onSuccess: (data) => { setPreview(data); setStep('preview') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const importMutation = useMutation({
    mutationFn: (data: any) => api.post('/data/import', data).then(r => r.data.data),
    onSuccess: (data) => { setResult(data); setStep('result') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText(ev.target?.result as string || '')
    reader.readAsText(file, 'utf-8')
  }

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get(`/data/template/${selectedType}`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedType}-shablon.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Shablon yuklab olishda xato')
    }
  }

  const reset = () => {
    setSelectedType(null); setCsvText(''); setStep('select')
    setPreview(null); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectedTypeMeta = IMPORT_TYPES.find(t => t.id === selectedType)

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ma'lumot Import</h1>
        <p className="text-gray-500 text-sm">CSV fayl orqali ma'lumotlarni tizimga kiritish</p>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: 'select', label: 'Tur tanlash' },
          { key: 'upload', label: 'Fayl yuklash' },
          { key: 'preview', label: 'Tekshirish' },
          { key: 'result', label: 'Natija' },
        ].map((s, i, arr) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 ${step === s.key ? 'text-blue-600 font-medium' : ['result', 'preview', 'upload'].indexOf(step) > i ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s.key ? 'bg-blue-600 text-white' : ['result', 'preview', 'upload'].indexOf(step) > i ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                {['result', 'preview', 'upload'].indexOf(step) > i ? '✓' : i + 1}
              </div>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
          </div>
        ))}
      </div>

      {/* Step 1: Select type */}
      {step === 'select' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {IMPORT_TYPES.map(t => (
            <button key={t.id} onClick={() => { setSelectedType(t.id); setStep('upload') }}
              className="text-left p-5 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-400 hover:shadow-md transition-all">
              <span className="text-3xl">{t.icon}</span>
              <h3 className="font-semibold text-gray-900 dark:text-white mt-2">{t.label}</h3>
              <p className="text-sm text-gray-500 mt-1">{t.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Upload */}
      {step === 'upload' && selectedTypeMeta && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-white">{selectedTypeMeta.icon} {selectedTypeMeta.label}</h3>
              <Button size="sm" variant="outline" icon={<Download className="w-3.5 h-3.5" />} onClick={handleDownloadTemplate}>
                Shablon yuklab olish
              </Button>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Kerakli ustunlar:</p>
              <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                {selectedTypeMeta.fields.map(f => <li key={f}>• {f}</li>)}
              </ul>
            </div>

            {/* File input */}
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors">
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="font-medium text-gray-700 dark:text-gray-300">CSV fayl tanlang</p>
              <p className="text-sm text-gray-400 mt-1">yoki quyida to'g'ridan-to'g'ri joylashtiring</p>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileChange} className="hidden" />
            </div>

            {/* Or paste CSV */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yoki CSV matnini joylashtiring</label>
              <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={6}
                placeholder="registrationNumber,brand,model,year,fuelType&#10;01A123AA,Toyota,Camry,2020,petrol"
                className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
            </div>

            {csvText && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <FileText className="w-4 h-4" />
                {csvText.split('\n').filter(l => l.trim()).length - 1} ta qator aniqlandi
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset}>Orqaga</Button>
            <Button disabled={!csvText.trim()} loading={previewMutation.isPending}
              onClick={() => previewMutation.mutate({ type: selectedType, csvText })}>
              Tekshirish
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
              <p className="text-xs text-blue-500">Jami qatorlar</p>
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{preview.totalRows}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
              <p className="text-xs text-green-500">Yaroqli</p>
              <p className="text-2xl font-bold text-green-900 dark:text-green-100">{preview.validRows}</p>
            </div>
            <div className={`${preview.errorCount > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700'} rounded-xl p-4`}>
              <p className="text-xs text-red-500">Xatolar</p>
              <p className={`text-2xl font-bold ${preview.errorCount > 0 ? 'text-red-900 dark:text-red-100' : 'text-gray-400'}`}>{preview.errorCount}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-500">Ustunlar</p>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{preview.headers?.length}</p>
            </div>
          </div>

          {/* Errors */}
          {preview.errors?.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Xatolar ({preview.errors.length})</p>
              </div>
              <ul className="text-xs text-red-700 dark:text-red-400 space-y-1">
                {preview.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          {/* Preview table */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Birinchi 5 qator ko'rinishi:</p>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="text-xs w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>{preview.headers?.map((h: string) => <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.preview?.map((row: any, i: number) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                      {preview.headers?.map((h: string) => <td key={h} className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[120px] truncate">{row[h] || '—'}</td>)}
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
            {result.imported > 0
              ? <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              : <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />}
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Import yakunlandi</h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
              <p className="text-xs text-blue-500">Jami</p>
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{result.total}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
              <p className="text-xs text-green-500">Import qilindi</p>
              <p className="text-2xl font-bold text-green-900 dark:text-green-100">{result.imported}</p>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
              <p className="text-xs text-yellow-500">O'tkazib yuborildi</p>
              <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{result.skipped}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <p className="text-xs text-red-500">Xatolar</p>
              <p className="text-2xl font-bold text-red-900 dark:text-red-100">{result.errorCount}</p>
            </div>
          </div>

          {result.errors?.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">Xatolar:</p>
              <ul className="text-xs text-red-700 dark:text-red-400 space-y-1">
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
