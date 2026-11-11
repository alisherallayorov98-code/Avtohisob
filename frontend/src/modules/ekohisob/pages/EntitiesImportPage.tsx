import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Download, CheckCircle2, FileSpreadsheet, History, RotateCcw, Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg, parseEkoError } from '../lib/ekoErrors'
import { invalidateEko } from '../lib/queries'
import {
  Banner, Button, Card, CardHeader, DataTable, Modal, Page, PageHeader, StatRow, StatTile, SegmentedControl,
  Toggle, useConfirm, cx, f,
} from '../ui'

interface RowError { rowNumber: number; message: string; column?: string }
interface SampleRow {
  rowNumber: number; name: string; stir: string | null; districtName: string | null
  mahallaName: string | null; billingMode: string; monthlyFee: number; cubicPrice: number
  phone: string | null
}
interface UpdateDiff {
  rowNumber: number; stir: string | null; name: string
  changes: { field: string; from: unknown; to: unknown }[]
}

interface Preview {
  fileName: string
  headerRow?: number
  totalRows: number
  validCount: number
  createCount: number
  updateCount: number
  errors: RowError[]
  errorCount: number
  warnings: RowError[]
  warningCount: number
  duplicates: { rowNumber: number; stir: string; firstRowNumber: number }[]
  duplicateCount: number
  newDistricts: string[]
  requiresNewDistrictConfirm: boolean
  newMahallaCount: number
  sample: SampleRow[]
  existingSample: { rowNumber: number; name: string; stir: string | null; existingName?: string }[]
  updateDiffs: UpdateDiff[]
  updateChangedCount: number
  updateUnchangedCount: number
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  unchanged?: number
  createdDistricts: number
  createdMahallas: number
  failed: number
  failures: RowError[]
  warnings?: RowError[]
  warningCount?: number
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

const FIELD_LABEL: Record<string, string> = {
  name: 'Nomi', code: 'Kod', address: 'Manzil', phone: 'Telefon', contactName: "Mas'ul shaxs",
  contractNumber: 'Shartnoma', contractStartMonth: 'Shartnoma boshlanishi', billingMode: "To'lov rejimi",
  monthlyFee: 'Oylik summa', cubicPrice: 'Kub narxi', location: 'Joylashuv', district: 'Tuman', mahalla: 'Mahalla',
}

function showVal(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'billingMode') return MODE_LABEL[String(v)] ?? String(v)
  if (typeof v === 'number') return f.num(v)
  return String(v)
}

const STEPS = ['Fayl tanlash', 'Tekshirish', 'Natija']

