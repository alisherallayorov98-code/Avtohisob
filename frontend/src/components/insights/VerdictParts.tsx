// Tahlil hukmlari: "To'g'ri — muammo bor" / "Savol noto'g'ri" oynasi va hukmlar jurnali.
// Javobgarlik himoyasi: aniq fakt bo'lmagan savolni tasdiqlashdan oldin manbani ko'rib chiqish
// va sabab yozish majburiy; taxminda standart yechim — avval tushuntirish so'rash.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import api from '../../lib/api'
import { cn, formatDateTime } from '../../lib/utils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { CONFIDENCE, type Finding } from './parts'

const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || 'Xatolik'
const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm'

const WRONG_REASONS = [
  "Kalit so'z boshqa qismni bildiradi",
  "Ma'lumot xato kiritilgan (savol emas, kiritishni tuzatish kerak)",
  "Hisob noto'g'ri (GPS/probeg xato)",
  'Bu holat bizda odatiy',
]

export function VerdictModal({ finding, kind, onClose, onDone }: {
  finding: Finding | null; kind: 'confirmed' | 'wrong'; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [resolution, setResolution] = useState<'request' | 'note' | ''>('')
  const [dueDate, setDueDate] = useState('')
  const conf = finding?.confidence || 'guess'
  const res = resolution || (conf === 'fact' ? 'note' : 'request')
  const needReview = kind === 'confirmed' && conf !== 'fact'
  const minLen = kind === 'confirmed' && conf === 'guess' ? 10 : 3
  const reset = () => { setReason(''); setReviewed(false); setResolution(''); setDueDate('') }

  const m = useMutation({
    mutationFn: () => api.post('/insights/verdict', {
      verdict: kind, ruleKey: finding!.ruleKey, fingerprint: finding!.fingerprint, vehicleId: finding!.vehicleId,
      title: finding!.title, reason, reviewed, resolution: res, dueDate: dueDate || undefined,
    }).then(r => r.data.data),
    onSuccess: (d: any) => {
      if (kind === 'wrong') toast.success("Qayd etildi — savol yashirildi, qoida aniqligiga hisoblandi")
      else if (d?.resolution === 'request') toast.success(d?.request?.created ? "Tasdiqlandi — filialdan tushuntirish so'raldi" : 'Tasdiqlandi (so\'rov allaqachon yuborilgan)')
      else toast.success('Tasdiqlandi va jurnalga yozildi')
      reset(); onClose(); onDone()
    },
    onError: (e) => toast.error(errText(e)),
  })

  if (!finding) return null
  const C = CONFIDENCE[conf]
  const canSave = reason.trim().length >= minLen && (!needReview || reviewed) && !(kind === 'confirmed' && res === 'request' && !finding.branchId)
  return (
    <Modal open={!!finding} onClose={() => { reset(); onClose() }} size="md"
      title={kind === 'confirmed' ? "To'g'ri — muammo bor" : "Savol noto'g'ri"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Bekor qilish</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!canSave}>
            {kind === 'confirmed' ? (res === 'request' ? "Tasdiqlash va tushuntirish so'rash" : 'Tasdiqlash') : 'Qayd etish'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">{finding.title}</p>
        <div className={cn('flex gap-2 rounded-md border px-2.5 py-1.5 text-xs', C.cls)}>
          <C.icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span><b>{C.label}.</b> {finding.basis}</span>
        </div>

        {kind === 'confirmed' && conf === 'guess' && (
          <div className="flex gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Bu savol <b>taxmin</b>ga asoslangan. Hech kimni javobgar qilishdan oldin manbadagi yozuvlarni ochib ko'ring va filialdan tushuntirish so'rang.</span>
          </div>
        )}

        {needReview && (
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
            <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-0.5" />
            <span>Manbadagi yozuvlarni ko'rib chiqdim va muammo haqiqatan borligiga ishonch hosil qildim</span>
          </label>
        )}

        {kind === 'wrong' && (
          <div className="flex flex-wrap gap-1.5">
            {WRONG_REASONS.map(r => (
              <button key={r} onClick={() => setReason(r)}
                className={cn('text-xs px-2.5 py-1 rounded-full border', reason === r ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>
                {r}
              </button>
            ))}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {kind === 'confirmed' ? 'Nimani tekshirdingiz, nima topildi?' : "Nega noto'g'ri?"}
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000} className={inputCls}
            placeholder={kind === 'confirmed' ? "Masalan: ta'mir yozuvini ochdim — disk va korzinka 3 oyda ikki marta, usta bir xil" : "Masalan: \"mufta\" — suv quvuri muftasi, stseplenie emas"} />
          {reason.trim().length > 0 && reason.trim().length < minLen && <p className="text-xs text-amber-600 mt-1">Kamida {minLen} harf</p>}
        </div>

        {kind === 'confirmed' && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Keyingi qadam</p>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" checked={res === 'request'} onChange={() => setResolution('request')} className="mt-0.5" disabled={!finding.branchId} />
              <span>Filialdan tushuntirish so'rash{conf !== 'fact' && <span className="text-emerald-600"> (tavsiya)</span>}
                <span className="block text-xs text-gray-500">Mas'ul va haydovchi o'z izohini beradi — xulosa shundan keyin.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" checked={res === 'note'} onChange={() => setResolution('note')} className="mt-0.5" />
              <span>Faqat qayd etish<span className="block text-xs text-gray-500">Chora ko'rildi yoki keyinroq — jurnalda qoladi, savol ochiq turadi.</span></span>
            </label>
            {res === 'request' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Javob muddati</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-gray-500">Hukm jurnalga yoziladi (kim, qachon, nega). {kind === 'wrong' ? "Savol yashiriladi; bu turdagi savollar aniqligiga hisoblanadi." : ''}</p>
      </div>
    </Modal>
  )
}

interface VerdictRow {
  id: string; ruleKey: string; ruleName: string; title: string | null; verdict: 'confirmed' | 'wrong' | 'normal'
  confidence: string | null; reason: string; resolution: string | null; createdByName: string | null; createdAt: string
}
interface RuleStat { key: string; name: string; confirmed: number; wrong: number; normal: number; pct: number | null; low: boolean }

const VERDICT_LABEL: Record<VerdictRow['verdict'], { label: string; cls: string }> = {
  confirmed: { label: "To'g'ri", cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  wrong: { label: "Noto'g'ri", cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  normal: { label: 'Normal', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
}

export function VerdictJournalModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'journal' | 'rules'>('journal')
  const { data, isLoading } = useQuery<{ verdicts: VerdictRow[]; rules: RuleStat[] }>({
    queryKey: ['insights-verdicts'],
    queryFn: () => api.get('/insights/verdicts').then(r => r.data.data),
    enabled: open,
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/insights/verdicts/${id}`),
    onSuccess: () => { toast.success('Hukm bekor qilindi'); qc.invalidateQueries({ queryKey: ['insights-verdicts'] }); onChanged() },
    onError: (e) => toast.error(errText(e)),
  })
  return (
    <Modal open={open} onClose={onClose} title="Hukmlar jurnali" size="xl">
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {(['journal', 'rules'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('text-sm px-3 py-1.5 rounded-lg', tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200')}>
              {t === 'journal' ? 'Hukmlar' : 'Savol turlari aniqligi'}
            </button>
          ))}
        </div>
        {isLoading ? <p className="text-sm text-gray-500 py-6 text-center">Yuklanmoqda...</p>
          : tab === 'journal' ? (
            !data?.verdicts.length ? <p className="text-sm text-gray-500 py-6 text-center">Hali hukm yo'q.</p> : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
                {data.verdicts.map(v => (
                  <div key={v.id} className="py-2.5 flex gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={cn('font-medium px-1.5 py-0.5 rounded', VERDICT_LABEL[v.verdict].cls)}>{VERDICT_LABEL[v.verdict].label}</span>
                        {v.confidence && <span className="text-gray-500">{CONFIDENCE[v.confidence as keyof typeof CONFIDENCE]?.label}</span>}
                        <span className="text-gray-500">· {v.ruleName}</span>
                        {v.resolution === 'request' && <span className="text-blue-600">· tushuntirish so'ralgan</span>}
                      </div>
                      {v.title && <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5 break-words">{v.title}</p>}
                      <p className="text-sm text-gray-600 dark:text-gray-400 break-words">{v.reason}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{v.createdByName || '—'} · {formatDateTime(v.createdAt)}</p>
                    </div>
                    <button onClick={() => del.mutate(v.id)} title="Hukmni bekor qilish" className="self-start text-gray-400 hover:text-red-600 p-1">
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            !data?.rules.length ? <p className="text-sm text-gray-500 py-6 text-center">Hali statistika yo'q — savollarga hukm bering.</p> : (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1.5 pr-3">Savol turi</th><th className="pr-3">To'g'ri</th><th className="pr-3">Noto'g'ri</th><th className="pr-3">Normal</th><th className="pr-3">Aniqlik</th>
                  </tr></thead>
                  <tbody>
                    {data.rules.map(r => (
                      <tr key={r.key} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-100">{r.name}</td>
                        <td className="pr-3 text-emerald-700">{r.confirmed}</td>
                        <td className="pr-3 text-red-600">{r.wrong}</td>
                        <td className="pr-3 text-gray-500">{r.normal}</td>
                        <td className="pr-3">
                          {r.pct == null ? <span className="text-gray-400">kam hukm</span>
                            : <span className={cn('font-medium', r.low ? 'text-red-600' : r.pct >= 70 ? 'text-emerald-700' : 'text-amber-700')}>{r.pct}%{r.low && ' — "Taxmin"ga tushirilgan'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500 mt-2">Oxirgi 180 kun. Kamida 3 ta hukmdan keyin foiz chiqadi; ko'pincha noto'g'ri chiqqan tur avtomatik "Taxmin" bo'ladi va ro'yxat oxiriga tushadi.</p>
              </div>
            )
          )}
      </div>
    </Modal>
  )
}
