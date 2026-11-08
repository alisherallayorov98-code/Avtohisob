import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Minus, Package, Plus, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { useAuthStore } from '../../stores/authStore'
import SearchableSelect from '../ui/SearchableSelect'
import PartPicker, { InventoryPart } from './PartPicker'

export interface EditableMaintenance {
  id: string
  vehicleId: string
  status: string
  installationDate: string
  laborCost: number
  workerName?: string
  paymentType: string
  isPaid: boolean
  isOfficial?: boolean
  notes?: string
  vehicle: { registrationNumber: string; brand: string; model: string }
  supplier?: { name: string }
  sparePart?: { name: string }
  quantityUsed?: number
  items?: { sparePart: { name: string }; quantityUsed: number; unitCost: number }[]
}

interface Line {
  key: number
  sparePartId: string
  name: string
  partCode: string
  stock: number
  qty: number
  unitCost: string
  isTire: boolean
  tireSerial: string
  tirePosition: string
}

interface Draft {
  vehicleId: string
  warehouseId: string
  lines: Line[]
  installationDate: string
  laborCost: string
  workerName: string
  paymentType: 'cash' | 'credit'
  isPaid: boolean
  isOfficial: boolean
  supplierId: string
  notes: string
}

interface Props {
  open: boolean
  editRecord: EditableMaintenance | null
  onClose: () => void
  onSaved: (r: { createdId?: string; edited: boolean; editedStatus?: string }) => void
}