export default function EntitiesImportPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState<'preview' | 'confirm' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip')
  const [districtsOk, setDistrictsOk] = useState(false)
  const [showBatches, setShowBatches] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  async function handlePreview(fl: File) {
    if (!/\.xlsx$/i.test(fl.name)) {
      setError('Faqat .xlsx formatidagi Excel fayl qabul qilinadi. Faylni .xlsx sifatida saqlab qayta yuklang.')
      return
    }
    setFile(fl); setResult(null); setError(null); setDistrictsOk(false)
    setLoading('preview')
    try {
      const fd = new FormData()
      fd.append('file', fl)
      const res = await ekoApi.post('/entities/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      })
      setPreview(res.data.data)
    } catch (e) {
      setError(errMsg(e))
      setPreview(null); setFile(null)
    } finally { setLoading(null) }
  }

  async function handleConfirm() {
    if (!file || !preview) return
    setLoading('confirm'); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('onDuplicate', onDuplicate)
      if (preview.requiresNewDistrictConfirm) fd.append('confirmNewDistricts', 'true')
      const res = await ekoApi.post('/entities/import/confirm', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000,
      })
      setResult(res.data.data)
      invalidateEko(qc, 'all')
      toast.success(`${res.data.data.created} ta tashkilot qo'shildi`)
    } catch (e) {
      const info = parseEkoError(e)
      if (info.status === 409) setError('Boshqa import hozir bajarilmoqda. Tugashini kutib, qayta urinib ko\'ring.')
      else setError(info.message)
    } finally { setLoading(null) }
  }

  function reset() {
    setFile(null); setPreview(null); setResult(null); setError(null); setDistrictsOk(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const fl = e.dataTransfer.files?.[0]
    if (fl) handlePreview(fl)
  }

  const blockedByDistricts = !!preview?.requiresNewDistrictConfirm && !districtsOk

  return (
    <Page>
      <PageHeader
        title="Excel'dan import"
        subtitle="Tashkilotlarni ommaviy yuklash"
        back={{ to: '/ekohisob/entities', label: 'Tashkilotlar' }}
        actions={
          <>
            <Button variant="secondary" icon={<History className="w-4 h-4" aria-hidden />} onClick={() => setShowBatches(true)}>Tarix</Button>
            <Button variant="secondary" icon={<Download className="w-4 h-4" aria-hidden />} onClick={downloadTemplate}>Namuna fayl</Button>
          </>
        }
      />

      {/* Qadamlar */}
      <ol className="flex items-center gap-2 eko-text-sm flex-wrap" aria-label="Import qadamlari">
        {STEPS.map((label, i) => {
          const n = i + 1
          const done = step > n
          const current = step === n
          return (
            <li key={n} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
              <span className={cx(
                'w-7 h-7 rounded-full inline-flex items-center justify-center font-semibold eko-text-sm',
                step >= n ? 'bg-eko-text text-eko-surface' : 'bg-eko-surface-3 text-eko-muted',
              )}>
                {done ? <CheckCircle2 className="w-4 h-4" aria-hidden /> : n}
              </span>
              <span className={step >= n ? 'text-eko-text font-medium' : 'text-eko-muted'}>{label}</span>
              {i < STEPS.length - 1 && <span className="w-6 sm:w-10 h-px bg-eko-line-strong" aria-hidden />}
            </li>
          )
        })}
      </ol>

      {error && <Banner tone="danger">{error}</Banner>}

      {/* ── 1-qadam ── */}
      {step === 1 && (
        <Card>
          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cx(
              'block border-2 border-dashed rounded-eko-lg py-12 px-4 text-center cursor-pointer transition-colors',
              'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-eko-accent',
              dragOver ? 'border-eko-accent bg-eko-accent-soft' : 'border-eko-line-strong hover:bg-eko-surface-2',
            )}
          >
            {loading === 'preview' ? (
              <span className="flex flex-col items-center gap-2 text-eko-text-2" role="status">
                <Loader2 className="w-7 h-7 animate-spin" aria-hidden />
                Fayl tekshirilmoqda...
              </span>
            ) : (
              <>
                <Upload className="w-8 h-8 text-eko-subtle mx-auto mb-3" aria-hidden />
                <span className="block eko-text-md font-medium text-eko-text">Excel faylni tanlang yoki shu yerga tashlang</span>
                <span className="block eko-text-sm text-eko-muted mt-1">Faqat .xlsx · 10 MB gacha · 10 000 qatorgacha</span>
                <span className="inline-flex mt-4 h-11 md:h-10 px-4 items-center rounded-eko border border-eko-line bg-eko-surface eko-text-base font-medium text-eko-text">
                  Fayl tanlash
                </span>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="sr-only"
              disabled={loading !== null}
              onChange={e => { const fl = e.target.files?.[0]; if (fl) handlePreview(fl) }}
            />
          </label>

          <div className="mt-5 eko-text-sm text-eko-text-2 space-y-1.5">
            <p className="font-medium text-eko-text">Fayl talablari</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Birinchi qator — sarlavha (Nomi, STIR, Manzil, Tuman, Mahalla, Rejim, Oylik, Kub narxi...)</li>
              <li><b>Nomi</b> va <b>Tuman</b> majburiy. Bazada yo'q tuman/mahalla yaratiladi (yangi tuman tasdiq talab qiladi).</li>
              <li>"Belgilangan oylik" rejimida oylik summa, "Talon" rejimida kub narxi majburiy.</li>
              <li>Namuna faylni yuklab olib, ustunlar tartibiga qarang.</li>
            </ul>
          </div>
        </Card>
      )}

      {/* ── 2-qadam ── */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <p className="eko-text-sm text-eko-muted">
            {preview.fileName}{preview.headerRow ? ` · sarlavha ${preview.headerRow}-qatorda` : ''}
          </p>
          <StatRow>
            <StatTile label="Jami qator" value={f.num(preview.totalRows)} />
            <StatTile label="Yangi qo'shiladi" value={f.num(preview.createCount)} tone="accent" />
            <StatTile label="Mavjud (STIR bo'yicha)" value={f.num(preview.updateCount)} />
            <StatTile label="Xatoli qator" value={f.num(preview.errorCount)} tone={preview.errorCount > 0 ? 'danger' : 'neutral'} />
          </StatRow>

          {preview.requiresNewDistrictConfirm && (
            <Card>
              <Banner tone="warn" className="mb-3">
                <b>{preview.newDistricts.length} ta yangi tuman yaratiladi:</b> {preview.newDistricts.join(', ')}.
                {' '}Imlo xatosi bo'lsa, bitta tuman ikki xil bo'lib qoladi.
                {preview.newMahallaCount > 0 && ` Yana ${preview.newMahallaCount} ta yangi mahalla qo'shiladi.`}
              </Banner>
              <Toggle
                checked={districtsOk}
                onChange={setDistrictsOk}
                label="Yangi tumanlar yaratilishini tasdiqlayman"
                hint="Tasdiqlamaguncha import tugmasi yoqilmaydi."
              />
            </Card>
          )}
          {!preview.requiresNewDistrictConfirm && preview.newMahallaCount > 0 && (
            <Banner tone="info">{preview.newMahallaCount} ta yangi mahalla yaratiladi.</Banner>
          )}

          {preview.updateCount > 0 && (
            <Card>
              <p className="eko-text-base font-medium text-eko-text mb-3">
                {preview.updateCount} ta tashkilot STIR bo'yicha bazada mavjud. Nima qilinsin?
              </p>
              <SegmentedControl<'skip' | 'update'>
                ariaLabel="Mavjud tashkilotlar bilan nima qilinsin"
                value={onDuplicate}
                onChange={setOnDuplicate}
                options={[
                  { value: 'skip', label: "O'tkazib yuborish" },
                  { value: 'update', label: 'Fayl bilan yangilash' },
                ]}
              />
              {onDuplicate === 'update' ? (
                <div className="mt-4">
                  <p className="eko-text-sm text-eko-text-2 mb-2">
                    {preview.updateChangedCount} tasida o'zgarish bor, {preview.updateUnchangedCount} tasi o'zgarmaydi.
                    Bo'sh kataklar mavjud ma'lumotni o'chirmaydi.
                  </p>
                  {preview.updateDiffs.length > 0 && (
                    <DataTable<UpdateDiff>
                      aria-label="Yangilanadigan maydonlar"
                      rows={preview.updateDiffs}
                      rowKey={d => d.rowNumber}
                      maxHeight={320}
                      columns={[
                        { key: 'row', title: 'Qator', render: d => `${d.rowNumber}`, width: 70, mobile: 'secondary' },
                        { key: 'name', title: 'Tashkilot', render: d => (
                          <span><span className="font-medium">{d.name}</span>{d.stir && <span className="block eko-text-xs text-eko-muted eko-num">STIR {d.stir}</span>}</span>
                        ), mobile: 'primary' },
                        { key: 'changes', title: "O'zgarishlar (eski → yangi)", render: d => (
                          <ul className="space-y-0.5">
                            {d.changes.map(c => (
                              <li key={c.field} className="eko-text-sm">
                                <span className="text-eko-muted">{FIELD_LABEL[c.field] ?? c.field}:</span>{' '}
                                <span className="line-through text-eko-muted">{showVal(c.field, c.from)}</span>
                                {' → '}
                                <span className="font-medium text-eko-text">{showVal(c.field, c.to)}</span>
                              </li>
                            ))}
                          </ul>
                        ) },
                      ]}
                    />
                  )}
                  {preview.updateChangedCount > preview.updateDiffs.length && (
                    <p className="eko-text-xs text-eko-muted mt-2">
                      Birinchi {preview.updateDiffs.length} tasi ko'rsatildi, yana {preview.updateChangedCount - preview.updateDiffs.length} tasi yangilanadi.
                    </p>
                  )}
                </div>
              ) : (
                preview.existingSample.length > 0 && (
                  <ul className="mt-3 eko-text-sm text-eko-text-2 space-y-0.5 max-h-32 overflow-y-auto">
                    {preview.existingSample.map(e => (
                      <li key={e.rowNumber}>
                        {e.rowNumber}-qator: <b>{e.name}</b>
                        {e.existingName && e.existingName !== e.name && ` (bazada: ${e.existingName})`}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </Card>
          )}

          {preview.errorCount > 0 && (
            <Card flush>
              <CardHeader title={`${preview.errorCount} ta xatoli qator — ular import qilinmaydi`} />
              <IssueList items={preview.errors} total={preview.errorCount} />
            </Card>
          )}

          {preview.warningCount > 0 && (
            <Card flush>
              <CardHeader title={`${preview.warningCount} ta ogohlantirish — qator import qilinadi, lekin maydon saqlanmaydi`} />
              <IssueList items={preview.warnings} total={preview.warningCount} />
            </Card>
          )}

          {preview.duplicateCount > 0 && (
            <Banner tone="warn">
              <b>Fayl ichida {preview.duplicateCount} ta takror STIR</b> — faqat birinchisi olinadi.
              <ul className="eko-text-sm mt-1 max-h-24 overflow-y-auto">
                {preview.duplicates.map((d, i) => (
                  <li key={i}>{d.rowNumber}-qator (STIR {d.stir}) — {d.firstRowNumber}-qator bilan bir xil</li>
                ))}
              </ul>
            </Banner>
          )}

          {preview.sample.length > 0 && (
            <Card flush>
              <CardHeader title={`Birinchi ${preview.sample.length} qator — to'g'ri o'qilganini tekshiring`} />
              <DataTable<SampleRow>
                aria-label="Namuna qatorlar"
                rows={preview.sample}
                rowKey={r => r.rowNumber}
                columns={[
                  { key: 'name', title: 'Nomi', render: r => r.name, mobile: 'primary' },
                  { key: 'stir', title: 'STIR', render: r => r.stir ?? '—' },
                  { key: 'place', title: 'Tuman / Mahalla', render: r => `${r.districtName ?? '—'}${r.mahallaName ? ` / ${r.mahallaName}` : ''}` },
                  { key: 'mode', title: 'Rejim', render: r => MODE_LABEL[r.billingMode] ?? r.billingMode },
                  { key: 'sum', title: 'Summa', align: 'right', render: r => r.billingMode === 'talon'
                    ? `${f.num(r.cubicPrice)}/kub` : r.monthlyFee > 0 ? `${f.num(r.monthlyFee)}/oy` : '—' },
                  { key: 'phone', title: 'Telefon', render: r => r.phone ?? '—' },
                ]}
              />
            </Card>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={reset} disabled={loading !== null}>Boshqa fayl</Button>
            <Button
              variant="primary"
              className="flex-1 min-w-[200px]"
              loading={loading === 'confirm'}
              disabled={preview.validCount === 0 || blockedByDistricts}
              onClick={handleConfirm}
              icon={<CheckCircle2 className="w-4 h-4" aria-hidden />}
            >
              {f.num(preview.validCount)} ta qatorni import qilish
            </Button>
          </div>
          {blockedByDistricts && (
            <p className="eko-text-sm text-eko-muted">Import qilish uchun yangi tumanlarni tasdiqlang.</p>
          )}
        </div>
      )}

      {/* ── 3-qadam ── */}
      {step === 3 && result && (
        <div className="space-y-4">
          <Card className="text-center">
            <CheckCircle2 className="w-10 h-10 text-eko-success mx-auto mb-3" aria-hidden />
            <p className="eko-text-lg font-semibold text-eko-text">Import yakunlandi</p>
            <p className="eko-text-base text-eko-text-2 mt-1">
              {result.created} ta yangi, {result.updated} ta yangilandi
              {result.unchanged ? `, ${result.unchanged} ta o'zgarishsiz` : ''}, {result.skipped} ta o'tkazib yuborildi
            </p>
            {(result.createdDistricts > 0 || result.createdMahallas > 0) && (
              <p className="eko-text-sm text-eko-muted mt-1">
                {result.createdDistricts} ta tuman, {result.createdMahallas} ta mahalla yaratildi
              </p>
            )}
          </Card>

          {(result.warningCount ?? 0) > 0 && (
            <Card flush>
              <CardHeader title={`${result.warningCount} ta ogohlantirish`} />
              <IssueList items={result.warnings ?? []} total={result.warningCount ?? 0} />
            </Card>
          )}

          {result.failed > 0 && (
            <Card flush>
              <CardHeader title={`${result.failed} ta qator import qilinmadi`} />
              <IssueList items={result.failures} total={result.failed} />
            </Card>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={reset}>Yana import qilish</Button>
            <Button variant="primary" className="flex-1 min-w-[200px]" onClick={() => navigate('/ekohisob/entities')}>
              Tashkilotlar ro'yxatiga o'tish
            </Button>
          </div>
        </div>
      )}

      {showBatches && <BatchesModal onClose={() => setShowBatches(false)} />}
    </Page>
  )
}

function IssueList({ items, total }: { items: RowError[]; total: number }) {
  return (
    <>
      <ul className="max-h-64 overflow-y-auto divide-y divide-eko-line">
        {items.map((e, i) => (
          <li key={i} className="px-4 py-2 eko-text-sm flex gap-3">
            <span className="text-eko-muted shrink-0 w-20 eko-num">{e.rowNumber}-qator</span>
            <span className="text-eko-text">{e.message}</span>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="px-4 py-2 eko-text-xs text-eko-muted border-t border-eko-line">...va yana {total - items.length} ta</p>
      )}
    </>
  )
}

/** Import tarixi + bekor qilish (dry-run -> oqibatlar -> ibora kiritish). */
function BatchesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  const q = useQuery<Batch[]>({
    queryKey: ['eko', 'import-batches'],
    queryFn: async () => (await ekoApi.get('/entities/import/batches')).data.data ?? [],
  })

  async function undo(b: Batch) {
    setMsg(null); setBusyId(b.id)
    try {
      // 1) Dry-run: frasasiz so'rov server oqibatni qaytaradi (400 CONFIRM_REQUIRED)
      let phrase = ''
      let willDelete = b.remaining
      let willKeep = 0
      try {
        await ekoApi.post(`/entities/import/batches/${b.id}/undo`)
      } catch (e) {
        const info = parseEkoError(e)
        if (info.code !== 'CONFIRM_REQUIRED') throw e
        phrase = info.data?.confirmPhrase ?? 'IMPORTNI BEKOR QILISH'
        willDelete = info.data?.willDelete ?? willDelete
        willKeep = info.data?.willKeep ?? 0
      }
      if (!phrase) { qc.invalidateQueries({ queryKey: ['eko', 'import-batches'] }); return }

      // 2) Oqibatlarni ko'rsatib, iborani kiritishni so'raymiz
      const ok = await confirm({
        title: 'Importni bekor qilish',
        message: `"${b.fileName ?? 'Import'}" importi bekor qilinsinmi?`,
        danger: true,
        confirmPhrase: phrase,
        consequences: [
          `${willDelete} ta tashkilot o'chiriladi`,
          willKeep > 0
            ? `${willKeep} tasida to'lov/talon/hisob bor — ular o'chmaydi, nofaol qilinadi`
            : "To'lov yoki taloni bor tashkilotlar o'chirilmaydi",
        ],
        confirmLabel: 'Importni bekor qilish',
        cancelLabel: 'Ortga',
      })
      if (!ok) return

      // 3) Haqiqiy bekor qilish
      const res = await ekoApi.post(`/entities/import/batches/${b.id}/undo`, { confirmPhrase: phrase })
      const d = res.data.data
      setMsg({
        tone: 'success',
        text: `${d.deleted} ta tashkilot o'chirildi${d.deactivated > 0 ? `, ${d.deactivated} tasi nofaol qilindi` : ''}.`,
      })
      invalidateEko(qc, 'entity')
      qc.invalidateQueries({ queryKey: ['eko', 'import-batches'] })
    } catch (e) {
      setMsg({ tone: 'danger', text: errMsg(e) })
    } finally { setBusyId(null) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Import tarixi"
      footer={<Button variant="secondary" onClick={onClose}>Yopish</Button>}
    >
      {msg && <div className="p-4 pb-0"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
      <DataTable<Batch>
        aria-label="Import tarixi"
        rows={q.data ?? []}
        rowKey={b => b.id}
        loading={q.isLoading}
        error={q.isError ? errMsg(q.error) : null}
        onRetry={() => q.refetch()}
        empty={{ title: 'Hali import qilinmagan', icon: <FileSpreadsheet className="w-6 h-6" /> }}
        columns={[
          { key: 'file', title: 'Fayl', mobile: 'primary', render: b => (
            <span>
              <span className="font-medium">{b.fileName ?? 'Import'}</span>
              <span className="block eko-text-xs text-eko-muted">{b.userName} · {f.dateTime(b.createdAt)}</span>
            </span>
          ) },
          { key: 'res', title: 'Natija', render: b => (
            <span className="eko-text-sm">
              {b.created} yangi, {b.updated} yangilandi{b.failed > 0 ? `, ${b.failed} xato` : ''}
              {b.undoneAt && <span className="block text-eko-muted">Bekor qilingan · {f.date(b.undoneAt)}</span>}
            </span>
          ) },
        ]}
        rowActions={b => !b.undoneAt && b.remaining > 0 ? (
          <Button
            size="sm" variant="secondary" loading={busyId === b.id}
            icon={<RotateCcw className="w-4 h-4" aria-hidden />}
            onClick={() => undo(b)}
          >
            Bekor qilish ({b.remaining})
          </Button>
        ) : null}
      />
    </Modal>
  )
}
