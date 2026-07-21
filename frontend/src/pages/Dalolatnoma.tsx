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
interface ActPart { name: string; quantity: number; total: number }
interface ActData {
  branch: Branch; month: string
  parts: ActPart[]; grandTotal: number
  partTypeCount: number; vehicleCount: number; recordCount: number
}

function fmtSom(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
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

  // Birinchi filialni avtomatik tanlash
  const effectiveBranchId = branchId || (branches && branches[0]?.id) || ''

  const { data: act, isLoading, isError } = useQuery<ActData>({
    queryKey: ['dalolatnoma', effectiveBranchId, ym],
    queryFn: () => api.get('/reports/dalolatnoma', { params: { branchId: effectiveBranchId, month: ym } }).then(r => r.data.data),
    enabled: !!effectiveBranchId,
  })

  const branch = act?.branch
  const [my, mm] = ym.split('-').map(Number)
  const monthLabel = `${UZ_MONTHS[(mm || 1) - 1]} ${my}`

  function handlePrint() {
    const el = document.getElementById('dalolatnoma-print')
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('Chop etish oynasi ochilmadi (popup bloklangan?)'); return }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dalolatnoma — ${monthLabel}</title>
    <style>
      @page { size: A4; margin: 18mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; margin: 0; line-height: 1.4; }
      .dh { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
      .dh .org { font-size: 12pt; font-weight: bold; }
      .dh .sub { font-size: 9pt; color: #555; }
      .dh h1 { font-size: 20pt; font-weight: bold; letter-spacing: 5px; margin: 8px 0 2px; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11pt; }
      .reqs { font-size: 10.5pt; margin-bottom: 12px; }
      .reqs div { padding: 2px 0; border-bottom: 1px dotted #bbb; }
      .reqs .lbl { color: #555; display: inline-block; width: 150px; }
      table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11pt; }
      th { background: #e8e8e8; padding: 6px 8px; border: 1px solid #000; text-align: left; }
      td { padding: 6px 8px; border: 1px solid #000; }
      .num { text-align: right; }
      .ctr { text-align: center; }
      .total-row td { font-weight: bold; background: #f0f0f0; }
      .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; font-size: 11pt; }
      .sig .role { font-weight: bold; margin-bottom: 34px; }
      .sig .line { border-bottom: 1px solid #000; margin-bottom: 3px; }
      .sig .nm { font-size: 10pt; color: #555; font-style: italic; }
      .foot { margin-top: 24px; padding-top: 6px; border-top: 1px solid #ccc; text-align: right; font-size: 9pt; color: #666; }
      button { display: none !important; }
    </style></head><body>${el.innerHTML}</body></html>`)
    win.document.close(); win.focus()
    setTimeout(() => win.print(), 400)
  }

  const missingReqs = branch && !branch.directorName && !branch.engineerName && !branch.officialName

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" /> Oylik dalolatnoma (ehtiyot qismlar)
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Tashkilot (filial) va oyni tanlang — o'sha oyda ishlatilgan ehtiyot qismlari dalolatnomasi tayyorlanadi</p>
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
        <div className="flex-1" />
        <button onClick={handlePrint} disabled={!act || act.parts.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
          <Printer className="w-4 h-4" /> Chop etish
        </button>
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

      {/* Hujjat ko'rinishi */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-indigo-600 animate-spin" /></div>
      ) : isError ? (
        <div className="bg-white rounded-xl p-8 text-center text-red-500 shadow-sm border border-gray-100">Ma'lumot yuklanmadi</div>
      ) : act && act.parts.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{monthLabel} oyida bu tashkilotda ishlatilgan ehtiyot qism topilmadi</p>
        </div>
      ) : act && branch ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 overflow-x-auto">
          <div id="dalolatnoma-print">
            {/* Sarlavha */}
            <div className="dh text-center border-b-2 border-gray-900 pb-2 mb-3">
              <div className="org text-base font-bold">{branch.officialName || branch.name}</div>
              {branch.stir && <div className="sub text-xs text-gray-500">STIR: {branch.stir}</div>}
              {branch.docAddress && <div className="sub text-xs text-gray-500">{branch.docAddress}</div>}
              <h1 className="text-2xl font-bold tracking-[5px] text-gray-900 mt-3">DALOLATNOMA</h1>
              <div className="sub text-xs text-gray-500">Ehtiyot qismlar sarfi (oylik) — {monthLabel}</div>
            </div>

            {/* Meta */}
            <div className="meta flex justify-between text-sm mb-3">
              <div><span className="text-gray-500">Davr: </span><b>{monthLabel}</b></div>
              <div><span className="text-gray-500">Tuzilgan sana: </span><b>{new Date().toLocaleDateString('uz-UZ')}</b></div>
            </div>

            <p className="text-sm mb-3">
              Quyidagi dalolatnoma <b>{branch.officialName || branch.name}</b> tashkilotida {monthLabel} oyi davomida
              avtoparkka ({act.vehicleCount} ta texnika) o'rnatilgan ehtiyot qismlari bo'yicha tuzildi:
            </p>

            {/* Jadval */}
            <table className="w-full text-sm border-collapse border-2 border-gray-900">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-900 px-2 py-1.5 text-left w-10">№</th>
                  <th className="border border-gray-900 px-2 py-1.5 text-left">Ehtiyot qism nomi</th>
                  <th className="border border-gray-900 px-2 py-1.5 text-center w-24">Miqdori</th>
                  <th className="border border-gray-900 px-2 py-1.5 text-right w-40">Summasi (so'm)</th>
                </tr>
              </thead>
              <tbody>
                {act.parts.map((p, i) => (
                  <tr key={i}>
                    <td className="border border-gray-900 px-2 py-1.5 ctr text-center">{i + 1}</td>
                    <td className="border border-gray-900 px-2 py-1.5">{p.name}</td>
                    <td className="border border-gray-900 px-2 py-1.5 ctr text-center">{p.quantity} ta</td>
                    <td className="border border-gray-900 px-2 py-1.5 num text-right">{fmtSom(p.total)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td className="border border-gray-900 px-2 py-2 font-bold" colSpan={2}>JAMI ({act.partTypeCount} xil):</td>
                  <td className="border border-gray-900 px-2 py-2 ctr text-center font-bold">
                    {act.parts.reduce((s, p) => s + p.quantity, 0)} ta
                  </td>
                  <td className="border border-gray-900 px-2 py-2 num text-right font-bold">{fmtSom(act.grandTotal)}</td>
                </tr>
              </tbody>
            </table>

            {/* Imzolar */}
            <div className="sigs grid grid-cols-2 gap-10 mt-10 text-sm">
              <div className="sig">
                <p className="role font-bold mb-8">Rahbar:</p>
                <div className="line border-b border-gray-900 mb-1" />
                <p className="nm text-xs text-gray-600 italic">{branch.directorName || '________________________'}</p>
                <p className="text-xs text-gray-500 mt-2">Imzo: ___________ M.O.</p>
              </div>
              <div className="sig">
                <p className="role font-bold mb-8">Injener:</p>
                <div className="line border-b border-gray-900 mb-1" />
                <p className="nm text-xs text-gray-600 italic">{branch.engineerName || '________________________'}</p>
                <p className="text-xs text-gray-500 mt-2">Imzo: ___________</p>
              </div>
            </div>

            <div className="foot mt-6 pt-2 border-t border-gray-300 text-right text-xs text-gray-500">
              AvtoHisob tizimi tomonidan elektron tayyorlandi · {new Date().toLocaleDateString('uz-UZ')}
            </div>
          </div>
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
