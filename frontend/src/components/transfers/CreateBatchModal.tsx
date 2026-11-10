import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, PackageOpen, Send, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { useAuthStore } from '../../stores/authStore'
import Modal from '../ui/Modal'
import SearchableSelect from '../ui/SearchableSelect'
import PartPicker, { InventoryPart } from '../maintenance/PartPicker'

interface Line { part: InventoryPart; qty: string }

const LAST_TO_KEY = 'trfLastTo'
const readLastTo = () => { try { return localStorage.getItem(LAST_TO_KEY) || '' } catch { return '' } }

/** Jo'natma yaratish: "Qayerdan" foydalanuvchi omboridan o'zi tanlanadi, qism qidiruvi lotin/kirill, miqdor zaxiradan oshmaydi. */
export default function CreateBatchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [fromWh, setFromWh] = useState('')
  const [toWh, setToWh] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data as any[]),
    enabled: open,
  })
  const { data: branchesData } = useQuery({
    queryKey: ['branches-for-transfer'],
    queryFn: () => api.get('/branches').then(r => r.data.data as any[]),
    enabled: open,
  })
  const { data: inventoryData, isLoading: invLoading } = useQuery({
    queryKey: ['inventory-warehouse-all', fromWh],
    queryFn: () => api.get('/inventory', { params: { warehouseId: fromWh, select: 'true' } }).then(r => r.data.data),
    enabled: open && !!fromWh,
  })

  const warehouses = useMemo(() => (warehousesData || []).filter((w: any) => w.isActive !== false).map((w: any) => ({ value: w.id, label: w.name })), [warehousesData])
  const myWarehouse: string = useMemo(
    () => (branchesData || []).find((b: any) => b.id === user?.branchId)?.warehouse?.id || '',
    [branchesData, user?.branchId],
  )

  // Ochilganda: "Qayerdan" — o'z filial omborim, "Qayerga" — oxirgi ishlatilgan
  useEffect(() => {
    if (!open) return
    setLines([]); setNotes('')
    setToWh(readLastTo())
  }, [open])
  useEffect(() => {
    if (open && !fromWh && myWarehouse) setFromWh(myWarehouse)
  }, [open, myWarehouse]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (toWh && toWh === fromWh) setToWh('') }, [fromWh]) // eslint-disable-line react-hooks/exhaustive-deps

  const parts: InventoryPart[] = useMemo(() => (inventoryData || [])
    .filter((inv: any) => inv.warehouseId === fromWh || inv.warehouse?.id === fromWh)
    .map((inv: any) => ({
      sparePartId: inv.sparePart.id, name: inv.sparePart.name, partCode: inv.sparePart.partCode,
      stock: inv.quantityOnHand, unitPrice: Number(inv.sparePart.unitPrice) || 0,
    }))
    .filter((p: InventoryPart) => p.stock > 0)
    .sort((a: InventoryPart, b: InventoryPart) => a.name.localeCompare(b.name)), [inventoryData, fromWh])

  const selectedQty = useMemo(() => Object.fromEntries(lines.map(l => [l.part.sparePartId, Number(l.qty) || 0])), [lines])

  const addPart = (p: InventoryPart) => setLines(prev => {
    const ex = prev.find(l => l.part.sparePartId === p.sparePartId)
    if (ex) return prev.map(l => l === ex ? { ...l, qty: String(Math.min(p.stock, (Number(l.qty) || 0) + 1)) } : l)
    return [...prev, { part: p, qty: '1' }]
  })
  const setQty = (id: string, v: string) => setLines(prev => prev.map(l => l.part.sparePartId === id ? { ...l, qty: v } : l))
  const clampQty = (id: string) => setLines(prev => prev.map(l => {
    if (l.part.sparePartId !== id) return l
    const n = Math.floor(Number(l.qty))
    return { ...l, qty: String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, l.part.stock)) }
  }))
  const changeFrom = (id: string) => {
    if (id === fromWh) return
    if (lines.length) toast('Ombor o\'zgargani uchun qismlar ro\'yxati tozalandi', { icon: 'ℹ️' })
    setFromWh(id); setLines([])
  }

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * l.part.unitPrice, 0)
  const bad = lines.some(l => !Number.isInteger(Number(l.qty)) || Number(l.qty) < 1 || Number(l.qty) > l.part.stock)
  const canSubmit = !!fromWh && !!toWh && lines.length > 0 && !bad

  const create = useMutation({
    mutationFn: () => api.post('/batches', {
      fromWarehouseId: fromWh, toWarehouseId: toWh, notes: notes.trim() || undefined,
      items: lines.map(l => ({ sparePartId: l.part.sparePartId, quantity: Number(l.qty) })),
    }),
    onSuccess: (res) => {
      try { localStorage.setItem(LAST_TO_KEY, toWh) } catch { /* bo'sh */ }
      toast.success(res.data?.message || "Jo'natma yaratildi")
      qc.invalidateQueries({ queryKey: ['batches'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const pickerDisabled = !fromWh ? 'Avval «Qayerdan» omborni tanlang' : undefined

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Jo'natma yaratish"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {lines.length > 0 && <>Jami: <b className="text-gray-900 dark:text-white">{formatCurrency(total)}</b> · {lines.length} xil qism</>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-10 px-4 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">Bekor qilish</button>
            <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}
              className="h-10 px-5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Jo'natma yaratish
            </button>
          </div>
        </div>
      }>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <SearchableSelect label="Qayerdan *" options={warehouses} value={fromWh} onChange={changeFrom} placeholder="Manba ombor…" />
          <ArrowRight className="hidden sm:block w-5 h-5 text-gray-400 mb-2.5" />
          <SearchableSelect label="Qayerga *" options={warehouses.filter((w: any) => w.value !== fromWh)} value={toWh} onChange={setToWh} placeholder="Qabul qiluvchi ombor…" />
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Ehtiyot qismlar</p>
          <PartPicker parts={parts} loading={invLoading && !!fromWh} disabledReason={pickerDisabled} selectedQty={selectedQty} onAdd={addPart} />

          {lines.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 py-8 text-center text-sm text-gray-400">
              <PackageOpen className="w-8 h-8 mx-auto mb-1.5 opacity-40" />
              Qism tanlanmagan. Yuqoridan qidirib qo'shing.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {lines.map(l => {
                const n = Number(l.qty) || 0
                const over = n > l.part.stock
                return (
                  <div key={l.part.sparePartId} className={`flex items-center gap-3 rounded-xl border p-3 ${over ? 'border-red-300 bg-red-50 dark:bg-red-900/10 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">{l.part.name}</p>
                      <p className="text-[11px] text-gray-400"><span className="font-mono">{l.part.partCode}</span> · omborda {l.part.stock} ta · {formatCurrency(l.part.unitPrice)}</p>
                    </div>
                    <input type="number" min={1} max={l.part.stock} value={l.qty}
                      onChange={e => setQty(l.part.sparePartId, e.target.value)} onBlur={() => clampQty(l.part.sparePartId)}
                      className="w-20 h-9 px-2 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="w-28 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white hidden sm:block">{formatCurrency(n * l.part.unitPrice)}</p>
                    <button onClick={() => setLines(prev => prev.filter(x => x !== l))} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Izoh</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ixtiyoriy…"
            className="mt-1 w-full h-10 px-3 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </Modal>
  )
}