// datetime-local maydoni uchun mahalliy vaqt (UTC ISO ni to'g'ridan-to'g'ri kesish +5 soatni yo'qotadi)
const toLocalInput = (value: string | Date) => {
  const d = new Date(value)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
const nowLocal = () => toLocalInput(new Date())

const emptyDraft = (): Draft => ({
  vehicleId: '', warehouseId: '', lines: [], installationDate: nowLocal(), laborCost: '', workerName: '',
  paymentType: 'cash', isPaid: false, isOfficial: true, supplierId: '', notes: '',
})

const POSITIONS = ['Front-Left', 'Front-Right', 'Rear-Left', 'Rear-Right', 'Spare'] as const

const inputCls =
  'w-full h-10 px-3 text-sm rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition disabled:bg-slate-50 disabled:text-slate-500'

function Segmented<T extends string | boolean>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; tone?: 'green' | 'orange' | 'blue' }[]; onChange: (v: T) => void
}) {
  const tones = {
    green: 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200 dark:bg-slate-700 dark:text-emerald-300 dark:ring-emerald-800',
    orange: 'bg-white text-orange-700 shadow-sm ring-1 ring-orange-200 dark:bg-slate-700 dark:text-orange-300 dark:ring-orange-800',
    blue: 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200 dark:bg-slate-700 dark:text-blue-300 dark:ring-blue-800',
  }
  return (
    <div className="grid gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map(o => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
          className={`h-9 rounded-lg text-sm font-semibold transition-all ${
            value === o.value ? tones[o.tone || 'blue'] : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

function SectionTitle({ n, title, extra }: { n: number; title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="w-6 h-6 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold grid place-items-center shrink-0">{n}</span>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      {extra && <div className="ml-auto">{extra}</div>}
    </div>
  )
}

export default function MaintenanceFormModal({ open, editRecord, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { user, hasRole } = useAuthStore()
  const isApprover = hasRole('admin', 'super_admin')
  const isEdit = !!editRecord
  const draftKey = `mntDraft:${user?.id || 'anon'}`

  const [d, setD] = useState<Draft>(emptyDraft)
  const [draftRestored, setDraftRestored] = useState(false)
  const [warehouseTouched, setWarehouseTouched] = useState(false)
  const [showExtra, setShowExtra] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }))

  // Ochilganda: tahrirlash — yozuvdan; yangi — qoralamadan yoki bo'sh
  useEffect(() => {
    if (!open) return
    setShowExtra(false)
    setWarehouseTouched(false)
    if (editRecord) {
      setDraftRestored(false)
      setD({
        ...emptyDraft(),
        vehicleId: editRecord.vehicleId,
        installationDate: toLocalInput(editRecord.installationDate),
        laborCost: editRecord.laborCost ? String(editRecord.laborCost) : '',
        workerName: editRecord.workerName || '',
        paymentType: editRecord.paymentType === 'credit' ? 'credit' : 'cash',
        isPaid: !!editRecord.isPaid,
        isOfficial: editRecord.isOfficial !== false,
        notes: editRecord.notes || '',
      })
      return
    }
    let restored: Draft | null = null
    try { restored = JSON.parse(localStorage.getItem(draftKey) || 'null') } catch { restored = null }
    const hasContent = restored && (restored.vehicleId || restored.lines?.length || restored.laborCost || restored.notes)
    if (hasContent && restored) {
      setD({ ...emptyDraft(), ...restored })
      setDraftRestored(true)
      setWarehouseTouched(!!restored.warehouseId)
    } else {
      let lastWorker = ''
      try { lastWorker = localStorage.getItem('mntLastWorker') || '' } catch { /* bo'sh */ }
      setD({ ...emptyDraft(), workerName: lastWorker })
      setDraftRestored(false)
    }
  }, [open, editRecord, draftKey])

  // Qoralamani saqlab borish (faqat yangi yozuvda)
  useEffect(() => {
    if (!open || isEdit) return
    const id = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify(d)) } catch { /* to'lgan */ } }, 400)
    return () => clearTimeout(id)
  }, [d, open, isEdit, draftKey])

  const clearDraft = () => { try { localStorage.removeItem(draftKey) } catch { /* bo'sh */ } }
  // X / fon / Esc bilan yopilganda — kechiktirilgan saqlashni kutmasdan darhol yozamiz
  const closeKeepingDraft = () => {
    if (!isEdit) { try { localStorage.setItem(draftKey, JSON.stringify(d)) } catch { /* to'lgan */ } }
    onClose()
  }

  // ── Ma'lumotlar ──────────────────────────────────────────────────────────
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-select-all'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
    enabled: open && !isEdit,
  })
  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
    enabled: open && !isEdit,
  })
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
    enabled: open && !isEdit,
  })
  const { data: workerNames } = useQuery({
    queryKey: ['maintenance-workers'],
    queryFn: () => api.get('/maintenance/workers').then(r => r.data.data as string[]),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const { data: ctx } = useQuery({
    queryKey: ['maintenance-form-context', d.vehicleId],
    queryFn: () => api.get('/maintenance/form-context', { params: { vehicleId: d.vehicleId } }).then(r => r.data.data),
    enabled: open && !isEdit && !!d.vehicleId,
  })
  // select=true — sahifalashsiz, skladdagi BARCHA qismlar (avval 100 ta bilan cheklanib qolardi)
  const { data: inventoryData, isLoading: invLoading } = useQuery({
    queryKey: ['inventory-warehouse-all', d.warehouseId],
    queryFn: () => api.get('/inventory', { params: { warehouseId: d.warehouseId, select: 'true' } }).then(r => r.data.data),
    enabled: open && !isEdit && !!d.warehouseId,
  })

  const vehicles = useMemo(() => (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` })), [vehiclesData])
  const warehouses = useMemo(() => (warehousesData || []).filter((w: any) => w.isActive), [warehousesData])
  const suppliers = useMemo(() => [{ value: '', label: t('maintenanceForm.noSupplier') }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))], [suppliersData, t])
  const parts: InventoryPart[] = useMemo(() => (inventoryData || [])
    .filter((inv: any) => !d.warehouseId || inv.warehouseId === d.warehouseId || inv.warehouse?.id === d.warehouseId)
    .map((inv: any) => ({
      sparePartId: inv.sparePart.id, name: inv.sparePart.name, partCode: inv.sparePart.partCode,
      stock: inv.quantityOnHand, unitPrice: Number(inv.sparePart.unitPrice) || 0,
    }))
    .sort((a: InventoryPart, b: InventoryPart) => Number(b.stock > 0) - Number(a.stock > 0) || a.name.localeCompare(b.name)), [inventoryData, d.warehouseId])

  // Mashina tanlanganda — uning filiali skladi (qism hali tanlanmagan va sklad qo'lda o'zgartirilmagan bo'lsa)
  const vehicleWarehouse = ctx?.warehouse as { id: string; name: string } | null | undefined
  useEffect(() => {
    if (!vehicleWarehouse || isEdit) return
    if (!warehouseTouched && d.lines.length === 0 && d.warehouseId !== vehicleWarehouse.id) set('warehouseId', vehicleWarehouse.id)
  }, [vehicleWarehouse?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeWarehouse = (id: string) => {
    if (id === d.warehouseId) return
    if (d.lines.length) toast(t('maintenanceForm.warehouseCleared'), { icon: 'ℹ️' })
    setD(prev => ({ ...prev, warehouseId: id, lines: [] }))
    setWarehouseTouched(true)
  }

  // ── Qatorlar ─────────────────────────────────────────────────────────────
  const addPart = (p: InventoryPart) => {
    setD(prev => {
      const ex = prev.lines.find(l => l.sparePartId === p.sparePartId && !l.isTire)
      if (ex) return { ...prev, lines: prev.lines.map(l => l === ex ? { ...l, qty: l.qty + 1 } : l) }
      return {
        ...prev,
        lines: [...prev.lines, {
          key: Date.now() + Math.random(), sparePartId: p.sparePartId, name: p.name, partCode: p.partCode, stock: p.stock,
          qty: 1, unitCost: String(p.unitPrice || 0), isTire: false, tireSerial: '', tirePosition: '',
        }],
      }
    })
  }
  const updLine = (key: number, patch: Partial<Line>) => setD(prev => ({ ...prev, lines: prev.lines.map(l => l.key === key ? { ...l, ...patch } : l) }))
  const delLine = (key: number) => setD(prev => ({ ...prev, lines: prev.lines.filter(l => l.key !== key) }))
  const selectedQty = useMemo(() => d.lines.reduce<Record<string, number>>((m, l) => { m[l.sparePartId] = (m[l.sparePartId] || 0) + l.qty; return m }, {}), [d.lines])

  const partsTotal = d.lines.reduce((s, l) => s + (Number(l.unitCost) || 0) * l.qty, 0)
  const laborVal = Number(d.laborCost) || 0
  const total = (isEdit ? 0 : partsTotal) + laborVal
  const editPartsTotal = isEdit
    ? (editRecord?.items?.length ? editRecord.items.reduce((s, i) => s + Number(i.unitCost) * i.quantityUsed, 0) : 0)
    : 0
  const recentParts: Record<string, { date: string; pending: boolean }> = ctx?.recentParts || {}

  // ── Saqlash ──────────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => {
      if (isEdit && editRecord) {
        return api.put(`/maintenance/${editRecord.id}`, {
          laborCost: d.laborCost || '0', workerName: d.workerName, paymentType: d.paymentType,
          isPaid: d.paymentType === 'credit' ? d.isPaid : true, isOfficial: d.isOfficial, notes: d.notes,
        })
      }
      return api.post('/maintenance', {
        vehicleId: d.vehicleId,
        installationDate: d.installationDate,
        laborCost: d.laborCost || '0',
        workerName: d.workerName,
        paymentType: d.paymentType,
        ...(d.paymentType === 'credit' ? { isPaid: d.isPaid } : {}),
        supplierId: d.supplierId || undefined,
        notes: d.notes,
        isOfficial: d.isOfficial,
        items: d.lines.filter(l => l.qty > 0).map(l => ({
          sparePartId: l.sparePartId,
          warehouseId: d.warehouseId || undefined,
          quantityUsed: l.qty,
          unitCost: Number(l.unitCost) || 0,
          isTire: l.isTire,
          tireSerial: l.isTire ? l.tireSerial.trim() || undefined : undefined,
          tirePosition: l.isTire ? l.tirePosition || undefined : undefined,
        })),
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['maintenance-workers'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-warehouse-all'] })
      qc.invalidateQueries({ queryKey: ['maintenance-form-context'] })
      try { if (d.workerName.trim()) localStorage.setItem('mntLastWorker', d.workerName.trim()) } catch { /* bo'sh */ }
      if (!isEdit) clearDraft()
      onSaved(isEdit ? { edited: true, editedStatus: editRecord?.status } : { edited: false, createdId: res.data?.data?.id })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('errors.generic'), { duration: 6000 }),
  })

  const submit = () => {
    if (!isEdit && !d.vehicleId) { toast.error(t('maintenanceForm.errVehicle')); return }
    if (!isEdit && !d.installationDate) { toast.error(t('maintenanceForm.errDate')); return }
    if (laborVal < 0) { toast.error(t('maintenanceForm.errLabor')); return }
    if (d.lines.some(l => l.isTire && !l.tireSerial.trim())) { toast.error(t('maintenance.toast.tireSerialMissing')); return }
    save.mutate()
  }

  const cancel = () => { if (!isEdit) clearDraft(); onClose() }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeKeepingDraft() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, d, isEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const posLabel: Record<string, string> = {
    'Front-Left': t('maintenance.positionFL'), 'Front-Right': t('maintenance.positionFR'),
    'Rear-Left': t('maintenance.positionRL'), 'Rear-Right': t('maintenance.positionRR'), Spare: t('maintenanceForm.positionSpare'),
  }
  const pickerDisabled = !d.vehicleId ? t('maintenanceForm.searchFirstVehicle') : !d.warehouseId ? t('maintenanceForm.searchNoWarehouse') : undefined
  const otherBranchWarehouse = vehicleWarehouse && d.warehouseId && vehicleWarehouse.id !== d.warehouseId ? vehicleWarehouse : null

  const totals = (
    <div className="space-y-1.5 text-sm">
      <div className="flex justify-between text-slate-500 dark:text-slate-400">
        <span>{t('maintenanceForm.partsTotal')}</span>
        <span className="tabular-nums">{formatCurrency(isEdit ? editPartsTotal : partsTotal)}</span>
      </div>
      <div className="flex justify-between text-slate-500 dark:text-slate-400">
        <span>{t('maintenanceForm.laborTotal')}</span>
        <span className="tabular-nums">{formatCurrency(laborVal)}</span>
      </div>
      <div className="flex justify-between items-baseline pt-2 border-t border-slate-200 dark:border-slate-700">
        <span className="font-semibold text-slate-900 dark:text-white">{t('maintenanceForm.total')}</span>
        <span className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{formatCurrency(isEdit ? editPartsTotal + laborVal : total)}</span>
      </div>
    </div>
  )
  const actions = (
    <div className="flex gap-2">
      <button type="button" onClick={cancel}
        className="h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
        {t('maintenanceForm.cancel')}
      </button>
      <button type="button" onClick={submit} disabled={save.isPending || (!isEdit && !d.vehicleId)}
        className="flex-1 h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition">
        {save.isPending ? '…' : t('maintenanceForm.save')}
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={closeKeepingDraft} />
      <div role="dialog" aria-modal="true"
        className="relative w-full max-w-6xl bg-white dark:bg-slate-900 sm:rounded-2xl shadow-2xl flex flex-col sm:max-h-[92vh] overflow-hidden animate-fade-in-up">
        {/* Sarlavha */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{isEdit ? t('maintenanceForm.titleEdit') : t('maintenanceForm.titleNew')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{isEdit ? `${editRecord!.vehicle.registrationNumber} · ${formatDate(editRecord!.installationDate)}` : t('maintenanceForm.subtitle')}</p>
          </div>
          <button onClick={closeKeepingDraft} aria-label="Yopish" className="p-2 -m-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {draftRestored && (
          <div className="flex items-center gap-3 px-6 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300">
            <span className="flex-1">{t('maintenanceForm.draftRestored')}</span>
            <button className="font-semibold hover:underline" onClick={() => { clearDraft(); setD(emptyDraft()); setDraftRestored(false); setWarehouseTouched(false) }}>
              {t('maintenanceForm.draftClear')}
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden grid lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── Chap: mashina va qismlar ── */}
          <div className="lg:overflow-y-auto p-6 space-y-7">
            <section>
              <SectionTitle n={1} title={t('maintenanceForm.sectionVehicle')} />
              {isEdit ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                  <p className="font-mono font-semibold text-slate-900 dark:text-white">{editRecord!.vehicle.registrationNumber}</p>
                  <p className="text-xs text-slate-500">{editRecord!.vehicle.brand} {editRecord!.vehicle.model}</p>
                </div>
              ) : (
                <>
                  <SearchableSelect options={vehicles} value={d.vehicleId} onChange={v => set('vehicleId', v)} placeholder={t('maintenanceForm.vehiclePlaceholder')} />
                  {ctx && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[
                        [t('maintenanceForm.branch'), ctx.vehicle.branchName || '—'],
                        [t('maintenanceForm.currentKm'), `${Math.round(ctx.vehicle.mileage).toLocaleString('uz-UZ')} km`],
                        [t('maintenanceForm.lastService'), ctx.lastMaintenanceDate ? formatDate(ctx.lastMaintenanceDate) : t('maintenanceForm.never')],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                          <p className="text-[11px] text-slate-400">{k}</p>
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            <section>
              <SectionTitle n={2} title={t('maintenanceForm.sectionParts')}
                extra={!isEdit && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{t('maintenanceForm.warehouse')}</span>
                    <div className="relative">
                      <select value={d.warehouseId} onChange={e => changeWarehouse(e.target.value)}
                        className="appearance-none h-8 pl-3 pr-8 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 max-w-[200px]">
                        <option value="">{t('maintenanceForm.warehouseNone')}</option>
                        {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
                )} />

              {isEdit ? (
                <div className="space-y-1.5">
                  {(editRecord!.items?.length ? editRecord!.items : editRecord!.sparePart ? [{ sparePart: editRecord!.sparePart, quantityUsed: editRecord!.quantityUsed || 0, unitCost: 0 }] : []).map((it, i) => (
                    <div key={i} className="flex justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 px-4 py-2.5 text-sm">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{it.sparePart.name}</span>
                      <span className="text-slate-500 tabular-nums">× {it.quantityUsed}{it.unitCost ? ` · ${formatCurrency(Number(it.unitCost) * it.quantityUsed)}` : ''}</span>
                    </div>
                  ))}
                  <p className="text-xs text-slate-400 pt-1">{t('maintenanceForm.readonlyParts')}</p>
                </div>
              ) : (
                <>
                  {otherBranchWarehouse && (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
                      <span className="flex-1">{t('maintenanceForm.warehouseOther', { name: otherBranchWarehouse.name })}</span>
                      <button className="font-semibold hover:underline" onClick={() => changeWarehouse(otherBranchWarehouse.id)}>{t('maintenanceForm.switchWarehouse')}</button>
                    </div>
                  )}
                  <PartPicker parts={parts} loading={invLoading} disabledReason={pickerDisabled} selectedQty={selectedQty} onAdd={addPart} />

                  <div className="mt-4 space-y-2">
                    {!d.lines.length ? (
                      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-6 px-4 text-center">
                        <Package className="w-6 h-6 mx-auto text-slate-300 mb-1.5" />
                        <p className="text-sm text-slate-500">{t('maintenanceForm.partsEmpty')}</p>
                      </div>
                    ) : d.lines.map(l => {
                      const over = l.qty > l.stock
                      const recent = recentParts[l.sparePartId]
                      return (
                        <div key={l.key} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="min-w-0 flex-1 basis-56">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">{l.name}</p>
                              <p className="text-[11px] text-slate-400 font-mono">{l.partCode} · {t('maintenanceForm.stock')}: {l.stock}</p>
                            </div>
                            <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
                              <button type="button" aria-label="-" onClick={() => l.qty > 1 ? updLine(l.key, { qty: l.qty - 1 }) : delLine(l.key)}
                                className="w-8 h-9 grid place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><Minus className="w-3.5 h-3.5" /></button>
                              <input type="number" min={1} value={l.qty}
                                onChange={e => updLine(l.key, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="w-12 h-9 text-center text-sm font-semibold tabular-nums bg-transparent border-x border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white focus:outline-none" />
                              <button type="button" aria-label="+" onClick={() => updLine(l.key, { qty: l.qty + 1 })}
                                className="w-8 h-9 grid place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><Plus className="w-3.5 h-3.5" /></button>
                            </div>
                            <div className="relative w-36">
                              <input type="number" min={0} value={l.unitCost} onChange={e => updLine(l.key, { unitCost: e.target.value })}
                                className={`${inputCls} h-9 pr-12 text-right tabular-nums`} aria-label={t('maintenance.price')} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">so'm</span>
                            </div>
                            <p className="w-32 text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{formatCurrency((Number(l.unitCost) || 0) * l.qty)}</p>
                            <button type="button" onClick={() => delLine(l.key)} aria-label="O'chirish"
                              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></button>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                              <input type="checkbox" checked={l.isTire} className="w-4 h-4 rounded accent-blue-600"
                                onChange={e => updLine(l.key, { isTire: e.target.checked, tireSerial: '', tirePosition: '' })} />
                              {t('maintenance.thisTire')}
                            </label>
                            {over && <span className="text-xs font-medium text-red-600">{t('maintenanceForm.overStock', { n: l.stock })}</span>}
                            {recent && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {t(recent.pending ? 'maintenanceForm.duplicatePending' : 'maintenanceForm.duplicate', { date: formatDate(recent.date) })}
                              </span>
                            )}
                          </div>

                          {l.isTire && (
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input value={l.tireSerial} onChange={e => updLine(l.key, { tireSerial: e.target.value })}
                                placeholder={t('maintenanceForm.tireSerial')} autoFocus
                                className={`${inputCls} h-9 font-mono ${!l.tireSerial.trim() ? 'border-amber-400' : ''}`} />
                              <select value={l.tirePosition} onChange={e => updLine(l.key, { tirePosition: e.target.value })} className={`${inputCls} h-9`}>
                                <option value="">{t('maintenance.positionOptional')}</option>
                                {POSITIONS.map(p => <option key={p} value={p}>{posLabel[p]}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ── O'ng: usta, to'lov, hujjat, jami ── */}
          <aside className="lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 p-6 flex flex-col gap-5">
            <section className="space-y-3">
              <SectionTitle n={3} title={t('maintenanceForm.sectionWorker')} />
              <Field label={t('maintenanceForm.workerName')}>
                <input list="mnt-worker-names" value={d.workerName} onChange={e => set('workerName', e.target.value)} autoComplete="off"
                  placeholder={t('maintenance.workerNamePlaceholder')} className={inputCls} />
                <datalist id="mnt-worker-names">{(workerNames || []).map(w => <option key={w} value={w} />)}</datalist>
              </Field>
              <Field label={t('maintenanceForm.laborCost')}>
                <input type="number" min={0} value={d.laborCost} onChange={e => set('laborCost', e.target.value)} placeholder="0"
                  className={`${inputCls} tabular-nums`} />
              </Field>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('maintenance.paymentType')}</p>
              <Segmented value={d.paymentType} onChange={v => set('paymentType', v)}
                options={[{ value: 'cash', label: t('maintenance.cash'), tone: 'green' }, { value: 'credit', label: t('maintenance.credit'), tone: 'orange' }]} />
              {d.paymentType === 'credit' && (
                <Segmented value={d.isPaid} onChange={v => set('isPaid', v)}
                  options={[{ value: false, label: t('maintenance.unpaid'), tone: 'orange' }, { value: true, label: t('maintenance.paid'), tone: 'green' }]} />
              )}
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('maintenanceForm.sectionDoc')}</p>
              <Segmented value={d.isOfficial} onChange={v => set('isOfficial', v)}
                options={[{ value: true, label: t('maintenance.official'), tone: 'green' }, { value: false, label: t('maintenance.unofficial'), tone: 'orange' }]} />
              <p className="text-[11px] text-slate-400">{d.isOfficial ? t('maintenance.officialHint') : t('maintenance.unofficialFullHint')}</p>
            </section>

            <section>
              <Field label={t('maintenanceForm.sectionDate')} hint={isEdit ? t('maintenanceForm.readonlyFields') : undefined}>
                <input type="datetime-local" value={d.installationDate} disabled={isEdit}
                  onChange={e => set('installationDate', e.target.value)} className={inputCls} />
              </Field>
            </section>

            <section>
              <button type="button" onClick={() => setShowExtra(s => !s)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 py-1">
                {t('maintenanceForm.more')}
                <ChevronDown className={`w-4 h-4 transition-transform ${showExtra ? 'rotate-180' : ''}`} />
              </button>
              {(showExtra || !!d.notes || !!d.supplierId) && (
                <div className="mt-3 space-y-3">
                  {isEdit ? (
                    <Field label={t('maintenance.supplier')}>
                      <input value={editRecord?.supplier?.name || '—'} disabled className={inputCls} />
                    </Field>
                  ) : (
                    <div>
                      <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{t('maintenance.supplier')}</span>
                      <SearchableSelect options={suppliers} value={d.supplierId} onChange={v => set('supplierId', v)} placeholder={t('maintenance.supplierPlaceholder')} />
                    </div>
                  )}
                  <Field label={t('maintenance.notes')}>
                    <textarea rows={3} value={d.notes} onChange={e => set('notes', e.target.value)}
                      className={`${inputCls} h-auto py-2 resize-none`} />
                  </Field>
                </div>
              )}
            </section>

            <div className="hidden lg:block mt-auto pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
              {totals}
              {!isEdit && !isApprover && <p className="text-[11px] text-slate-400">{t('maintenanceForm.pendingNote')}</p>}
              {actions}
            </div>
          </aside>
        </div>

        {/* Telefon: pastda doim ko'rinadigan jami va tugmalar */}
        <div className="lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 space-y-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-500">{t('maintenanceForm.total')}</span>
            <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{formatCurrency(isEdit ? editPartsTotal + laborVal : total)}</span>
          </div>
          {actions}
        </div>
      </div>
    </div>
  )
}
