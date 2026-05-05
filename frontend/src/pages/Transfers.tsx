import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  Plus, ArrowRight, CheckCircle, Send, Package,
  Trash2, PlusCircle, AlertCircle, FileText,
  Printer, MessageSquare, Inbox
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate, formatCurrency, formatDateLong, uzNumberToWords } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TransferBatch {
  id: string
  documentNumber: string
  status: string
  notes?: string
  createdAt: string
  shippedAt?: string
  receivedAt?: string
  fromWarehouse: { id: string; name: string; location?: string }
  toWarehouse: { id: string; name: string; location?: string }
  shippedBy?: { fullName: string }
  receivedBy?: { fullName: string }
  createdBy?: { fullName: string }
  request?: { id: string; documentNumber: string }
  _count?: { transfers: number }
}

interface BatchDetail extends TransferBatch {
  transfers: {
    id: string
    quantity: number
    sparePart: { id: string; name: string; partCode: string; unitPrice: number }
  }[]
}

interface SparePartReq {
  id: string
  documentNumber: string
  status: string
  urgency: string
  notes?: string
  responseNotes?: string
  createdAt: string
  respondedAt?: string
  requestedBy: { fullName: string }
  respondedBy?: { fullName: string }
  _count?: { items: number }
}

interface ReqDetail extends SparePartReq {
  items: {
    id: string
    partName: string
    partCode?: string
    quantity: number
    reason?: string
    sparePart?: { name: string; partCode: string }
  }[]
  batches: { id: string; documentNumber: string; status: string; createdAt: string }[]
}

interface OldTransfer {
  id: string
  quantity: number
  status: string
  createdAt: string
  notes?: string
  batchId?: string | null
  fromWarehouse: { name: string }
  toWarehouse: { name: string }
  sparePart: { name: string; partCode: string }
  approvedBy?: { fullName: string }
}

interface ReqItem { partName: string; partCode: string; quantity: string; reason: string; sparePartId: string }
interface BulkItem { sparePartId: string; quantity: string }

// ── Status helpers ─────────────────────────────────────────────────────────────

const BATCH_COLOR: Record<string, any> = { pending: 'warning', shipped: 'info', received: 'success' }
const REQ_COLOR: Record<string, any> = { pending: 'warning', approved: 'info', rejected: 'danger', fulfilled: 'success' }
const URGENCY_COLOR: Record<string, any> = { low: 'default', medium: 'warning', high: 'danger' }

// ── Print helpers ─────────────────────────────────────────────────────────────

function printDocument(html: string) {
  const w = window.open('', '_blank', 'width=800,height=600')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 300)
}

