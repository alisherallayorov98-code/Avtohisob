import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Printer, Loader2, Pencil, Check, X, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../lib/api'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

interface Branch {
  id: string; name: string
  officialName?: string | null; stir?: string | null; docAddress?: string | null
  directorName?: string | null; engineerName?: string | null
}
interface ActItem { name: string; quantity: number; unitCost: number; total: number }
interface ActRecord {
  id: string; docNo: string; date: string
  vehicle: { registrationNumber: string; brand: string; model: string } | null
  worker: string | null; notes: string | null
  items: ActItem[]; partsTotal: number; laborCost: number; total: number
}
interface ActData {
  branch: Branch; month: string
  records: ActRecord[]; recordCount: number; grandTotal: number
}

function fmtSom(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function Dalolatnoma() {
  const qc = useQueryClient()
  const now = new Date()
  const [branchId, setBranchId] = useState('')
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [editReq, setEditReq] = useState(false)

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const effectiveBranchId = branchId || (branches && branches[0]?.id) || ''

  const { data: act, isLoading, isError } = useQuery<ActData>({
    queryKey: ['dalolatnoma', effectiveBranchId, ym],
    queryFn: () => api.get('/reports/dalolatnoma', { params: { branchId: effectiveBranchId, month: ym } }).then(r => r.data.data),
    enabled: !!effectiveBranchId,
  })

  const branch = act?.branch
  const [my, mm] = ym.split('-').map(Number)
  const monthLabel = `${UZ_MONTHS[(mm || 1) - 1]} ${my}`

  // Bitta hodisa (partiya) uchun alohida dalolatnoma chop etadi.
  function printRecord(rec: ActRecord) {
    if (!branch) return
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('Chop etish oynasi ochilmadi (popup bloklangan?)'); return }
    const veh = rec.vehicle
      ? `${esc(rec.vehicle.registrationNumber)} — ${esc(rec.vehicle.brand)} ${esc(rec.vehicle.model)}`
      : '—'
    const rows = rec.items.map((it, i) => `
      <tr>
        <td class="ctr">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td class="ctr">${it.quantity} ta</td>
        <td class="num">${fmtSom(it.unitCost)}</td>
        <td class="num">${fmtSom(it.total)}</td>
      </tr>`).join('')
    const laborRow = rec.laborCost > 0
      ? `<tr><td colspan="4">Usta haqi:</td><td class="num">${fmtSom(rec.laborCost)}</td></tr>` : ''
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(rec.docNo)}</title>
    <style>
      @page { size: A4; margin: 18mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; margin: 0; line-height: 1.4; }
      .dh { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
      .dh .org { font-size: 13pt; font-weight: bold; }
      .dh .sub { font-size: 9pt; color: #555; }
      .dh h1 { font-size: 20pt; font-weight: bold; letter-spacing: 5px; margin: 8px 0 2px; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11pt; }
      .info { font-size: 11pt; margin-bottom: 10px; }
      .info div { padding: 3px 0; border-bottom: 1px dotted #bbb; }
      .info .lbl { color: #555; display: inline-block; width: 150px; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11pt; }
      th { background: #e8e8e8; padding: 6px 8px; border: 1px solid #000; text-align: left; }
      td { padding: 6px 8px; border: 1px solid #000; }
      .num { text-align: right; }
      .ctr { text-align: center; }
      .total-row td { font-weight: bold; background: #f0f0f0; }
      .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 44px; font-size: 11pt; }
      .sig .role { font-weight: bold; margin-bottom: 34px; }
      .sig .line { border-bottom: 1px solid #000; margin-bottom: 3px; }
      .sig .nm { font-size: 10pt; color: #555; font-style: italic; }
      .foot { margin-top: 24px; padding-top: 6px; border-top: 1px solid #ccc; text-align: right; font-size: 9pt; color: #666; }
    </style></head><body>
      <div class="dh">
        <div class="org">${esc(branch.officialName || branch.name)}</div>
        ${branch.stir ? `<div class="sub">STIR: ${esc(branch.stir)}</div>` : ''}
        ${branch.docAddress ? `<div class="sub">${esc(branch.docAddress)}</div>` : ''}
        <h1>DALOLATNOMA</h1>
        <div class="sub">Ehtiyot qism berish to'g'risida · ${esc(rec.docNo)}</div>
      </div>
      <div class="meta">
        <div><span style="color:#555">Sana: </span><b>${fmtDate(rec.date)}</b></div>
        <div><span style="color:#555">Hujjat: </span><b>${esc(rec.docNo)}</b></div>
      </div>
      <div class="info">
        <div><span class="lbl">Avtomashina:</span> <b>${veh}</b></div>
        ${rec.worker ? `<div><span class="lbl">Berildi / bajardi:</span> <b>${esc(rec.worker)}</b></div>` : ''}
      </div>
      <p>Quyidagi ehtiyot qismlar yuqoridagi avtomashinaga berildi:</p>
      <table>
        <thead><tr>
          <th style="width:8%">№</th><th>Ehtiyot qism nomi</th>
          <th style="width:14%" class="ctr">Miqdori</th>
          <th style="width:20%" class="num">Narxi (so'm)</th>
          <th style="width:22%" class="num">Summasi (so'm)</th>
        </tr></thead>
        <tbody>
          ${rows}
          ${laborRow}
          <tr class="total-row"><td colspan="4">JAMI:</td><td class="num">${fmtSom(rec.total)}</td></tr>
        </tbody>
      </table>
      ${rec.notes ? `<p style="font-size:10.5pt"><b>Izoh:</b> ${esc(rec.notes)}</p>` : ''}
      <div class="sigs">
        <div class="sig">
          <div class="role">Rahbar:</div>
          <div class="line"></div>
          <div class="nm">${esc(branch.directorName || '________________________')}</div>
          <div style="font-size:9pt;color:#666;margin-top:6px">Imzo: ___________ M.O.</div>
        </div>
        <div class="sig">
          <div class="role">Injener:</div>
          <div class="line"></div>
          <div class="nm">${esc(branch.engineerName || '________________________')}</div>
          <div style="font-size:9pt;color:#666;margin-top:6px">Imzo: ___________</div>
        </div>
      </div>
      <div class="foot">AvtoHisob tizimi · ${new Date().toLocaleDateString('uz-UZ')}</div>
    </body></html>`
    win.document.write(html)
    win.document.close(); win.focus()
    setTimeout(() => win.print(), 400)
  }

  const missingReqs = branch && !branch.directorName && !branch.engineerName && !branch.officialName

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" /> Dalolatnoma (ehtiyot qism berish)
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Har bir berish (mashina + sana + o'sha partiyadagi qismlar) alohida dalolatnoma bo'lib chop etiladi</p>
      </div>

      {/* Tanlovlar */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tashkilot / tuman (filial)</label>
          <select value={effectiveBranchId} onChange={e => setBranchId(e.target.value)}
            className="text-sm px-3 py-2 border border-gray-300 rounded-lg min-w-[220px] focus:outline-none focus:ring-2 focus:ring-indigo-400">
            {(branches || []).map(b => <option key={b.id} value={b.id}>{b.officialName || b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Oy</label>
          <input type="month" value={ym} onChange={e => setYm(e.target.value)}
            className="text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
      </div>

      {/* Rekvizit tahrirlash */}
      {branch && (
        <RequisitesPanel
          key={branch.id}
          branch={branch}
          open={editReq || !!missingReqs}
          forceOpen={!!missingReqs}
          onToggle={() => setEditReq(v => !v)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['branches-list'] }); qc.invalidateQueries({ queryKey: ['dalolatnoma'] }); setEditReq(false) }}
        />
      )}

      {/* Hodisalar ro'yxati */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-indigo-600 animate-spin" /></div>
      ) : isError ? (
        <div className="bg-white rounded-xl p-8 text-center text-red-500 shadow-sm border border-gray-100">Ma'lumot yuklanmadi</div>
      ) : act && act.records.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{monthLabel} oyida bu tashkilotda ehtiyot qism berish yozuvi topilmadi</p>
        </div>
      ) : act ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-sm text-gray-600">{monthLabel} · <b>{act.recordCount}</b> ta dalolatnoma · jami {fmtSom(act.grandTotal)} so'm</p>
          </div>
          {act.records.map(rec => (
            <div key={rec.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 font-mono">{rec.vehicle?.registrationNumber || '—'}</span>
                  <span className="text-xs text-gray-400">{rec.vehicle?.brand} {rec.vehicle?.model}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{fmtDate(rec.date)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {rec.items.length} xil qism · {rec.items.map(i => i.name).join(', ') || 'qism yo\'q'} · <b>{fmtSom(rec.total)}</b> so'm
                </p>
              </div>
              <button onClick={() => printRecord(rec)} disabled={rec.items.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                <Printer className="w-4 h-4" /> Dalolatnoma
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── Rekvizit tahrirlash paneli ──
function RequisitesPanel({ branch, open, forceOpen, onToggle, onSaved }: {
  branch: Branch; open: boolean; forceOpen: boolean; onToggle: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    officialName: branch.officialName || '',
    stir: branch.stir || '',
    docAddress: branch.docAddress || '',
    directorName: branch.directorName || '',
    engineerName: branch.engineerName || '',
  })

  const save = useMutation({
    mutationFn: () => api.put(`/branches/${branch.id}`, form).then(r => r.data),
    onSuccess: () => { toast.success('Rekvizitlar saqlandi'); onSaved() },
    onError: (e) => toast.error(apiErrorMessage(e, 'Saqlashda xato')),
  })

  if (!open) {
    return (
      <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Building2 className="w-4 h-4 text-gray-400" />
          <span>Rekvizitlar: <b>{branch.officialName || branch.name}</b>
            {branch.directorName && ` · Rahbar: ${branch.directorName}`}
            {branch.engineerName && ` · Injener: ${branch.engineerName}`}</span>
        </div>
        <button onClick={onToggle} className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800">
          <Pencil className="w-3.5 h-3.5" /> Tahrirlash
        </button>
      </div>
    )
  }

  const field = (key: keyof typeof form, label: string, ph: string) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph}
        className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
    </div>
  )

  return (
    <div className="bg-indigo-50/50 rounded-xl p-4 shadow-sm border border-indigo-100 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-indigo-900 flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Tashkilot rekvizitlari (faqat dalolatnomada ko'rinadi)
        </p>
        {!forceOpen && (
          <button onClick={onToggle} className="p-1 rounded hover:bg-indigo-100"><X className="w-4 h-4 text-gray-500" /></button>
        )}
      </div>
      {forceOpen && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Bu tashkilotning rekvizitlari to'ldirilmagan — dalolatnoma to'liq bo'lishi uchun rahbar va injener ismini kiriting.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('officialName', 'Rasmiy nomi', 'MChJ "..." / tashkilot to\'liq nomi')}
        {field('stir', 'STIR (INN)', '123456789')}
        {field('directorName', 'Rahbar (F.I.O.)', 'Familiya Ism Otasining ismi')}
        {field('engineerName', 'Injener (F.I.O.)', 'Familiya Ism Otasining ismi')}
      </div>
      {field('docAddress', 'Yuridik manzil', 'Viloyat, tuman, ko\'cha')}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Saqlash
        </button>
      </div>
    </div>
  )
}
