import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Printer, Loader2, Pencil, Check, X, Building2, Printer as PrinterIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../lib/api'
import { uzNumberToWords } from '../lib/utils'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

interface Branch {
  id: string; name: string
  officialName?: string | null; stir?: string | null; docAddress?: string | null
  directorName?: string | null; engineerName?: string | null
  receiverOrgName?: string | null; receiverName?: string | null; receiverPosition?: string | null
}
interface ActPart { name: string; quantity: number; total: number }
interface ActVehicle {
  vehicleId: string; registrationNumber: string; brand: string; model: string
  parts: ActPart[]; partTypeCount: number; eventCount: number; partsTotal: number
}
interface ActData {
  branch: Branch; month: string
  vehicles: ActVehicle[]; vehicleCount: number; grandTotal: number
}

function fmtSom(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')
}
function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// An'anaviy o'zbek dalolatnomasi preambulasi — imzo chekuvchilarni sanaydi.
// veh allaqachon HTML-escape qilingan (buildVehicleDoc'da), qayta escape qilinmaydi.
function buildPreamble(b: Branch, vehEscaped: string, monthLabel: string): string {
  const org = esc(b.officialName || b.name)
  const director = esc(b.directorName || '__________')
  const engineer = esc(b.engineerName || '__________')
  const topSide = `${org} rahbari ${director} va injeneri ${engineer} (topshiruvchi tomon)`
  const recvOrg = esc(b.receiverOrgName || 'boshqarma')
  const recvPos = b.receiverPosition ? `${esc(b.receiverPosition)} ` : ''
  const recvName = esc(b.receiverName || '__________')
  const recvSide = `${recvOrg} ${recvPos}${recvName} (qabul qiluvchi tomon)`
  return `Biz, quyida imzo chekuvchilar: ${topSide}, hamda ${recvSide}, ushbu dalolatnomani ${esc(monthLabel)} oyi davomida ${vehEscaped} avtomashinasiga quyidagi ehtiyot qismlar berilganligi to'g'risida tuzdik:`
}