function buildPrintHtml(batch: BatchDetail, qrUrl?: string): string {
  const total = batch.transfers.reduce((s, t) => s + t.quantity * Number(t.sparePart.unitPrice), 0)
  const totalQty = batch.transfers.reduce((s, t) => s + t.quantity, 0)
  const rows = batch.transfers.map((t, i) => `
    <tr>
      <td class="ctr">${i + 1}</td>
      <td>${t.sparePart.name}</td>
      <td><code style="font-family:'Courier New',monospace;font-size:10pt">${t.sparePart.partCode}</code></td>
      <td class="ctr">${t.quantity} ta</td>
      <td class="num">${formatCurrency(Number(t.sparePart.unitPrice))}</td>
      <td class="num bold">${formatCurrency(t.quantity * Number(t.sparePart.unitPrice))}</td>
    </tr>`).join('')

  return `<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8">
  <title>${batch.documentNumber}</title>
  <style>
    @page { size: A4; margin: 18mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; padding: 0; color: #000; line-height: 1.4; }
    .doc-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 14px; position: relative; }
    .doc-header .org { font-size: 10pt; color: #444; letter-spacing: 1px; text-transform: uppercase; }
    .doc-header h1 { font-size: 20pt; font-weight: bold; letter-spacing: 4px; margin: 4px 0 2px; text-transform: uppercase; }
    .doc-header .subtitle { font-size: 10pt; color: #666; }
    .qr-corner { position: absolute; top: 0; right: 0; text-align: center; }
    .qr-corner img { width: 70px; height: 70px; border: 1px solid #999; }
    .qr-corner p { font-size: 9pt; color: #888; margin-top: 2px; }
    .doc-meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11pt; }
    .doc-no { font-weight: bold; }
    .info-box { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; font-size: 11pt; }
    .info-row { border-bottom: 1px dotted #999; padding: 3px 0; }
    .info-row .label { color: #555; display: inline-block; width: 130px; }
    .info-row .value { font-weight: bold; }
    table.items { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11pt; }
    table.items th { background: #e8e8e8; padding: 6px 8px; text-align: left; border: 1px solid #000; font-weight: bold; }
    table.items td { padding: 5px 8px; border: 1px solid #000; vertical-align: top; }
    table.items .num { text-align: right; }
    table.items .ctr { text-align: center; }
    table.items .bold { font-weight: bold; }
    table.items tfoot td { font-weight: bold; background: #f0f0f0; }
    .totals-block { width: 60%; margin-left: auto; margin-bottom: 12px; }
    .totals-block table { width: 100%; border-collapse: collapse; }
    .totals-block td { padding: 4px 8px; border: 1px solid #000; font-size: 11pt; }
    .totals-block .total-row td { font-weight: bold; background: #f0f0f0; font-size: 12pt; }
    .totals-block .num { text-align: right; }
    .amount-words { margin: 10px 0; padding: 8px; border: 1px solid #000; font-size: 11pt; font-style: italic; }
    .amount-words b { font-style: normal; }
    .notes { margin: 10px 0; padding: 8px; border: 1px solid #ccc; font-size: 11pt; background: #fafafa; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 30px; padding-top: 12px; }
    .sig-block .sig-role { font-weight: bold; margin-bottom: 38px; font-size: 11pt; }
    .sig-block .sig-line { border-bottom: 1px solid #000; margin-bottom: 4px; height: 1px; }
    .sig-block .sig-name { font-size: 10pt; color: #555; font-style: italic; }
    .sig-block .sig-extra { font-size: 9pt; color: #666; margin-top: 6px; }
    .stamp-area { margin-top: 20px; padding: 16px; border: 1px dashed #888; text-align: center; color: #aaa; font-size: 10pt; width: 200px; }
    .doc-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 9pt; color: #666; }
    @media print { body { margin: 0; } }
  </style></head><body>

  <div class="doc-header">
    <p class="org">AvtoHisob — Avtopark boshqaruv tizimi</p>
    <h1>Tovar Jo'natma Hujjati</h1>
    <p class="subtitle">Ehtiyot qismlar ko'chirish dalolatnomasi</p>
    ${qrUrl ? `<div class="qr-corner"><img src="${qrUrl}" /><p>Tekshirish</p></div>` : ''}
  </div>

  <div class="doc-meta">
    <div><span style="color:#555">Hujjat raqami: </span><span class="doc-no">${batch.documentNumber}</span></div>
    <div><span style="color:#555">Sana: </span><b>${formatDateLong(batch.createdAt)}</b></div>
  </div>

  <div class="info-box">
    <div class="info-row"><span class="label">Qayerdan:</span><span class="value">${batch.fromWarehouse.name}</span></div>
    <div class="info-row"><span class="label">Qayerga:</span><span class="value">${batch.toWarehouse.name}</span></div>
    ${batch.fromWarehouse.location ? `<div class="info-row"><span class="label">Manzil (qayerdan):</span><span class="value">${batch.fromWarehouse.location}</span></div>` : ''}
    ${batch.toWarehouse.location ? `<div class="info-row"><span class="label">Manzil (qayerga):</span><span class="value">${batch.toWarehouse.location}</span></div>` : ''}
    <div class="info-row"><span class="label">Pozitsiyalar soni:</span><span class="value">${batch.transfers.length} ta</span></div>
    <div class="info-row"><span class="label">Jami miqdor:</span><span class="value">${totalQty} ta</span></div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:40px" class="ctr">№</th>
        <th>Qism nomi</th>
        <th style="width:120px">Kod</th>
        <th style="width:80px" class="ctr">Miqdor</th>
        <th style="width:120px" class="num">Narxi (so'm)</th>
        <th style="width:130px" class="num">Jami (so'm)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" class="ctr">Jami pozitsiyalar: ${batch.transfers.length}</td>
        <td class="ctr">${totalQty} ta</td>
        <td class="num">—</td>
        <td class="num">${formatCurrency(total)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="totals-block">
    <table>
      <tbody>
        <tr class="total-row">
          <td>JAMI summa:</td>
          <td class="num">${formatCurrency(total)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="amount-words">
    <b>Summa so'z bilan: </b>${uzNumberToWords(total)} so'm
  </div>

  ${batch.notes ? `<div class="notes"><b>Izoh: </b><span style="font-style:italic">${batch.notes}</span></div>` : ''}

  <div class="signatures">
    <div class="sig-block">
      <p class="sig-role">Topshirdi (Jo'natdi):</p>
      <div class="sig-line"></div>
      <p class="sig-name">${batch.shippedBy?.fullName || '________________________'}</p>
      <p class="sig-extra">Imzo: ___________ Sana: ${batch.shippedAt ? formatDate(batch.shippedAt) : '___________'}</p>
    </div>
    <div class="sig-block">
      <p class="sig-role">Qabul qildi:</p>
      <div class="sig-line"></div>
      <p class="sig-name">${batch.receivedBy?.fullName || '________________________'}</p>
      <p class="sig-extra">Imzo: ___________ Sana: ${batch.receivedAt ? formatDate(batch.receivedAt) : '___________'}</p>
    </div>
  </div>

  <div class="stamp-area">M.O.<br/>(muhr o'rni)</div>

  <div class="doc-footer">
    <span>Hujjat: ${batch.documentNumber}</span>
    <span>AvtoHisob tizimi · ${new Date().toLocaleDateString('uz-UZ')}</span>
  </div>

  </body></html>`
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Transfers() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const isAdminOrManager = hasRole('admin', 'manager', 'super_admin') // so'rovga javob berish, batch yaratish (admin/manager)
  const canManageBatch = hasRole('admin', 'manager', 'super_admin', 'branch_manager') // batch create/ship/receive

  const [tab, setTab] = useState<'batches' | 'requests' | 'history'>('batches')

  // Batches state
  const [bPage, setBPage] = useState(1)
  const [bLimit] = useState(20)
  const [bStatus, setBStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [fromWh, setFromWh] = useState('')
  const [toWh, setToWh] = useState('')
  const [batchNotes, setBatchNotes] = useState('')
  const [batchItems, setBatchItems] = useState<BulkItem[]>([{ sparePartId: '', quantity: '1' }])
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  // Requests state
  const [rPage, setRPage] = useState(1)
  const [rLimit] = useState(20)
  const [rStatus, setRStatus] = useState('')
  const [reqCreateOpen, setReqCreateOpen] = useState(false)
  const [reqItems, setReqItems] = useState<ReqItem[]>([{ partName: '', partCode: '', quantity: '1', reason: '', sparePartId: '' }])
  const [reqNotes, setReqNotes] = useState('')
  const [reqUrgency, setReqUrgency] = useState('medium')
  const [reqDetail, setReqDetail] = useState<ReqDetail | null>(null)
  const [respondOpen, setRespondOpen] = useState<{ req: SparePartReq; decision: 'approved' | 'rejected' } | null>(null)
  const [respondNotes, setRespondNotes] = useState('')
  const [createFromReq, setCreateFromReq] = useState<ReqDetail | null>(null)
  const [cfFromWh, setCfFromWh] = useState('')
  const [cfToWh, setCfToWh] = useState('')

  // History state
  const [hPage, setHPage] = useState(1)
  const [hLimit] = useState(20)
  const [hStatus, setHStatus] = useState('')

  // Queries
  const { data: batchData, isLoading: bLoading } = useQuery({
    queryKey: ['batches', bPage, bLimit, bStatus],
    queryFn: () => api.get('/batches', { params: { page: bPage, limit: bLimit, status: bStatus || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const { data: reqData, isLoading: rLoading } = useQuery({
    queryKey: ['requests', rPage, rLimit, rStatus],
    queryFn: () => api.get('/requests', { params: { page: rPage, limit: rLimit, status: rStatus || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const { data: historyData, isLoading: hLoading } = useQuery({
    queryKey: ['transfers-history', hPage, hLimit, hStatus],
    queryFn: () => api.get('/transfers', { params: { page: hPage, limit: hLimit, status: hStatus || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
    enabled: tab === 'history',
  })

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { select: 'true' } }).then(r => r.data.data),
  })

  const { data: fromWhInventory } = useQuery({
    queryKey: ['batch-inventory', fromWh],
    queryFn: () => api.get('/inventory', { params: { warehouseId: fromWh, select: 'true' } }).then(r => r.data.data),
    enabled: !!fromWh,
  })

  const { data: cfFromWhInventory } = useQuery({
    queryKey: ['cf-inventory', cfFromWh],
    queryFn: () => api.get('/inventory', { params: { warehouseId: cfFromWh, limit: 500 } }).then(r => r.data.data),
    enabled: !!cfFromWh && !!createFromReq,
  })

  const warehouses = (warehousesData || []).map((w: any) => ({ value: w.id, label: w.name }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} — ${sp.name}` }))

  const invMap = useMemo(() => {
    const m: Record<string, number> = {}
    ;(fromWhInventory || []).forEach((i: any) => { m[i.sparePartId] = i.quantityOnHand })
    return m
  }, [fromWhInventory])

  const partOptions = useMemo(() => {
    if (!fromWhInventory) return spareParts
    return (fromWhInventory || [])
      .filter((i: any) => i.quantityOnHand > 0)
      .map((i: any) => ({ value: i.sparePartId, label: `${i.sparePart?.partCode} — ${i.sparePart?.name} (${i.quantityOnHand} ta)` }))
  }, [fromWhInventory, spareParts])

  const cfInvMap = useMemo(() => {
    const m: Record<string, number> = {}
    ;(cfFromWhInventory || []).forEach((i: any) => { m[i.sparePartId] = i.quantityOnHand })
    return m
  }, [cfFromWhInventory])

  // Mutations
  const createBatchMutation = useMutation({
    mutationFn: (body: any) => api.post('/batches', body),
    onSuccess: (res) => {
      toast.success(res.data.message || t('transfers.toast.created'))
      qc.invalidateQueries({ queryKey: ['batches'] })
      setCreateOpen(false)
      setFromWh(''); setToWh(''); setBatchNotes('')
      setBatchItems([{ sparePartId: '', quantity: '1' }])
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const shipMutation = useMutation({
    mutationFn: (id: string) => api.put(`/batches/${id}/ship`),
    onSuccess: (_, id) => {
      toast.success(t('transfers.toast.shipped'))
      qc.invalidateQueries({ queryKey: ['batches'] })
      if (batchDetail?.id === id) {
        api.get(`/batches/${id}`).then(r => setBatchDetail(r.data.data))
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const receiveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/batches/${id}/receive`),
    onSuccess: (_, id) => {
      toast.success(t('transfers.toast.received'))
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      if (batchDetail?.id === id) {
        api.get(`/batches/${id}`).then(r => setBatchDetail(r.data.data))
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const createReqMutation = useMutation({
    mutationFn: (body: any) => api.post('/requests', body),
    onSuccess: (res) => {
      toast.success(res.data.message || t('transfers.toast.reqSent'))
      qc.invalidateQueries({ queryKey: ['requests'] })
      setReqCreateOpen(false)
      setReqItems([{ partName: '', partCode: '', quantity: '1', reason: '', sparePartId: '' }])
      setReqNotes(''); setReqUrgency('medium')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const respondMutation = useMutation({
    mutationFn: ({ id, status, responseNotes }: { id: string; status: string; responseNotes: string }) =>
      api.put(`/requests/${id}/respond`, { status, responseNotes }),
    onSuccess: () => {
      toast.success(t('transfers.toast.responded'))
      qc.invalidateQueries({ queryKey: ['requests'] })
      setRespondOpen(null); setRespondNotes('')
      if (reqDetail) api.get(`/requests/${reqDetail.id}`).then(r => setReqDetail(r.data.data))
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const createFromReqMutation = useMutation({
    mutationFn: (body: any) => api.post('/batches', body),
    onSuccess: (res) => {
      toast.success(res.data.message || t('transfers.toast.created'))
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['requests'] })
      setCreateFromReq(null); setCfFromWh(''); setCfToWh('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Open batch detail
  const openBatchDetail = async (id: string) => {
    try {
      const [detailRes, qrRes] = await Promise.all([
        api.get(`/batches/${id}`),
        api.get(`/batches/${id}/qr`),
      ])
      setBatchDetail(detailRes.data.data)
      setQrUrl(qrRes.data.data?.qr || null)
    } catch {
      toast.error(t('transfers.toast.loadError'))
    }
  }

  // Open request detail
  const openReqDetail = async (id: string) => {
    const r = await api.get(`/requests/${id}`)
    setReqDetail(r.data.data)
  }

  const handleCreateBatch = () => {
    if (!fromWh || !toWh) return toast.error(t('transfers.toast.selectWarehouses'))
    if (fromWh === toWh) return toast.error(t('transfers.toast.sameWarehouse'))
    const validItems = batchItems.filter(i => i.sparePartId && Number(i.quantity) > 0)
    if (!validItems.length) return toast.error(t('transfers.toast.minOnePart'))
    createBatchMutation.mutate({ fromWarehouseId: fromWh, toWarehouseId: toWh, notes: batchNotes, items: validItems })
  }

  const handleCreateReq = () => {
    const validItems = reqItems.filter(i => i.partName.trim() && Number(i.quantity) > 0)
    if (!validItems.length) return toast.error(t('transfers.toast.minOnePartReq'))
    createReqMutation.mutate({ notes: reqNotes, urgency: reqUrgency, items: validItems })
  }

  const handleCreateFromReq = () => {
    if (!createFromReq || !cfFromWh || !cfToWh) return toast.error(t('transfers.toast.selectWarehouses'))
    const itemsWithId = createFromReq.items
      .filter(i => (i as any).sparePart?.id)
      .map(i => ({ sparePartId: (i as any).sparePart.id, quantity: i.quantity }))
    if (!itemsWithId.length) return toast.error(t('transfers.toast.noMatchingParts'))
    createFromReqMutation.mutate({
      fromWarehouseId: cfFromWh, toWarehouseId: cfToWh,
      requestId: createFromReq.id,
      items: itemsWithId,
    })
  }

  // ── Batch columns ──────────────────────────────────────────────────────────

  const batchColumns = [
    { key: 'doc', title: t('transfers.colDoc'), render: (b: TransferBatch) => (
      <button onClick={() => openBatchDetail(b.id)} className="text-left">
        <p className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline">{b.documentNumber}</p>
        <p className="text-xs text-gray-400">{formatDate(b.createdAt)}</p>
      </button>
    )},
    { key: 'route', title: t('transfers.colRoute'), render: (b: TransferBatch) => (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-900 dark:text-white">{b.fromWarehouse.name}</span>
        <ArrowRight className="w-4 h-4 text-gray-400" />
        <span className="font-medium text-gray-900 dark:text-white">{b.toWarehouse.name}</span>
      </div>
    )},
    { key: 'count', title: t('transfers.colParts'), render: (b: TransferBatch) => `${b._count?.transfers || 0} ta` },
    { key: 'status', title: t('transfers.colStatus'), render: (b: TransferBatch) => <Badge variant={BATCH_COLOR[b.status]}>{t(`transfers.batchStatus.${b.status}`, b.status)}</Badge> },
    { key: 'createdBy', title: t('transfers.colCreatedBy'), render: (b: TransferBatch) => <span className="text-sm text-gray-500">{b.createdBy?.fullName || '—'}</span> },
    { key: 'actions', title: '', render: (b: TransferBatch) => (
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={<FileText className="w-4 h-4 text-blue-500" />} onClick={() => openBatchDetail(b.id)} />
        {b.status === 'pending' && canManageBatch && (
          <Button size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5 text-blue-600" />}
            loading={shipMutation.isPending}
            onClick={() => shipMutation.mutate(b.id)}>{t('transfers.shipBtn')}</Button>
        )}
        {b.status === 'shipped' && (hasRole('admin', 'manager', 'branch_manager', 'super_admin')) && (
          <Button size="sm" variant="secondary" icon={<Package className="w-3.5 h-3.5 text-green-600" />}
            loading={receiveMutation.isPending}
            onClick={() => receiveMutation.mutate(b.id)}>{t('transfers.receiveBtn')}</Button>
        )}
      </div>
    )},
  ]

  // ── Request columns ────────────────────────────────────────────────────────

  const reqColumns = [
    { key: 'doc', title: t('transfers.colDoc'), render: (r: SparePartReq) => (
      <button onClick={() => openReqDetail(r.id)} className="text-left">
        <p className="font-mono text-sm font-bold text-purple-600 dark:text-purple-400 hover:underline">{r.documentNumber}</p>
        <p className="text-xs text-gray-400">{formatDate(r.createdAt)}</p>
      </button>
    )},
    { key: 'urgency', title: t('transfers.colUrgency'), render: (r: SparePartReq) => (
      <Badge variant={URGENCY_COLOR[r.urgency]}>{t(`transfers.urgency.${r.urgency}`, r.urgency)}</Badge>
    )},
    { key: 'items', title: t('transfers.colParts'), render: (r: SparePartReq) => `${r._count?.items || 0} ta` },
    { key: 'status', title: t('transfers.colStatus'), render: (r: SparePartReq) => <Badge variant={REQ_COLOR[r.status]}>{t(`transfers.reqStatus.${r.status}`, r.status)}</Badge> },
    { key: 'requestedBy', title: t('transfers.colRequestedBy'), render: (r: SparePartReq) => <span className="text-sm text-gray-500">{r.requestedBy.fullName}</span> },
    { key: 'actions', title: '', render: (r: SparePartReq) => (
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={<FileText className="w-4 h-4 text-purple-500" />} onClick={() => openReqDetail(r.id)} />
        {r.status === 'pending' && isAdminOrManager && (
          <>
            <Button size="sm" variant="secondary" icon={<CheckCircle className="w-3.5 h-3.5 text-green-600" />}
              onClick={() => { setRespondOpen({ req: r, decision: 'approved' }); setRespondNotes('') }}>{t('transfers.approveBtn')}</Button>
            <Button size="sm" variant="ghost" icon={<AlertCircle className="w-3.5 h-3.5 text-red-500" />}
              onClick={() => { setRespondOpen({ req: r, decision: 'rejected' }); setRespondNotes('') }}>{t('transfers.rejectBtn')}</Button>
          </>
        )}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('transfers.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('transfers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'batches' && canManageBatch && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
              {t('transfers.newBatch')}
            </Button>
          )}
          {tab === 'requests' && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setReqCreateOpen(true)}>
              {t('transfers.newRequest')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'batches' as const, label: t('transfers.tabBatches'), icon: <Send className="w-4 h-4" /> },
          { key: 'requests' as const, label: t('transfers.tabRequests'), icon: <Inbox className="w-4 h-4" /> },
          { key: 'history' as const, label: t('transfers.tabHistory'), icon: <ArrowRight className="w-4 h-4" /> },
        ]).map(tabItem => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tabItem.key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tabItem.icon}{tabItem.label}
          </button>
        ))}
      </div>

      {/* Batches tab */}
      {tab === 'batches' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3">
            <select value={bStatus} onChange={e => { setBStatus(e.target.value); setBPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('transfers.allStatuses')}</option>
              {(['pending', 'shipped', 'received'] as const).map(k => <option key={k} value={k}>{t(`transfers.batchStatus.${k}`)}</option>)}
            </select>
          </div>
          <Table columns={batchColumns} data={batchData?.data || []} loading={bLoading} numbered page={bPage} limit={bLimit} />
          <Pagination page={bPage} totalPages={batchData?.meta?.totalPages || 1} total={batchData?.meta?.total || 0} limit={bLimit} onPageChange={setBPage} onLimitChange={() => {}} />
        </div>
      )}

      {/* Requests tab */}
      {tab === 'requests' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3">
            <select value={rStatus} onChange={e => { setRStatus(e.target.value); setRPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('transfers.allStatuses')}</option>
              {(['pending', 'approved', 'rejected', 'fulfilled'] as const).map(k => <option key={k} value={k}>{t(`transfers.reqStatus.${k}`)}</option>)}
            </select>
          </div>
          <Table columns={reqColumns} data={reqData?.data || []} loading={rLoading} numbered page={rPage} limit={rLimit} />
          <Pagination page={rPage} totalPages={reqData?.meta?.totalPages || 1} total={reqData?.meta?.total || 0} limit={rLimit} onPageChange={setRPage} onLimitChange={() => {}} />
        </div>
      )}

      {/* Tarix (eski individual transferlar) tab */}
      {tab === 'history' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 items-center">
            <select value={hStatus} onChange={e => { setHStatus(e.target.value); setHPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('transfers.allStatuses')}</option>
              {(['pending', 'approved', 'shipped', 'received'] as const).map(k => <option key={k} value={k}>{t(`transfers.historyStatus.${k}`)}</option>)}
            </select>
            <ExcelExportButton endpoint="/exports/transfers" label="Excel" />
          </div>
          <Table
            columns={[
              { key: 'route', title: t('transfers.colRoute'), render: (tr: OldTransfer) => (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-900 dark:text-white">{tr.fromWarehouse?.name}</span>
                  <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="font-medium text-gray-900 dark:text-white">{tr.toWarehouse?.name}</span>
                </div>
              )},
              { key: 'sparePart', title: t('transfers.colSparePart'), render: (tr: OldTransfer) => (
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{tr.sparePart?.name}</p>
                  <p className="text-xs font-mono text-gray-400">{tr.sparePart?.partCode}</p>
                </div>
              )},
              { key: 'quantity', title: t('transfers.colQuantity'), render: (tr: OldTransfer) => `${tr.quantity} ta` },
              { key: 'status', title: t('transfers.colStatus'), render: (tr: OldTransfer) => (
                <Badge variant={{ pending: 'warning', approved: 'info', shipped: 'default', received: 'success' }[tr.status] as any}>
                  {t(`transfers.historyStatus.${tr.status}`, tr.status)}
                </Badge>
              )},
              { key: 'createdAt', title: t('transfers.colDate'), render: (tr: OldTransfer) => <span className="text-sm text-gray-500">{formatDate(tr.createdAt)}</span> },
              { key: 'batch', title: t('transfers.colDoc'), render: (tr: OldTransfer) => tr.batchId
                ? <span className="text-xs text-blue-500 font-mono">Batched</span>
                : <span className="text-xs text-gray-400">—</span>
              },
            ]}
            data={historyData?.data || []}
            loading={hLoading}
            numbered
            page={hPage}
            limit={hLimit}
          />
          <Pagination page={hPage} totalPages={historyData?.meta?.totalPages || 1} total={historyData?.meta?.total || 0} limit={hLimit} onPageChange={setHPage} onLimitChange={() => {}} />
        </div>
      )}

      {/* ── Create Batch Modal ──────────────────────────────────────────────── */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('transfers.createBatchTitle')} size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={createBatchMutation.isPending} icon={<Send className="w-4 h-4" />} onClick={handleCreateBatch}>
              {t('transfers.createBatchSubmit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect label="Qayerdan *" options={warehouses} value={fromWh}
              onChange={v => { setFromWh(v); setBatchItems([{ sparePartId: '', quantity: '1' }]) }}
              placeholder="Manba ombor..." />
            <SearchableSelect label="Qayerga *" options={warehouses.filter((w: any) => w.value !== fromWh)} value={toWh}
              onChange={setToWh} placeholder="Qabul ombor..." />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('transfers.notes')}</label>
            <input className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={batchNotes} onChange={e => setBatchNotes(e.target.value)} placeholder="Ixtiyoriy..." />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('transfers.partsLabel')}</span>
              {!fromWh && <span className="text-xs text-amber-500 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{t('transfers.selectWarehouseFirst')}</span>}
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {batchItems.map((item, idx) => {
                const avail = item.sparePartId ? (invMap[item.sparePartId] ?? null) : null
                const over = avail !== null && Number(item.quantity) > avail
                return (
                  <div key={idx} className={`flex items-start gap-2 p-2.5 rounded-xl border ${over ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40'}`}>
                    <div className="flex-1 min-w-0">
                      <SearchableSelect label="" options={partOptions} value={item.sparePartId}
                        onChange={v => { const u = [...batchItems]; u[idx] = { ...u[idx], sparePartId: v }; setBatchItems(u) }}
                        placeholder="Ehtiyot qism..." />
                      {avail !== null && <p className={`text-xs mt-0.5 ${over ? 'text-red-500' : 'text-gray-400'}`}>Mavjud: {avail} ta{over ? ' — yetarli emas!' : ''}</p>}
                    </div>
                    <div className="w-20 flex-shrink-0">
                      <input type="number" min={1} value={item.quantity}
                        onChange={e => { const u = [...batchItems]; u[idx] = { ...u[idx], quantity: e.target.value }; setBatchItems(u) }}
                        className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${over ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`} />
                    </div>
                    <button onClick={() => setBatchItems(batchItems.filter((_, i) => i !== idx))} disabled={batchItems.length === 1}
                      className="mt-1.5 p-1.5 text-red-400 hover:text-red-600 disabled:opacity-30 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
            <button onClick={() => setBatchItems([...batchItems, { sparePartId: '', quantity: '1' }])}
              className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
              <PlusCircle className="w-4 h-4" />{t('transfers.addPart')}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Batch Detail / Document Modal ─────────────────────────────────────── */}
      <Modal open={!!batchDetail} onClose={() => { setBatchDetail(null); setQrUrl(null) }}
        title={batchDetail ? `${batchDetail.documentNumber} — ${t('transfers.batchDocTitle')}` : ''}
        size="lg"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={() => { setBatchDetail(null); setQrUrl(null) }}>{t('common.close')}</Button>
            {batchDetail && (
              <Button variant="outline" icon={<Printer className="w-4 h-4" />}
                onClick={() => batchDetail && printDocument(buildPrintHtml(batchDetail, qrUrl || undefined))}>
                {t('transfers.print')}
              </Button>
            )}
            {batchDetail?.status === 'pending' && canManageBatch && (
              <Button icon={<Send className="w-4 h-4" />} loading={shipMutation.isPending}
                onClick={() => batchDetail && shipMutation.mutate(batchDetail.id)}>
                {t('transfers.sendBtn')}
              </Button>
            )}
            {batchDetail?.status === 'shipped' && hasRole('admin', 'manager', 'branch_manager', 'super_admin') && (
              <Button icon={<Package className="w-4 h-4" />} loading={receiveMutation.isPending}
                onClick={() => batchDetail && receiveMutation.mutate(batchDetail.id)}>
                {t('transfers.receiveFullBtn')}
              </Button>
            )}
          </div>
        }
      >
        {batchDetail && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 text-sm">
                <p><span className="text-gray-500">{t('transfers.detailStatus')}</span> <Badge variant={BATCH_COLOR[batchDetail.status]}>{t(`transfers.batchStatus.${batchDetail.status}`, batchDetail.status)}</Badge></p>
                <p><span className="text-gray-500">{t('transfers.detailDate')}</span> <span className="font-medium">{formatDate(batchDetail.createdAt)}</span></p>
                <p><span className="text-gray-500">{t('transfers.detailFrom')}</span> <span className="font-medium">{batchDetail.fromWarehouse.name}</span></p>
                <p><span className="text-gray-500">{t('transfers.detailTo')}</span> <span className="font-medium">{batchDetail.toWarehouse.name}</span></p>
                {batchDetail.notes && <p><span className="text-gray-500">{t('transfers.detailNotes')}</span> {batchDetail.notes}</p>}
                {batchDetail.request && <p><span className="text-gray-500">{t('transfers.detailRequest')}</span> <span className="font-mono text-xs">{batchDetail.request.documentNumber}</span></p>}
              </div>
              <div className="space-y-1 text-sm">
                {batchDetail.createdBy && <p><span className="text-gray-500">{t('transfers.detailCreatedBy')}</span> {batchDetail.createdBy.fullName}</p>}
                {batchDetail.shippedBy && <p><span className="text-gray-500">{t('transfers.detailShippedBy')}</span> {batchDetail.shippedBy.fullName} ({batchDetail.shippedAt ? formatDate(batchDetail.shippedAt) : ''})</p>}
                {batchDetail.receivedBy && <p><span className="text-gray-500">{t('transfers.detailReceivedBy')}</span> {batchDetail.receivedBy.fullName} ({batchDetail.receivedAt ? formatDate(batchDetail.receivedAt) : ''})</p>}
                {qrUrl && (
                  <div className="flex justify-end">
                    <div className="text-center">
                      <img src={qrUrl} alt="QR" className="w-20 h-20 border border-gray-200 rounded" />
                      <p className="text-xs text-gray-400 mt-1">{t('transfers.qrLabel')}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Items table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colParts')}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colCode')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colQuantity')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colPrice')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batchDetail.transfers.map((tr, i) => (
                    <tr key={tr.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{tr.sparePart.name}</td>
                      <td className="px-3 py-2"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{tr.sparePart.partCode}</span></td>
                      <td className="px-3 py-2 text-right font-bold">{tr.quantity} ta</td>
                      <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(Number(tr.sparePart.unitPrice))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{formatCurrency(tr.quantity * Number(tr.sparePart.unitPrice))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300">{t('transfers.totalLabel')}</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">
                      {formatCurrency(batchDetail.transfers.reduce((s, tr) => s + tr.quantity * Number(tr.sparePart.unitPrice), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create Request Modal ──────────────────────────────────────────────── */}
      <Modal open={reqCreateOpen} onClose={() => setReqCreateOpen(false)} title={t('transfers.createReqTitle')} size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setReqCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={createReqMutation.isPending} icon={<MessageSquare className="w-4 h-4" />} onClick={handleCreateReq}>
              {t('transfers.reqSubmit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('transfers.urgencyLabel')}</label>
              <select value={reqUrgency} onChange={e => setReqUrgency(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="low">{t('transfers.urgency.low')}</option>
                <option value="medium">{t('transfers.urgency.medium')}</option>
                <option value="high">{t('transfers.urgency.high')}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('transfers.notes')}</label>
              <input className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={reqNotes} onChange={e => setReqNotes(e.target.value)} placeholder="Sabab yoki izoh..." />
            </div>
          </div>

          <div>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('transfers.reqPartsList')}</span>
            <div className="space-y-2 mt-2 max-h-72 overflow-y-auto pr-1">
              {reqItems.map((item, idx) => (
                <div key={idx} className="p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700/40 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <SearchableSelect label="" options={spareParts} value={item.sparePartId}
                        onChange={v => {
                          const sp = (sparePartsData || []).find((s: any) => s.id === v)
                          const u = [...reqItems]; u[idx] = { ...u[idx], sparePartId: v, partName: sp?.name || '', partCode: sp?.partCode || '' }; setReqItems(u)
                        }}
                        placeholder="Ombordagi qismdan tanlang (ixtiyoriy)..." />
                    </div>
                    <button onClick={() => setReqItems(reqItems.filter((_, i) => i !== idx))} disabled={reqItems.length === 1}
                      className="mt-0.5 p-1.5 text-red-400 hover:text-red-600 disabled:opacity-30 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input placeholder={t('transfers.reqPartName')} value={item.partName}
                      onChange={e => { const u = [...reqItems]; u[idx] = { ...u[idx], partName: e.target.value }; setReqItems(u) }}
                      className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input placeholder={t('transfers.reqPartCode')} value={item.partCode}
                      onChange={e => { const u = [...reqItems]; u[idx] = { ...u[idx], partCode: e.target.value }; setReqItems(u) }}
                      className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="number" min={1} placeholder={t('transfers.reqQuantity')} value={item.quantity}
                      onChange={e => { const u = [...reqItems]; u[idx] = { ...u[idx], quantity: e.target.value }; setReqItems(u) }}
                      className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <input placeholder={t('transfers.reqReason')} value={item.reason}
                    onChange={e => { const u = [...reqItems]; u[idx] = { ...u[idx], reason: e.target.value }; setReqItems(u) }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
            </div>
            <button onClick={() => setReqItems([...reqItems, { partName: '', partCode: '', quantity: '1', reason: '', sparePartId: '' }])}
              className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
              <PlusCircle className="w-4 h-4" />{t('transfers.addRow')}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Request Detail Modal ──────────────────────────────────────────────── */}
      <Modal open={!!reqDetail} onClose={() => setReqDetail(null)}
        title={reqDetail ? `${reqDetail.documentNumber} — ${t('transfers.reqDocTitle')}` : ''}
        size="lg"
        footer={
          <div className="flex gap-2 w-full flex-wrap">
            <Button variant="outline" onClick={() => setReqDetail(null)}>{t('common.close')}</Button>
            {reqDetail?.status === 'pending' && isAdminOrManager && (
              <>
                <Button icon={<CheckCircle className="w-4 h-4" />}
                  onClick={() => reqDetail && setRespondOpen({ req: reqDetail as any, decision: 'approved' })}>
                  {t('transfers.approveAction')}
                </Button>
                <Button variant="outline" icon={<AlertCircle className="w-4 h-4 text-red-500" />}
                  onClick={() => reqDetail && setRespondOpen({ req: reqDetail as any, decision: 'rejected' })}>
                  {t('transfers.rejectAction')}
                </Button>
              </>
            )}
            {reqDetail && ['approved'].includes(reqDetail.status) && canManageBatch && (
              <Button variant="secondary" icon={<Send className="w-4 h-4" />}
                onClick={() => { setCreateFromReq(reqDetail); setReqDetail(null) }}>
                {t('transfers.createBatchTitle')}
              </Button>
            )}
          </div>
        }
      >
        {reqDetail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p><span className="text-gray-500">{t('transfers.detailStatus')}</span> <Badge variant={REQ_COLOR[reqDetail.status]}>{t(`transfers.reqStatus.${reqDetail.status}`, reqDetail.status)}</Badge></p>
                <p><span className="text-gray-500">{t('transfers.reqDetailUrgency')}</span> <Badge variant={URGENCY_COLOR[reqDetail.urgency]}>{t(`transfers.urgency.${reqDetail.urgency}`, reqDetail.urgency)}</Badge></p>
                <p><span className="text-gray-500">{t('transfers.detailDate')}</span> {formatDate(reqDetail.createdAt)}</p>
                <p><span className="text-gray-500">{t('transfers.reqDetailSentBy')}</span> {reqDetail.requestedBy.fullName}</p>
                {reqDetail.notes && <p><span className="text-gray-500">{t('transfers.detailNotes')}</span> {reqDetail.notes}</p>}
              </div>
              <div className="space-y-1">
                {reqDetail.respondedBy && <p><span className="text-gray-500">{t('transfers.reqDetailRespondedBy')}</span> {reqDetail.respondedBy.fullName}</p>}
                {reqDetail.respondedAt && <p><span className="text-gray-500">{t('transfers.reqDetailRespondedAt')}</span> {formatDate(reqDetail.respondedAt)}</p>}
                {reqDetail.responseNotes && <p><span className="text-gray-500">{t('transfers.detailNotes')}</span> {reqDetail.responseNotes}</p>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colParts')}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colCode')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.colQuantity')}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-300">{t('transfers.reqDetailReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reqDetail.items.map((it, i) => (
                    <tr key={it.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{it.sparePart?.name || it.partName}</td>
                      <td className="px-3 py-2"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{it.sparePart?.partCode || it.partCode || '—'}</span></td>
                      <td className="px-3 py-2 text-right font-bold">{it.quantity} ta</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{it.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {reqDetail.batches.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('transfers.reqDetailRelatedBatches')}</p>
                <div className="space-y-1">
                  {reqDetail.batches.map(b => (
                    <div key={b.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                      <span className="font-mono text-blue-600 dark:text-blue-400">{b.documentNumber}</span>
                      <Badge variant={BATCH_COLOR[b.status]}>{t(`transfers.batchStatus.${b.status}`, b.status)}</Badge>
                      <span className="text-gray-400 text-xs">{formatDate(b.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Respond to Request Modal ────────────────────────────────────────── */}
      <Modal open={!!respondOpen} onClose={() => { setRespondOpen(null); setRespondNotes('') }}
        title={respondOpen?.decision === 'approved' ? t('transfers.reqApproveTitle') : t('transfers.reqRejectTitle')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setRespondOpen(null); setRespondNotes('') }}>{t('common.cancel')}</Button>
            <Button
              loading={respondMutation.isPending}
              onClick={() => respondOpen && respondMutation.mutate({ id: respondOpen.req.id, status: respondOpen.decision, responseNotes: respondNotes })}
            >
              {respondOpen?.decision === 'approved' ? t('transfers.approveAction') : t('transfers.rejectAction')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {respondOpen?.decision === 'approved'
              ? t('transfers.reqApproveText')
              : t('transfers.reqRejectText')}
          </p>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('transfers.respondNotes')}</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={3}
              value={respondNotes} onChange={e => setRespondNotes(e.target.value)} placeholder="Javob izohini kiriting..." />
          </div>
        </div>
      </Modal>

      {/* ── Create Batch From Request Modal ─────────────────────────────────── */}
      <Modal open={!!createFromReq} onClose={() => { setCreateFromReq(null); setCfFromWh(''); setCfToWh('') }}
        title={createFromReq ? `${t('transfers.fromReqTitle')} ${createFromReq.documentNumber}` : ''}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setCreateFromReq(null); setCfFromWh(''); setCfToWh('') }}>{t('common.cancel')}</Button>
            <Button loading={createFromReqMutation.isPending} icon={<Send className="w-4 h-4" />} onClick={handleCreateFromReq}>
              {t('transfers.createBatchSubmit')}
            </Button>
          </>
        }
      >
        {createFromReq && (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-sm text-blue-800 dark:text-blue-300">
              {t('transfers.fromReqInfo', { count: createFromReq.items.filter(i => (i as any).sparePart?.id).length })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SearchableSelect label="Qayerdan *" options={warehouses} value={cfFromWh}
                onChange={setCfFromWh} placeholder="Manba ombor..." />
              <SearchableSelect label="Qayerga *" options={warehouses.filter((w: any) => w.value !== cfFromWh)} value={cfToWh}
                onChange={setCfToWh} placeholder="Qabul ombor..." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 text-gray-500">{t('transfers.colParts')}</th>
                  <th className="text-right py-2 text-gray-500">{t('transfers.colQuantity')}</th>
                  {cfFromWh && <th className="text-right py-2 text-gray-500">{t('transfers.available')}</th>}
                </tr></thead>
                <tbody>
                  {createFromReq.items.map(it => {
                    const avail = cfFromWh && (it as any).sparePart?.id ? (cfInvMap[(it as any).sparePart.id] ?? '?') : null
                    return (
                      <tr key={it.id} className="border-b border-gray-100 dark:border-gray-700">
                        <td className="py-2">
                          <p className="font-medium text-gray-900 dark:text-white">{it.sparePart?.name || it.partName}</p>
                          {it.sparePart?.partCode && <p className="text-xs font-mono text-gray-400">{it.sparePart.partCode}</p>}
                          {!(it as any).sparePart?.id && <p className="text-xs text-amber-500">{t('transfers.notInWarehouse')}</p>}
                        </td>
                        <td className="py-2 text-right font-bold">{it.quantity}</td>
                        {cfFromWh && <td className={`py-2 text-right font-bold ${typeof avail === 'number' && avail < it.quantity ? 'text-red-500' : 'text-green-600'}`}>{avail ?? '—'}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
