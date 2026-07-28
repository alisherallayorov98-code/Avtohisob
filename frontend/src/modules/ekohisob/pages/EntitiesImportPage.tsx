import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, Download, Loader2, CheckCircle2, AlertTriangle, XCircle,
  ArrowLeft, FileSpreadsheet, History, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { date as fmtDate, dateTime as fmtDateTime } from '../ui/format'
import { useConfirm } from '../ui'

interface RowError { rowNumber: number; message: string; column?: string }
interface SampleRow {
  rowNumber: number; name: string; stir: string | null; districtName: string | null
  mahallaName: string | null; billingMode: string; monthlyFee: number; cubicPrice: number
  phone: string | null
}

interface Preview {
  fileName: string
  totalRows: number
  validCount: number
  createCount: number
  updateCount: number
  errors: RowError[]
  errorCount: number
  duplicates: { rowNumber: number; stir: string; firstRowNumber: number }[]
  duplicateCount: number
  newDistricts: string[]
  newMahallas: { district: string; mahalla: string }[]
  newMahallaCount: number
  sample: SampleRow[]
  existingSample: { rowNumber: number; name: string; stir: string | null; existingName?: string }[]
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  createdDistricts: number
  createdMahallas: number
  failed: number
  failures: RowError[]
}

interface Batch {
  id: string
  fileName: string | null
  userName: string
  totalRows: number
  created: number
  updated: number
  skipped: number
  failed: number
  undoneAt: string | null
  createdAt: string
  remaining: number
}

const MODE_LABEL: Record<string, string> = {
  monthly_fixed: 'Belgilangan oylik',
  variable: "O'zgaruvchan",
  talon: 'Talon',
}

const fmt = (n: number) => n.toLocaleString('uz-UZ')

