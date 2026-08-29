import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface NewCustomer {
  id: string
  name: string
  phone: string | null
  priceTier: 'retail' | 'wholesale'
}

interface QuickAddCustomerProps {
  onCreated: (customer: NewCustomer) => void
  onCancel: () => void
}

// Sotuv vaqtida yangi mijozni to'xtamasdan qo'shish uchun — mijozlar bazasi
// sotuv jarayonida tabiiy ravishda shakllanadi, oldindan alohida yaratish shart emas.
export default function QuickAddCustomer({ onCreated, onCancel }: QuickAddCustomerProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [priceTier, setPriceTier] = useState<'retail' | 'wholesale'>('retail')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { toast.error('Mijoz nomini kiriting'); return }
    setSaving(true)
    try {
      const res = await savdoApi.post('/customers', {
        name: name.trim(), phone: phone.trim() || null, priceTier,
      })
      toast.success('Mijoz qo\'shildi')
      onCreated(res.data.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Mijoz nomi"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
        />
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Telefon (ixtiyoriy)"
          className="w-36 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
        />
        <select
          value={priceTier}
          onChange={e => setPriceTier(e.target.value as 'retail' | 'wholesale')}
          className="px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
        >
          <option value="retail">Chakana</option>
          <option value="wholesale">Optom</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Saqlash va tanlash
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-xs font-medium"
        >
          Bekor qilish
        </button>
      </div>
    </div>
  )
}