export default function Dalolatnoma() {
  const qc = useQueryClient()
  const now = new Date()
  const [branchId, setBranchId] = useState('')
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [editReq, setEditReq] = useState(false)
  // Buxgalteriya rejimi — faqat rasmiy (isOfficial) yozuvlar
  const [official, setOfficial] = useState(false)

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const effectiveBranchId = branchId || (branches && branches[0]?.id) || ''

  const { data: act, isLoading, isError } = useQuery<ActData>({
    queryKey: ['dalolatnoma', effectiveBranchId, ym, official],
    queryFn: () => api.get('/reports/dalolatnoma', { params: { branchId: effectiveBranchId, month: ym, official: official ? 1 : undefined } }).then(r => r.data.data),
    enabled: !!effectiveBranchId,
  })

  const branch = act?.branch
  const [my, mm] = ym.split('-').map(Number)
  const monthLabel = `${UZ_MONTHS[(mm || 1) - 1]} ${my}`

  // Bitta mashina uchun hujjat tanasi (bir sahifa) — printVehicle va printAll ishlatadi.
  function buildVehicleDoc(v: ActVehicle, b: Branch, pageBreak: boolean): string {
    const docNo = `DL-${v.registrationNumber.replace(/\s/g, '')}-${ym}`
    const veh = `${esc(v.registrationNumber)} — ${esc(v.brand)} ${esc(v.model)}`
    const rows = v.parts.map((p, i) => `
      <tr>
        <td class="ctr">${i + 1}</td>
        <td>${esc(p.name)}</td>
        <td class="ctr">${p.quantity} ta</td>
        <td class="num">${fmtSom(p.total)}</td>
      </tr>`).join('')
    const totalQty = v.parts.reduce((s, p) => s + p.quantity, 0)
    return `
      <div class="page"${pageBreak ? ' style="page-break-before: always"' : ''}>
        <div class="dh">
          <div class="org">${esc(b.officialName || b.name)}</div>
          ${b.stir ? `<div class="sub">STIR: ${esc(b.stir)}</div>` : ''}
          ${b.docAddress ? `<div class="sub">${esc(b.docAddress)}</div>` : ''}
          <h1>DALOLATNOMA</h1>
          <div class="sub">Ehtiyot qism sarfi (oylik)${official ? ' — buxgalteriya uchun' : ''} · ${esc(docNo)}</div>
        </div>
        <div class="meta">
          <div><span style="color:#555">Davr: </span><b>${esc(monthLabel)}</b></div>
          <div><span style="color:#555">Tuzilgan sana: </span><b>${new Date().toLocaleDateString('uz-UZ')}</b></div>
        </div>
        <div class="info">
          <div><span class="lbl">Avtomashina:</span> <b>${veh}</b></div>
          <div><span class="lbl">Berishlar soni:</span> <b>${v.eventCount} marta</b></div>
        </div>
        <p class="preamble">${buildPreamble(b, veh, monthLabel)}</p>
        <table>
          <thead><tr>
            <th style="width:8%">№</th><th>Ehtiyot qism nomi</th>
            <th style="width:16%" class="ctr">Miqdori</th>
            <th style="width:26%" class="num">Summasi (so'm)</th>
          </tr></thead>
          <tbody>
            ${rows}
            <tr class="total-row"><td colspan="2">JAMI (${v.partTypeCount} xil):</td><td class="ctr">${totalQty} ta</td><td class="num">${fmtSom(v.partsTotal)}</td></tr>
          </tbody>
        </table>
        <div class="words"><b>Summa so'z bilan:</b> ${esc(uzNumberToWords(Math.round(v.partsTotal)))} so'm</div>
        <div class="sigs">
          <div class="sig">
            <div class="side">TOPSHIRDI${b.officialName ? ` — ${esc(b.officialName)}` : ''}:</div>
            <div class="row"><span class="pos">Rahbar:</span> <span class="line2"></span></div>
            <div class="nm">${esc(b.directorName || '(F.I.O.)')}</div>
            <div class="row" style="margin-top:18px"><span class="pos">Injener:</span> <span class="line2"></span></div>
            <div class="nm">${esc(b.engineerName || '(F.I.O.)')}</div>
            <div style="font-size:9pt;color:#666;margin-top:8px">M.O. ___________</div>
          </div>
          <div class="sig">
            <div class="side">QABUL QILDI${b.receiverOrgName ? ` — ${esc(b.receiverOrgName)}` : ' (boshqarma)'}:</div>
            <div class="row"><span class="pos">${esc(b.receiverPosition || 'Lavozimi')}:</span> <span class="line2"></span></div>
            <div class="nm">${esc(b.receiverName || '(F.I.O.)')}</div>
            <div style="font-size:9pt;color:#666;margin-top:8px">Imzo: ___________ Sana: ___________</div>
          </div>
        </div>
        <div class="foot">AvtoHisob tizimi · ${new Date().toLocaleDateString('uz-UZ')}</div>
      </div>`
  }

  const DOC_CSS = `
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
    .preamble { text-align: justify; margin: 10px 0; font-size: 11pt; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11pt; }
    th { background: #e8e8e8; padding: 6px 8px; border: 1px solid #000; text-align: left; }
    td { padding: 6px 8px; border: 1px solid #000; }
    .num { text-align: right; }
    .ctr { text-align: center; }
    .total-row td { font-weight: bold; background: #f0f0f0; }
    .words { margin: 8px 0; padding: 6px 8px; border: 1px solid #000; font-size: 10.5pt; font-style: italic; }
    .words b { font-style: normal; }
    .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; font-size: 11pt; }
    .sig .side { font-weight: bold; margin-bottom: 18px; text-transform: uppercase; font-size: 10.5pt; letter-spacing: 0.5px; }
    .sig .row { display: flex; align-items: flex-end; gap: 6px; }
    .sig .pos { color: #333; white-space: nowrap; }
    .sig .line2 { flex: 1; border-bottom: 1px solid #000; height: 14px; }
    .sig .nm { font-size: 9.5pt; color: #555; font-style: italic; margin-top: 2px; text-align: right; }
    .foot { margin-top: 24px; padding-top: 6px; border-top: 1px solid #ccc; text-align: right; font-size: 9pt; color: #666; }`

  function openPrint(title: string, bodyHtml: string) {
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('Chop etish oynasi ochilmadi (popup bloklangan?)'); return }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style></head><body>${bodyHtml}</body></html>`)
    win.document.close(); win.focus()
    setTimeout(() => win.print(), 400)
  }

  // Bitta mashinaning OYLIK dalolatnomasi
  function printVehicle(v: ActVehicle) {
    if (!branch) return
    openPrint(`DL-${v.registrationNumber}-${ym}`, buildVehicleDoc(v, branch, false))
  }

  // HAMMASINI bitta hujjatga — har mashina yangi sahifada (qog'ozbozlikni kamaytiradi)
  function printAll() {
    if (!branch || !act || act.vehicles.length === 0) return
    const body = act.vehicles.map((v, i) => buildVehicleDoc(v, branch, i > 0)).join('')
    openPrint(`Dalolatnoma — ${monthLabel} (${act.vehicles.length} ta)`, body)
  }

  const missingReqs = branch && !branch.directorName && !branch.engineerName && !branch.officialName

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" /> Oylik dalolatnoma (mashina bo'yicha)
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Har mashina uchun shu oyda olgan barcha ehtiyot qismlari bitta dalolatnomaga jamlanadi</p>
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
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ko'rinish</label>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setOfficial(false)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${!official ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Barchasi
            </button>
            <button onClick={() => setOfficial(true)} title="Faqat rasmiy (buxgalteriya) yozuvlar"
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${official ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Buxgalteriya
            </button>
          </div>
        </div>
        <div className="flex-1" />
        <button onClick={printAll} disabled={!act || act.vehicles.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
          <PrinterIcon className="w-4 h-4" /> Hammasini chop etish{act && act.vehicles.length > 0 ? ` (${act.vehicles.length})` : ''}
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

      {/* Hodisalar ro'yxati */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-indigo-600 animate-spin" /></div>
      ) : isError ? (
        <div className="bg-white rounded-xl p-8 text-center text-red-500 shadow-sm border border-gray-100">Ma'lumot yuklanmadi</div>
      ) : act && act.vehicles.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{monthLabel} oyida bu tashkilotda ehtiyot qism berish yozuvi topilmadi</p>
        </div>
      ) : act ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-sm text-gray-600">{monthLabel} · <b>{act.vehicleCount}</b> ta mashina · jami {fmtSom(act.grandTotal)} so'm</p>
          </div>
          {act.vehicles.map(v => (
            <div key={v.vehicleId} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 font-mono">{v.registrationNumber}</span>
                  <span className="text-xs text-gray-400">{v.brand} {v.model}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{v.eventCount} marta olgan</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {v.partTypeCount} xil qism · {v.parts.map(p => p.name).join(', ') || 'qism yo\'q'} · <b>{fmtSom(v.partsTotal)}</b> so'm
                </p>
              </div>
              <button onClick={() => printVehicle(v)} disabled={v.parts.length === 0}
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
    receiverOrgName: branch.receiverOrgName || '',
    receiverName: branch.receiverName || '',
    receiverPosition: branch.receiverPosition || '',
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
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Topshiruvchi (filial)</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('officialName', 'Rasmiy nomi', 'MChJ "..." / tashkilot to\'liq nomi')}
        {field('stir', 'STIR (INN)', '123456789')}
        {field('directorName', 'Rahbar (F.I.O.)', 'Familiya Ism Otasining ismi')}
        {field('engineerName', 'Injener (F.I.O.)', 'Familiya Ism Otasining ismi')}
      </div>
      {field('docAddress', 'Yuridik manzil', 'Viloyat, tuman, ko\'cha')}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Qabul qiluvchi (boshqarma)</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('receiverOrgName', 'Boshqarma nomi', 'Qabul qiluvchi tashkilot')}
        {field('receiverPosition', 'Lavozimi', 'Masalan: Bosh injener')}
        {field('receiverName', 'Qabul qiluvchi (F.I.O.)', 'Familiya Ism Otasining ismi')}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Saqlash
        </button>
      </div>
    </div>
  )
}