export default function EntitiesImportPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip')
  const [showBatches, setShowBatches] = useState(false)
  const [batches, setBatches] = useState<Batch[]>([])

  const step: 1 | 2 | 3 = result ? 3 : preview ? 2 : 1

  async function downloadTemplate() {
    try {
      const res = await ekoApi.get('/entities/import/template', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'ekohisob_import_namuna.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Namuna faylni yuklab olishda xato')
    }
  }

  async function handlePreview(f: File) {
    setFile(f)
    setResult(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await ekoApi.post('/entities/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })
      setPreview(res.data.data)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Faylni o\'qishda xato')
      setPreview(null)
      setFile(null)
    } finally { setLoading(false) }
  }

  async function handleConfirm() {
    if (!file) return
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('onDuplicate', onDuplicate)
      const res = await ekoApi.post('/entities/import/confirm', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
      })
      setResult(res.data.data)
      toast.success(`${res.data.data.created} ta tashkilot qo'shildi`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Import qilishda xato')
    } finally { setLoading(false) }
  }

  async function loadBatches() {
    setShowBatches(true)
    try {
      const res = await ekoApi.get('/entities/import/batches')
      setBatches(res.data.data ?? [])
    } catch { toast.error('Tarixni yuklashda xato') }
  }

  async function undoBatch(b: Batch) {
    const ok = await confirm({
      title: 'Importni bekor qilish',
      message: `"${b.fileName ?? 'Import'}" importi bekor qilinsinmi?`,
      danger: true,
      consequences: [
        `${b.remaining} ta tashkilot o'chiriladi`,
        "To'lov yoki taloni bor tashkilotlar saqlanib qoladi (ular o'chirilmaydi)",
      ],
      confirmLabel: 'Bekor qilish',
      cancelLabel: 'Ortga',
    })
    if (!ok) return
    try {
      const res = await ekoApi.post(`/entities/import/batches/${b.id}/undo`)
      toast.success(res.data.message || 'Bekor qilindi')
      loadBatches()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Bekor qilishda xato')
    }
  }

  function reset() {
    setFile(null); setPreview(null); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('../entities')}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"
            title="Tashkilotlarga qaytish"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Excel'dan import</h1>
            <p className="text-xs text-gray-500">Tashkilotlarni ommaviy yuklash</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadBatches}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <History className="w-4 h-4" />
            Tarix
          </button>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" />
            Namuna fayl
          </button>
        </div>
      </div>

      {/* Qadamlar */}
      <div className="flex items-center gap-2 text-xs">
        {[
          { n: 1, label: 'Fayl tanlash' },
          { n: 2, label: 'Tekshirish' },
          { n: 3, label: 'Natija' },
        ].map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold ${
              step >= n ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>{n}</span>
            <span className={step >= n ? 'text-gray-800 font-medium' : 'text-gray-400'}>{label}</span>
            {i < 2 && <span className="w-8 h-px bg-gray-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── 1-qadam: fayl ── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl py-12 text-center cursor-pointer hover:border-green-400 hover:bg-green-50/40 transition-colors"
          >
            {loading ? (
              <Loader2 className="w-8 h-8 text-green-600 animate-spin mx-auto" />
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700">Excel faylni tanlang (.xlsx)</p>
                <p className="text-xs text-gray-400 mt-1">Maksimal 10 MB, 10 000 qatorgacha</p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePreview(f) }}
          />
          <div className="mt-5 text-xs text-gray-500 space-y-1.5">
            <p className="font-semibold text-gray-600">Fayl talablari:</p>
            <p>• Birinchi qator — sarlavha (Nomi, STIR, Manzil, Tuman, Mahalla, Rejim, Oylik, Kub narxi...)</p>
            <p>• <b>Nomi</b> va <b>Tuman</b> majburiy. Bazada bo'lmagan tuman/mahalla avtomatik yaratiladi.</p>
            <p>• "Belgilangan oylik" rejimida oylik summa, "Talon" rejimida kub narxi majburiy.</p>
            <p>• Namuna faylni yuklab olib, ustunlar tartibiga qarang.</p>
          </div>
        </div>
      )}

      {/* ── 2-qadam: oldindan ko'rish ── */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <StatCard label="Jami qator" value={preview.totalRows} tone="gray" />
            <StatCard label="Yangi qo'shiladi" value={preview.createCount} tone="green" />
            <StatCard label="Mavjud (STIR bo'yicha)" value={preview.updateCount} tone="blue" />
            <StatCard label="Xatoli qator" value={preview.errorCount} tone={preview.errorCount > 0 ? 'red' : 'gray'} />
          </div>

          {/* Yangi tuman/mahalla ogohlantirishi */}
          {(preview.newDistricts.length > 0 || preview.newMahallaCount > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-amber-800">
                    {preview.newDistricts.length} ta yangi tuman va {preview.newMahallaCount} ta yangi mahalla yaratiladi
                  </p>
                  {preview.newDistricts.length > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      Tumanlar: {preview.newDistricts.join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-amber-600 mt-1.5">
                    Imlo xatosi bo'lsa ikki xil tuman paydo bo'ladi — ro'yxatni tekshirib chiqing.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Mavjud STIR — nima qilinsin */}
          {preview.updateCount > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-sm font-medium text-gray-800 mb-2">
                {preview.updateCount} ta tashkilot STIR bo'yicha bazada mavjud
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={onDuplicate === 'skip'} onChange={() => setOnDuplicate('skip')} />
                  <span>O'tkazib yuborilsin (o'zgartirmaslik)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={onDuplicate === 'update'} onChange={() => setOnDuplicate('update')} />
                  <span>Fayldagi ma'lumot bilan yangilansin</span>
                </label>
              </div>
              {preview.existingSample.length > 0 && (
                <div className="mt-3 text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                  {preview.existingSample.map(e => (
                    <p key={e.rowNumber}>
                      {e.rowNumber}-qator: <b>{e.name}</b>
                      {e.existingName && e.existingName !== e.name && ` (bazada: ${e.existingName})`}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Xatolar */}
          {preview.errorCount > 0 && (
            <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-red-50 border-b border-red-100 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <p className="text-sm font-medium text-red-700">
                  {preview.errorCount} ta xatoli qator — ular import qilinmaydi
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                {preview.errors.map((e, i) => (
                  <div key={i} className="px-4 py-2 text-sm flex gap-3">
                    <span className="text-gray-400 shrink-0 w-16">{e.rowNumber}-qator</span>
                    <span className="text-red-600">{e.message}</span>
                  </div>
                ))}
              </div>
              {preview.errorCount > preview.errors.length && (
                <p className="px-4 py-2 text-xs text-gray-400">
                  ...va yana {preview.errorCount - preview.errors.length} ta
                </p>
              )}
            </div>
          )}

          {/* Takrorlar */}
          {preview.duplicateCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
              <p className="font-medium text-amber-800">
                Fayl ichida {preview.duplicateCount} ta takror STIR — faqat birinchisi olinadi
              </p>
              <div className="text-xs text-amber-700 mt-1 max-h-24 overflow-y-auto">
                {preview.duplicates.map((d, i) => (
                  <p key={i}>{d.rowNumber}-qator (STIR {d.stir}) — {d.firstRowNumber}-qator bilan bir xil</p>
                ))}
              </div>
            </div>
          )}

          {/* Namuna qatorlar */}
          {preview.sample.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <p className="px-4 py-2.5 text-sm font-medium text-gray-700 border-b border-gray-100">
                Birinchi {preview.sample.length} qator — to'g'ri o'qilganini tekshiring
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">Nomi</th>
                      <th className="text-left px-3 py-2">STIR</th>
                      <th className="text-left px-3 py-2">Tuman / Mahalla</th>
                      <th className="text-left px-3 py-2">Rejim</th>
                      <th className="text-right px-3 py-2">Summa</th>
                      <th className="text-left px-3 py-2">Telefon</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {preview.sample.map(r => (
                      <tr key={r.rowNumber}>
                        <td className="px-3 py-2 text-gray-800">{r.name}</td>
                        <td className="px-3 py-2 text-gray-500">{r.stir ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {r.districtName}{r.mahallaName ? ` / ${r.mahallaName}` : ''}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{MODE_LABEL[r.billingMode] ?? r.billingMode}</td>
                        <td className="px-3 py-2 text-right text-gray-800">
                          {r.billingMode === 'talon'
                            ? `${fmt(r.cubicPrice)}/kub`
                            : r.monthlyFee > 0 ? `${fmt(r.monthlyFee)}/oy` : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{r.phone ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Boshqa fayl
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || preview.validCount === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {preview.validCount} ta qatorni import qilish
            </button>
          </div>
        </div>
      )}

      {/* ── 3-qadam: natija ── */}
      {step === 3 && result && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
            <p className="text-lg font-bold text-gray-800">Import yakunlandi</p>
            <p className="text-sm text-gray-500 mt-1">
              {result.created} ta yangi, {result.updated} ta yangilandi, {result.skipped} ta o'tkazib yuborildi
            </p>
            {(result.createdDistricts > 0 || result.createdMahallas > 0) && (
              <p className="text-xs text-gray-400 mt-1">
                {result.createdDistricts} ta tuman, {result.createdMahallas} ta mahalla yaratildi
              </p>
            )}
          </div>

          {result.failed > 0 && (
            <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
              <p className="px-4 py-2.5 bg-red-50 text-sm font-medium text-red-700 border-b border-red-100">
                {result.failed} ta qator import qilinmadi
              </p>
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                {result.failures.map((e, i) => (
                  <div key={i} className="px-4 py-2 text-sm flex gap-3">
                    <span className="text-gray-400 shrink-0 w-16">{e.rowNumber}-qator</span>
                    <span className="text-red-600">{e.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Yana import qilish
            </button>
            <button
              onClick={() => navigate('../entities')}
              className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold"
            >
              Tashkilotlar ro'yxatiga o'tish
            </button>
          </div>
        </div>
      )}

      {/* ── Import tarixi ── */}
      {showBatches && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowBatches(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-gray-800">Import tarixi</h3>
              </div>
              <button onClick={() => setShowBatches(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {batches.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">Hali import qilinmagan</p>
              ) : batches.map(b => (
                <div key={b.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{b.fileName ?? 'Import'}</p>
                    <p className="text-xs text-gray-400">
                      {b.userName} · {fmtDateTime(b.createdAt)} ·
                      {' '}{b.created} yangi, {b.updated} yangilandi
                      {b.failed > 0 && `, ${b.failed} xato`}
                    </p>
                    {b.undoneAt && (
                      <p className="text-xs text-red-500 mt-0.5">
                        Bekor qilingan · {fmtDate(b.undoneAt)}
                      </p>
                    )}
                  </div>
                  {!b.undoneAt && b.remaining > 0 && (
                    <button
                      onClick={() => undoBatch(b)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium shrink-0"
                      title="Import qilingan tashkilotlarni o'chirish"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Bekor qilish ({b.remaining})
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'gray' | 'green' | 'blue' | 'red' }) {
  const toneClass = {
    gray: 'text-gray-800',
    green: 'text-green-700',
    blue: 'text-blue-700',
    red: 'text-red-600',
  }[tone]
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${toneClass}`}>{fmt(value)}</p>
    </div>
  )
}
