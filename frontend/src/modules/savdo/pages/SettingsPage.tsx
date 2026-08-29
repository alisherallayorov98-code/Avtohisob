import { useState, useEffect } from 'react'
import { Loader2, Save, Settings as SettingsIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Settings {
  companyName: string
  stir: string
  address: string
  phone: string
  bankAccount: string
  bankName: string
  director: string
  accountant: string
}

const EMPTY: Settings = {
  companyName: '', stir: '', address: '', phone: '',
  bankAccount: '', bankName: '', director: '', accountant: '',
}

const FIELDS: { key: keyof Settings; label: string }[] = [
  { key: 'companyName', label: "Korxona nomi" },
  { key: 'stir', label: 'STIR' },
  { key: 'address', label: 'Manzil' },
  { key: 'phone', label: 'Telefon' },
  { key: 'bankAccount', label: "Hisob raqami (h/r)" },
  { key: 'bankName', label: 'Bank nomi' },
  { key: 'director', label: 'Direktor F.I.Sh.' },
  { key: 'accountant', label: 'Buxgalter F.I.Sh.' },
]

export default function SettingsPage() {
  const [form, setForm] = useState<Settings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    savdoApi.get('/settings')
      .then(res => {
        const d = res.data.data || {}
        setForm({
          companyName: d.companyName || '', stir: d.stir || '', address: d.address || '',
          phone: d.phone || '', bankAccount: d.bankAccount || '', bankName: d.bankName || '',
          director: d.director || '', accountant: d.accountant || '',
        })
      })
      .catch(() => toast.error('Sozlamalarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await savdoApi.put('/settings', form)
      toast.success('Sozlamalar saqlandi')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-5">
        <SettingsIcon className="w-5 h-5 text-amber-700" />
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Sozlamalar</h1>
          <p className="text-sm text-gray-500">Hisob-faktura hujjatlarida ko'rsatiladigan korxona rekvizitlari</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-xl p-5 max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
            <input
              value={form[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
            />
          </div>
        ))}
        <div className="col-span-full">
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Saqlash
          </button>
        </div>
      </form>
    </div>
  )
}
