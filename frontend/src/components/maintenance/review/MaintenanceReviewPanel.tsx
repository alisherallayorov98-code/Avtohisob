import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Clock, Info, Loader2, Truck, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { getFileUrl } from '../../../lib/api'
import { formatCurrency, formatDate, formatDateTime } from '../../../lib/utils'
import {
  PendingRecord, ReviewFlag, RISK_STYLE, REJECT_PRESETS, daysLabel, isVideoUrl,
} from './reviewTypes'

const km = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('uz-UZ')} km`)
const total = (r: PendingRecord) => Number(r.cost) + Number(r.laborCost)
const dateTime = (d: string) => formatDateTime(d)

function FlagIcon({ level }: { level: ReviewFlag['level'] }) {
  if (level === 'critical') return <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />
  if (level === 'warning') return <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
  return <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-400" />
}

export default function MaintenanceReviewPanel() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmRisky, setConfirmRisky] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance-pending'],
    queryFn: () => api.get('/maintenance/pending').then(r => r.data),
    refetchInterval: 30_000,
  })
  const records: PendingRecord[] = useMemo(() => data?.data || [], [data])
  const selected = records.find(r => r.id === selectedId) || null

  // Ish stolida birinchi ariza o'zi ochiladi; tanlangani yo'qolsa (qaror qilindi) keyingisi
  useEffect(() => {
    if (!records.length) { setSelectedId(null); return }
    if (!selectedId || !records.some(r => r.id === selectedId)) setSelectedId(records[0].id)
  }, [records, selectedId])

  useEffect(() => { setRejecting(false); setReason(''); setConfirmRisky(false) }, [selectedId])

  useEffect(() => {
    if (!lightbox) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [lightbox])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['maintenance-pending'] })
    qc.invalidateQueries({ queryKey: ['maintenance'] })
    qc.invalidateQueries({ queryKey: ['inventory'] })
    qc.invalidateQueries({ queryKey: ['maintenance-duplicate-alerts'] })
  }

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/maintenance/${id}/approve`),
    onSuccess: () => { toast.success('Tasdiqlandi, ehtiyot qism hisobdan chiqarildi'); setMobileDetail(false); refresh() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/maintenance/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('Rad etildi'); setMobileDetail(false); refresh() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const busy = approve.isPending || reject.isPending

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Yuklanmoqda...</div>
  }
  if (records.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-gray-500">
        <Clock className="mx-auto w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">Tasdiqlash kutayotgan yozuv yo'q</p>
      </div>
    )
  }

  const counts = { suspicious: 0, check: 0, ok: 0 }
  records.forEach(r => { counts[r.review?.risk || 'ok']++ })

  const review = selected?.review
  const risk = RISK_STYLE[review?.risk || 'ok']
  const stockBlocked = !!review?.flags.some(f => f.code === 'stock_low')
  const hasCritical = review?.risk === 'suspicious'
  const noEvidence = !!selected && selected.evidence.length === 0

  const onApprove = () => {
    if (!selected) return
    if (hasCritical && !confirmRisky) { setConfirmRisky(true); return }
    approve.mutate(selected.id)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="font-semibold text-gray-700 dark:text-gray-300">{records.length} ta ariza:</span>
        {counts.suspicious > 0 && <span className={`px-2 py-0.5 rounded-md font-semibold ${RISK_STYLE.suspicious.chip}`}>{counts.suspicious} ta diqqat</span>}
        {counts.check > 0 && <span className={`px-2 py-0.5 rounded-md font-semibold ${RISK_STYLE.check.chip}`}>{counts.check} ta tekshiring</span>}
        {counts.ok > 0 && <span className={`px-2 py-0.5 rounded-md font-semibold ${RISK_STYLE.ok.chip}`}>{counts.ok} ta toza</span>}
      </div>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
        {/* Navbat */}
        <div className={`space-y-2 ${mobileDetail ? 'hidden lg:block' : ''}`}>
          {records.map(r => {
            const st = RISK_STYLE[r.review?.risk || 'ok']
            const active = r.id === selectedId
            const flagCount = (r.review?.flags || []).filter(f => f.level !== 'info').length
            return (
              <button key={r.id} onClick={() => { setSelectedId(r.id); setMobileDetail(true) }}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${active
                  ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-900/20 dark:border-blue-600'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-mono font-semibold text-gray-900 dark:text-white text-sm">
                    <i className={`w-2 h-2 rounded-full ${st.dot}`} />{r.vehicle.registrationNumber}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{formatCurrency(total(r))}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {r.items.map(i => i.sparePart.name).join(', ') || 'Faqat ish haqi'}
                </p>
                <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-400">
                  <span className="truncate">{r.performedBy.fullName} · {formatDate(r.installationDate)}</span>
                  {flagCount > 0 && <span className={`px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${st.chip}`}>{flagCount} ogohlantirish</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Tanlangan ariza — hammasi bir oynada */}
        {selected && review && (
          <div className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden ${mobileDetail ? '' : 'hidden lg:block'}`}>
            <div className="p-5 border-b border-gray-100 dark:border-gray-700">
              <button onClick={() => setMobileDetail(false)} className="lg:hidden flex items-center gap-1 text-sm text-blue-600 mb-3"><ArrowLeft className="w-4 h-4" /> Ro'yxat</button>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0"><Truck className="w-5 h-5 text-blue-600 dark:text-blue-400" /></div>
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-lg text-gray-900 dark:text-white">{selected.vehicle.registrationNumber}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{selected.vehicle.brand} {selected.vehicle.model}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{formatCurrency(total(selected))}</p>
                  <p className="text-xs text-gray-400">{selected.performedBy.fullName} · {dateTime(selected.installationDate)}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Xulosa */}
              <div className={`rounded-xl border p-4 ${risk.banner}`}>
                <p className={`text-sm font-semibold flex items-center gap-2 ${risk.icon}`}>
                  {review.risk === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : review.risk === 'check' ? <AlertTriangle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {review.risk === 'ok' ? "Shubhali narsa topilmadi" : review.risk === 'check' ? "Tekshirib ko'ring" : "Diqqat: tasdiqlashdan oldin tekshiring"}
                </p>
                {review.flags.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {review.flags.map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-800 dark:text-gray-200"><FlagIcon level={f.level} /><span>{f.text}</span></li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Qismlar */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Ehtiyot qismlar</p>
                <div className="space-y-2">
                  {selected.items.map(it => {
                    const c = review.items.find(x => x.itemId === it.id)
                    const last = c?.last
                    const lastCls = !last ? 'text-gray-400'
                      : last.daysAgo <= 30 ? 'text-red-600 dark:text-red-400 font-semibold'
                      : last.daysAgo <= 90 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-700 dark:text-gray-300'
                    return (
                      <div key={it.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] gap-3 items-start">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">{it.sparePart.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{it.quantityUsed} ta × {formatCurrency(Number(it.unitCost))} = <b className="text-gray-800 dark:text-gray-200">{formatCurrency(Number(it.unitCost) * it.quantityUsed)}</b></p>
                          {it.warehouse && <p className="text-[11px] text-gray-400 mt-0.5">Sklad: {it.warehouse.name}</p>}
                        </div>
                        <div className="text-sm">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Shu mashinaga oxirgi marta</p>
                          {last ? (
                            <p className={lastCls}>
                              {formatDate(last.date)} · {daysLabel(last.daysAgo)}
                              {last.kmAgo != null && <span className="font-normal text-gray-500"> · {km(last.kmAgo)} oldin</span>}
                              {last.worker && <span className="font-normal text-gray-500"> · {last.worker}</span>}
                              <span className="block text-xs font-normal text-gray-500">{last.quantity} ta · {formatCurrency(last.unitCost)}</span>
                            </p>
                          ) : <p className="text-gray-400">Bu qism bu mashinaga birinchi marta</p>}
                          {c?.typicalGapDays && <p className="text-[11px] text-gray-400 mt-0.5">Odatda har ~{c.typicalGapDays} kunda almashadi</p>}
                        </div>
                        <div className="flex md:flex-col gap-1.5 md:items-end">
                          {c?.priceDiffPct != null && c.priceDiffPct >= 30 && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${c.priceDiffPct >= 60 ? RISK_STYLE.suspicious.chip : RISK_STYLE.check.chip}`}>narx +{c.priceDiffPct}%</span>
                          )}
                          {c?.refPrice != null && <span className="text-[11px] text-gray-400">kirim: {formatCurrency(c.refPrice)}</span>}
                          {c?.stock != null && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${c.stock < it.quantityUsed ? RISK_STYLE.suspicious.chip : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>omborda {c.stock} ta</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {selected.items.length === 0 && <p className="text-sm text-gray-400">Qism kiritilmagan</p>}
                  {Number(selected.laborCost) > 0 && (
                    <div className="flex justify-between text-sm text-gray-700 dark:text-gray-300 px-1">
                      <span>Usta haqi{selected.workerName ? ` (${selected.workerName})` : ''}</span>
                      <span className="tabular-nums">{formatCurrency(Number(selected.laborCost))}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Mashina tarixi */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Mashina holati</p>
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-2"><p className="text-[11px] text-gray-400">Hozirgi km</p><p className="text-sm font-semibold text-gray-900 dark:text-white">{km(review.vehicle.mileage)}</p></div>
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-2"><p className="text-[11px] text-gray-400">90 kunda ta'mir</p><p className="text-sm font-semibold text-gray-900 dark:text-white">{review.vehicle.count90} marta</p></div>
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-2"><p className="text-[11px] text-gray-400">Oxirgi ta'mir</p><p className="text-sm font-semibold text-gray-900 dark:text-white">{review.vehicle.lastMaintenanceAt ? formatDate(review.vehicle.lastMaintenanceAt) : '—'}</p></div>
                </div>
                {review.vehicle.recent.length > 0 && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                    {review.vehicle.recent.map(x => (
                      <div key={x.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                        <span className="text-xs text-gray-400 w-20 flex-shrink-0">{formatDate(x.date)}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{x.parts.join(', ') || 'Faqat ish haqi'}</span>
                        <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">{formatCurrency(x.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Izoh</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{selected.notes}</p>
                </div>
              )}

              {/* Dalil */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Dalil (foto / video)</p>
                {noEvidence ? (
                  <p className="text-sm text-red-500 italic">Dalil yuklanmagan</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {selected.evidence.map(ev => {
                      const url = getFileUrl(ev.fileUrl)
                      return isVideoUrl(ev.fileUrl) ? (
                        <video key={ev.id} src={url} controls preload="metadata" className="w-56 h-40 rounded-lg border border-gray-200 dark:border-gray-600 bg-black object-cover" />
                      ) : (
                        <button key={ev.id} type="button" onClick={() => setLightbox(url)} className="cursor-zoom-in" title="Kattalashtirish">
                          <img src={url} alt="dalil" className="w-40 h-40 object-cover rounded-lg border border-gray-200 dark:border-gray-600 hover:opacity-85 transition-opacity" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Harakatlar */}
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30">
              {rejecting ? (
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">Rad etish sababi</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {REJECT_PRESETS.map(p => (
                      <button key={p} onClick={() => setReason(p)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${reason === p
                          ? 'bg-red-600 border-red-600 text-white' : 'border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20'}`}>{p}</button>
                    ))}
                  </div>
                  <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Sabab (xodimga ko'rinadi)…"
                    className="w-full text-sm rounded-lg border border-red-200 dark:border-red-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-700 dark:text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
                  <div className="flex gap-2 justify-end mt-2">
                    <button onClick={() => setRejecting(false)} className="px-3 h-9 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">Bekor</button>
                    <button onClick={() => reject.mutate({ id: selected.id, reason })} disabled={busy}
                      className="px-4 h-9 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex items-center gap-1.5">
                      {reject.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Rad etish
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">
                    {stockBlocked ? "Omborda yetarli qism yo'q — avval omborni to'ldiring yoki arizani rad eting."
                      : confirmRisky ? "Qizil ogohlantirishlar bor. Baribir tasdiqlaysizmi?"
                      : "Tasdiqlansa ehtiyot qism ombordan chiqariladi va xarajatga yoziladi."}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setRejecting(true)} disabled={busy}
                      className="px-4 h-10 text-sm rounded-lg border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">Rad etish</button>
                    <button onClick={onApprove} disabled={busy || stockBlocked}
                      className={`px-5 h-10 text-sm rounded-lg text-white font-medium disabled:opacity-50 flex items-center gap-1.5 ${confirmRisky ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                      {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {confirmRisky ? 'Ha, baribir tasdiqlash' : 'Tasdiqlash'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4" onClick={() => setLightbox(null)}>
          <button type="button" onClick={e => { e.stopPropagation(); setLightbox(null) }} className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full" title="Yopish (Esc)"><X className="w-6 h-6" /></button>
          <img src={lightbox} alt="dalil" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
