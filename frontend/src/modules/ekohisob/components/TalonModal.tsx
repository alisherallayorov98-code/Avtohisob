import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Undo2, Trash2, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { ekoKeys, invalidateEko } from '../lib/queries'
import {
  Badge, Banner, Button, DateInput, ErrorState, Field, Input, Modal, MonthInput, MoneyText,
  SkeletonList, useConfirm, f,
} from '../ui'

// Talon rejimidagi tashkilotning bajarilgan ishlari (kub x narx).
export interface TalonEntity {
  id: string
  name: string
  cubicPrice?: number
}

interface Talon {
  id: string
  volume: number
  amount: number
  paidAmount?: number
  date: string
  note?: string | null
  paid: boolean
}

interface TalonList {
  talons: Talon[]
  total: number
  totalUnpaid: number
  totalVolume: number
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function TalonStatus({ t }: { t: Talon }) {
  if (t.paid) return <Badge tone="success">To'langan</Badge>
  if ((t.paidAmount ?? 0) > 0) return <Badge tone="warn">{f.num(t.paidAmount)} / {f.num(t.amount)}</Badge>
  return <Badge tone="danger">To'lanmagan</Badge>
}

export default function TalonModal({ entity, onClose, readOnly = false }: { entity: TalonEntity; onClose: () => void; readOnly?: boolean }) {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [month, setMonth] = useState('')   // '' = barchasi
  const [volume, setVolume] = useState('')
  const [date, setDate] = useState(todayIso)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const list = useQuery<TalonList>({
    queryKey: [...ekoKeys.talons, entity.id, month],
    queryFn: async () => {
      const res = await ekoApi.get('/talons', { params: { entityId: entity.id, ...(month ? { month } : {}) } })
      const d = res.data.data ?? res.data
      return { talons: d.talons ?? [], total: d.total ?? 0, totalUnpaid: d.totalUnpaid ?? 0, totalVolume: d.totalVolume ?? 0 }
    },
  })
  const detail = useQuery({
    queryKey: ['eko', 'entities', 'detail', entity.id, 'cubic'],
    queryFn: async () => (await ekoApi.get(`/entities/${entity.id}`)).data.data,
    staleTime: 60_000,
  })
  const cubicPrice: number = detail.data?.cubicPrice ?? entity.cubicPrice ?? 0
  const preview = volume && cubicPrice ? Math.round(parseFloat(volume) * cubicPrice) : 0

  function changed() { invalidateEko(qc, 'payment') }

  async function addTalon() {
    const v = parseFloat(volume)
    if (!v || v <= 0) { toast.error('Kub (hajm) kiriting'); return }
    setSaving(true)
    try {
      await ekoApi.post('/talons', { entityId: entity.id, volume: v, date, note: note.trim() || undefined })
      toast.success("Talon qo'shildi")
      setVolume(''); setNote('')
      changed()
    } catch (err) { toast.error(errMsg(err)) } finally { setSaving(false) }
  }

  async function accept(t: Talon) {
    const ok = await confirm({
      title: "To'lovni qabul qilish",
      message: `${f.money(t.amount - (t.paidAmount ?? 0))} to'lov qabul qilinsinmi?`,
      consequences: ['Kvitansiya chiqariladi', "Summa kunlik yig'imga qo'shiladi"],
      confirmLabel: 'Qabul qilish',
    })
    if (!ok) return
    setBusyId(t.id)
    try {
      const res = await ekoApi.patch(`/talons/${t.id}`, { paid: true })
      const rn = res.data?.data?.receiptNumber
      toast.success(rn ? `To'lov qabul qilindi · ${rn}` : "To'lov qabul qilindi")
      changed()
    } catch (err) { toast.error(errMsg(err)) } finally { setBusyId(null) }
  }

  async function revert(t: Talon) {
    const r = await confirm.ask({
      title: "To'lovni qaytarish",
      message: `${f.money(t.paidAmount ?? t.amount)} to'lov bekor qilinib, talon qarzga qaytadi.`,
      danger: true,
      consequences: ['Kvitansiya yaroqsiz bo\'ladi', 'Talon qayta to\'lanmagan bo\'ladi', 'Amal jurnalga yoziladi'],
      confirmLabel: "To'lovni qaytarish",
      cancelLabel: 'Ortga',
      reasonRequired: true,
      reasonMinLength: 5,
      reasonLabel: 'Qaytarish sababi',
    })
    if (!r.confirmed) return
    setBusyId(t.id)
    try {
      await ekoApi.patch(`/talons/${t.id}`, { paid: false, reason: r.reason })
      toast.success("To'lov qaytarildi")
      changed()
    } catch (err) { toast.error(errMsg(err)) } finally { setBusyId(null) }
  }

  async function remove(t: Talon) {
    const hasPayment = t.paid || (t.paidAmount ?? 0) > 0
    const r = await confirm.ask({
      title: "Talonni o'chirish",
      message: `${t.volume} m³ · ${f.money(t.amount)} talon o'chiriladi.`,
      danger: true,
      consequences: hasPayment
        ? ["Talon to'langan: bog'langan to'lov ham bekor qilinadi", 'Kvitansiya yaroqsiz bo\'ladi', 'Amal jurnalga yoziladi']
        : ['Amal jurnalga yoziladi'],
      confirmLabel: "O'chirish",
      cancelLabel: 'Ortga',
      reasonRequired: hasPayment,
      reasonMinLength: 5,
      reasonLabel: "O'chirish sababi",
    })
    if (!r.confirmed) return
    setBusyId(t.id)
    try {
      await ekoApi.delete(`/talons/${t.id}`, hasPayment ? { data: { reason: r.reason } } : undefined)
      toast.success("Talon o'chirildi")
      changed()
    } catch (err) { toast.error(errMsg(err)) } finally { setBusyId(null) }
  }

  const d = list.data

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={`Talonlar — ${entity.name}`}
      hint={cubicPrice > 0 ? `Bir kub narxi: ${f.money(cubicPrice)}` : undefined}
    >
      <div className="p-5 space-y-5">
        {!detail.isLoading && cubicPrice <= 0 && (
          <Banner tone="warn">Bir kub narxi belgilanmagan. Avval tashkilot kartochkasida narxni kiriting.</Banner>
        )}

        <div className="flex items-end gap-2 flex-wrap">
          <Field label="Davr (oy)">
            {() => <MonthInput value={month || todayIso().slice(0, 7)} onChange={setMonth} />}
          </Field>
          {month && <Button variant="ghost" onClick={() => setMonth('')}>Barchasi</Button>}
        </div>

        {d && (
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="eko-text-xs text-eko-muted">Jami hajm</dt>
              <dd className="eko-text-base font-semibold eko-num">{d.totalVolume.toFixed(1)} m³</dd></div>
            <div><dt className="eko-text-xs text-eko-muted">Jami summa</dt>
              <dd className="eko-text-base font-semibold"><MoneyText value={d.total} compact /></dd></div>
            <div><dt className="eko-text-xs text-eko-muted">To'lanmagan</dt>
              <dd className="eko-text-base font-semibold"><MoneyText value={d.totalUnpaid} compact /></dd></div>
          </dl>
        )}

        {!readOnly && (
          <section className="border border-eko-line rounded-eko-lg p-4 space-y-3">
            <h3 className="eko-text-base font-medium text-eko-text">Yangi talon (bajarilgan ish)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Sana">
                {id => <DateInput id={id} value={date} onChange={setDate} />}
              </Field>
              <Field label="Kub (m³)">
                {id => <Input id={id} type="number" step="0.1" min="0" inputMode="decimal" value={volume}
                  onChange={e => setVolume(e.target.value)} placeholder="3.5" />}
              </Field>
              <Field label="Summa">
                {() => <p className="eko-control flex items-center eko-num font-medium text-eko-text">{f.num(preview)}</p>}
              </Field>
            </div>
            <Field label="Izoh (ixtiyoriy)">
              {id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />}
            </Field>
            <Button variant="primary" block loading={saving} disabled={cubicPrice <= 0}
              icon={<Plus className="w-4 h-4" aria-hidden />} onClick={addTalon}>
              Talon qo'shish
            </Button>
          </section>
        )}

        <section>
          {list.isLoading && <SkeletonList rows={4} />}
          {list.isError && <ErrorState hint={errMsg(list.error)} onRetry={() => list.refetch()} compact />}
          {d && d.talons.length === 0 && <p className="eko-text-sm text-eko-muted text-center py-6">Bu davrda talon yo'q</p>}
          {d && d.talons.length > 0 && (
            <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg">
              {d.talons.map(t => (
                <li key={t.id} className="px-3 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eko-text-base font-medium text-eko-text">{t.volume} m³ · {f.money(t.amount)}</p>
                      <p className="eko-text-xs text-eko-muted">{f.date(t.date)}{t.note ? ` · ${t.note}` : ''}</p>
                    </div>
                    <TalonStatus t={t} />
                  </div>
                  {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                      {!t.paid && (
                        <Button icon={<Wallet className="w-4 h-4" aria-hidden />} loading={busyId === t.id} onClick={() => accept(t)}>
                          To'lovni qabul qilish
                        </Button>
                      )}
                      {(t.paid || (t.paidAmount ?? 0) > 0) && (
                        <Button icon={<Undo2 className="w-4 h-4" aria-hidden />} loading={busyId === t.id} onClick={() => revert(t)}>
                          To'lovni qaytarish
                        </Button>
                      )}
                      <Button variant="ghost" icon={<Trash2 className="w-4 h-4" aria-hidden />} disabled={busyId === t.id} onClick={() => remove(t)}>
                        O'chirish
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}
