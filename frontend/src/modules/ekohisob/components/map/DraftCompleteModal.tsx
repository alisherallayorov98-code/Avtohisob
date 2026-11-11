import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { invalidateEko, useMahallas } from '../../lib/queries'
import { Banner, Button, Field, Input, Modal, Select } from '../../ui'
import type { MapEntity } from './useMapEntities'

/** Chala (botdan kelgan) tashkilotni to'liq ma'lumot bilan to'ldirish va faollashtirish. */
export default function DraftCompleteModal({
  entity, onClose, onSaved,
}: { entity: MapEntity; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(entity.name)
  const [stir, setStir] = useState('')
  const [address, setAddress] = useState(entity.address || '')
  const [phone, setPhone] = useState('')
  const [contactName, setContactName] = useState('')
  const [mahallId, setMahallId] = useState('')
  const [districtId, setDistrictId] = useState<string>(entity.districtId ?? '')
  const [monthlyFee, setMonthlyFee] = useState('')
  const [billingMode, setBillingMode] = useState<'variable' | 'monthly_fixed'>('variable')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mahallas = useMahallas(districtId || '')

  useEffect(() => {
    let alive = true
    ekoApi.get(`/entities/${entity.id}`).then(res => {
      if (!alive) return
      const d = res.data.data ?? res.data
      setStir(d.stir || ''); setAddress(d.address || '')
      setPhone(d.phone || ''); setContactName(d.contactName || '')
      setMahallId(d.mahallId || '')
      if (d.districtId) setDistrictId(d.districtId)
      setMonthlyFee(d.monthlyFee ? String(d.monthlyFee) : '')
      setBillingMode(d.billingMode === 'monthly_fixed' ? 'monthly_fixed' : 'variable')
    }).catch(e => { if (alive) setLoadError(errMsg(e)) })
    return () => { alive = false }
  }, [entity.id])

  async function handleSave() {
    if (!name.trim()) { setError('Tashkilot nomini kiriting'); return }
    setSaving(true); setError(null)
    try {
      await ekoApi.put(`/entities/${entity.id}`, {
        name: name.trim(),
        stir: stir.trim() || undefined,
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        contactName: contactName.trim() || undefined,
        mahallId: mahallId || undefined,
        monthlyFee: monthlyFee ? parseInt(monthlyFee.replace(/\D/g, ''), 10) : 0,
        billingMode,
        status: 'active',   // chala → faol
      })
      toast.success("To'ldirildi. Tashkilot faol holatga o'tdi.")
      invalidateEko(qc, 'entity')
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      disableBackdropClose
      size="md"
      title="Ma'lumotlarni to'ldirish"
      hint="Chala tashkilot — botdan kelgan"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button variant="primary" className="flex-1" loading={saving} onClick={handleSave}>Saqlash va faollashtirish</Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {loadError && <Banner tone="warn">Mavjud ma'lumotlarni yuklab bo'lmadi: {loadError}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <Field label="Tashkilot nomi" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="STIR"><Input value={stir} inputMode="numeric" onChange={e => setStir(e.target.value)} placeholder="123456789" /></Field>
        <Field label="Manzil"><Input value={address} onChange={e => setAddress(e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Telefon"><Input value={phone} type="tel" inputMode="tel" onChange={e => setPhone(e.target.value)} placeholder="901234567" /></Field>
          <Field label="Mas'ul shaxs"><Input value={contactName} onChange={e => setContactName(e.target.value)} /></Field>
        </div>
        {(mahallas.data?.length ?? 0) > 0 && (
          <Field label="Mahalla">
            <Select value={mahallId} onChange={e => setMahallId(e.target.value)}>
              <option value="">Tanlang</option>
              {mahallas.data!.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Oylik to'lov (so'm)">
            <Input value={monthlyFee} inputMode="numeric" onChange={e => setMonthlyFee(e.target.value)} placeholder="50000" />
          </Field>
          <Field label="To'lov rejimi">
            <Select value={billingMode} onChange={e => setBillingMode(e.target.value as 'variable' | 'monthly_fixed')}>
              <option value="variable">O'zgaruvchan</option>
              <option value="monthly_fixed">Belgilangan oylik</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}
