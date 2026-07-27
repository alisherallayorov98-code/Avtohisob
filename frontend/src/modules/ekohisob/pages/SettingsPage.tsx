import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Settings as SettingsIcon, Loader2, Save, MessageSquare, TrendingUp,
  AlertTriangle, ShieldAlert, Info, Ban, FileSignature,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import DataHealthPanel from '../components/reports/DataHealthPanel'
import { date as fmtDate } from '../ui/format'

interface EscalationRule {
  level: string
  smsEnabled: boolean
  notifyInspector: boolean
  notifyManager: boolean
  suggestBlacklist: boolean
  isActive: boolean
}

interface SmsPreview {
  text: string
  chars: number
  unicode: boolean
  segments: number
  issues?: { level: 'error' | 'warning'; message: string }[]
}

// Rasmiy hujjatlarda (akt sverka, faktura) chiqadigan korxona rekvizitlari
interface RequisiteField {
  key: 'orgOfficialName' | 'orgStir' | 'orgPhone' | 'orgAddress' | 'orgBankAccount'
     | 'orgBankName' | 'orgMfo' | 'orgDirector' | 'orgAccountant'
  label: string
  placeholder: string
  /** Ikki ustunni egallaydi (uzun matn) */
  wide?: boolean
}

const REQUISITE_FIELDS: RequisiteField[] = [
  { key: 'orgOfficialName', label: 'Rasmiy nomi', placeholder: '"Toshkent Tozalik" MChJ', wide: true },
  { key: 'orgStir', label: 'STIR', placeholder: '123456789' },
  { key: 'orgPhone', label: 'Telefon', placeholder: '712001020' },
  { key: 'orgAddress', label: 'Manzil', placeholder: 'Toshkent sh., Chilonzor t., 1-uy', wide: true },
  { key: 'orgBankAccount', label: 'Hisob raqami', placeholder: '2020 8000 1234 5678 9001' },
  { key: 'orgBankName', label: 'Bank', placeholder: 'Ipoteka Bank, Chilonzor filiali' },
  { key: 'orgMfo', label: 'MFO', placeholder: '00401' },
  { key: 'orgDirector', label: 'Rahbar (imzo uchun)', placeholder: 'A. Aliyev' },
  { key: 'orgAccountant', label: 'Bosh hisobchi', placeholder: 'B. Karimov' },
]

type RequisiteKey = RequisiteField['key']

interface SettingsData extends Partial<Record<RequisiteKey, string | null>> {
  smsMonthlyLimit: number
  smsMonthlyLimitEditable: boolean
  smsConfigured: boolean
  smsAutoEnabled: boolean
  smsAutoDay: number
  smsAutoMinLevel: string
  smsDailyMax: number
  smsTemplate: string | null
  smsTemplateDefault: string
  smsPlaceholders: string[]
  smsPreview: SmsPreview
  contactPhone: string | null
  escalationEnabled: boolean
  escalationRules: EscalationRule[]
}

interface Suggestion {
  id: string
  name: string
  district: string | null
  mahalla: string | null
  debtLevel: string
  debtAmount: number
  debtMonths: number
  suggestedAt: string | null
}

const LEVEL_LABEL: Record<string, string> = {
  warning: '1 oy kechikish',
  overdue: '2 oy kechikish',
  critical: '3+ oy (kritik)',
}

const fmt = (n: number) => n.toLocaleString('uz-UZ')

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [rules, setRules] = useState<EscalationRule[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<SmsPreview | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    ekoApi.get('/settings')
      .then(res => {
        const d: SettingsData = res.data.data
        setData(d)
        setRules(d.escalationRules ?? [])
        setPreview(d.smsPreview ?? null)
      })
      .catch(() => toast.error('Sozlamalarni yuklashda xato'))
      .finally(() => setLoading(false))
    ekoApi.get('/settings/blacklist-suggestions')
      .then(res => setSuggestions(res.data.data ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])

  function patch(k: keyof SettingsData, v: any) {
    setData(d => (d ? { ...d, [k]: v } : d))
  }

  // Shablon yozilayotganda jonli oldindan ko'rish (necha SMS ketishi bilan)
  function refreshPreview(template: string | null, contactPhone: string | null) {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      ekoApi.post('/settings/sms-preview', { smsTemplate: template, contactPhone })
        .then(res => setPreview(res.data.data))
        .catch(() => {})
    }, 400)
  }

  function setRule(level: string, key: keyof EscalationRule, value: boolean) {
    setRules(rs => rs.map(r => (r.level === level ? { ...r, [key]: value } : r)))
  }

  async function save() {
    if (!data) return
    setSaving(true)
    try {
      const requisites = Object.fromEntries(
        REQUISITE_FIELDS.map(f => [f.key, data[f.key] ?? null]),
      )
      await ekoApi.put('/settings', {
        ...requisites,
        smsAutoEnabled: data.smsAutoEnabled,
        smsAutoDay: data.smsAutoDay,
        smsAutoMinLevel: data.smsAutoMinLevel,
        smsDailyMax: data.smsDailyMax,
        smsTemplate: data.smsTemplate,
        contactPhone: data.contactPhone,
        escalationEnabled: data.escalationEnabled,
        escalationRules: rules,
      })
      toast.success('Sozlamalar saqlandi')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Saqlashda xato')
    } finally { setSaving(false) }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-green-600" /></div>
  }
  if (!data) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">Ma'lumot yuklanmadi</div>
  }

  const hasError = preview?.issues?.some(i => i.level === 'error')

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-green-700" />
          <div>
            <h1 className="text-lg font-bold text-gray-800">Sozlamalar</h1>
            <p className="text-xs text-gray-500">Avtomatik eslatma va qarz eskalatsiyasi</p>
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || hasError}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Saqlash
        </button>
      </div>

      {!data.smsConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-800">
            SMS xizmati (Eskiz.uz) hali sozlanmagan — quyidagi sozlamalar saqlanadi,
            lekin SMS yuborilmaydi. Ulash uchun bog'laning.
          </p>
        </div>
      )}

      {/* Ma'lumot sog'ligi — avtomatlashtirishni bloklayotgan bo'sh maydonlar */}
      <DataHealthPanel />

      {/* ── Korxona rekvizitlari ── */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-green-600" />
          <h2 className="font-semibold text-gray-800">Korxona rekvizitlari</h2>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Akt sverka va fakturada xizmat ko'rsatuvchi tomon sifatida chiqadi.
          To'ldirilmasa hujjat rasmiy kuchga ega bo'lmaydi.
        </p>

        {!data.orgOfficialName && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-amber-800">
              Rekvizitlar hali kiritilmagan — hozir chop etilgan akt sverkada
              korxona nomi o'rniga "—" chiqadi.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {REQUISITE_FIELDS.map(fld => (
            <div key={fld.key} className={fld.wide ? 'sm:col-span-2' : undefined}>
              <label className="text-xs text-gray-500 block mb-1">{fld.label}</label>
              <input
                type="text"
                value={data[fld.key] ?? ''}
                onChange={e => patch(fld.key as keyof SettingsData, e.target.value)}
                placeholder={fld.placeholder}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Avtomatik SMS ── */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-green-600" />
          <h2 className="font-semibold text-gray-800">Avtomatik SMS eslatma</h2>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox" checked={data.smsAutoEnabled}
            onChange={e => patch('smsAutoEnabled', e.target.checked)}
            className="w-4 h-4 accent-green-600"
          />
          <span className="text-sm text-gray-700">
            Har oy avtomatik eslatma yuborilsin
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Oyning qaysi kuni</label>
            <input
              type="number" min={1} max={28} value={data.smsAutoDay}
              onChange={e => patch('smsAutoDay', parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">1–28 (fevralda ham ishlashi uchun)</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Kimga yuborilsin</label>
            <select
              value={data.smsAutoMinLevel}
              onChange={e => patch('smsAutoMinLevel', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="warning">1 oy va undan ko'p qarzdorlarga</option>
              <option value="overdue">2 oy va undan ko'p qarzdorlarga</option>
              <option value="critical">Faqat 3+ oy qarzdorlarga</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Kuniga maksimal</label>
            <input
              type="number" min={1} max={5000} value={data.smsDailyMax}
              onChange={e => patch('smsDailyMax', parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">
              Oylik limit: {fmt(data.smsMonthlyLimit)} (o'zgartirib bo'lmaydi)
            </p>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1">Aloqa raqami (SMS matnida)</label>
          <input
            type="text" value={data.contactPhone ?? ''}
            onChange={e => { patch('contactPhone', e.target.value); refreshPreview(data.smsTemplate, e.target.value) }}
            placeholder="901234567"
            className="w-full sm:w-64 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Shablon */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">SMS matni</label>
            <button
              onClick={() => { patch('smsTemplate', null); refreshPreview(null, data.contactPhone) }}
              className="text-xs text-gray-400 hover:text-gray-700 underline"
            >
              Standart matnga qaytarish
            </button>
          </div>
          <textarea
            rows={3}
            value={data.smsTemplate ?? data.smsTemplateDefault}
            onChange={e => { patch('smsTemplate', e.target.value); refreshPreview(e.target.value, data.contactPhone) }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            O'rin egallovchilar: {data.smsPlaceholders.map(p => `{${p}}`).join(', ')}
          </p>
        </div>

        {/* Jonli oldindan ko'rish */}
        {preview && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500">Namuna (qarzdor shu matnni oladi):</p>
            <p className="text-sm text-gray-800 bg-white rounded-lg p-2.5 border border-gray-200">{preview.text}</p>
            <p className="text-xs text-gray-500">
              {preview.chars} belgi · <b>{preview.segments} ta SMS</b>
              {preview.unicode && ' · kirill/maxsus belgi (70 belgi/SMS)'}
            </p>
            {preview.issues?.map((i, idx) => (
              <p key={idx} className={`text-xs flex items-start gap-1.5 ${i.level === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {i.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-gray-500 bg-blue-50 rounded-lg p-3">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <p>
            Eskiz.uz real rejimida faqat <b>oldindan tasdiqlangan</b> matn yuboriladi.
            Shablonni o'zgartirsangiz, yangi matnni Eskiz.uz kabinetida qayta tasdiqlatish
            kerak — aks holda SMS yuborilmaydi.
          </p>
        </div>
      </section>

      {/* ── Eskalatsiya ── */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" />
          <h2 className="font-semibold text-gray-800">Qarz eskalatsiyasi</h2>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox" checked={data.escalationEnabled}
            onChange={e => patch('escalationEnabled', e.target.checked)}
            className="w-4 h-4 accent-green-600"
          />
          <span className="text-sm text-gray-700">
            Qarz darajasi oshganda avtomatik chora ko'rilsin
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="text-left py-2">Daraja</th>
                <th className="py-2">Tashkilotga SMS</th>
                <th className="py-2">Inspektorga xabar</th>
                <th className="py-2">Rahbar xulosasi</th>
                <th className="py-2">Qora ro'yxat tavsiyasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rules.filter(r => LEVEL_LABEL[r.level]).map(r => (
                <tr key={r.level}>
                  <td className="py-2.5 font-medium text-gray-700">{LEVEL_LABEL[r.level]}</td>
                  {(['smsEnabled', 'notifyInspector', 'notifyManager', 'suggestBlacklist'] as const).map(k => (
                    <td key={k} className="text-center py-2.5">
                      <input
                        type="checkbox" checked={r[k]}
                        disabled={!data.escalationEnabled}
                        onChange={e => setRule(r.level, k, e.target.checked)}
                        className="w-4 h-4 accent-green-600 disabled:opacity-40"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-start gap-2 text-xs text-gray-500 bg-blue-50 rounded-lg p-3">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <p>
            Chora faqat daraja <b>oshganda</b> va har daraja uchun <b>bir marta</b> ko'riladi.
            Tashkilot qarzini to'lasa hisob nolga qaytadi — keyin yana qarzdor bo'lsa
            eslatma qaytadan boradi. Qora ro'yxatga <b>avtomatik qo'shilmaydi</b>:
            tizim faqat tavsiya qiladi, qaror sizda qoladi.
          </p>
        </div>
      </section>

      {/* ── Qora ro'yxat tavsiyalari ── */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-600" />
          <h2 className="font-semibold text-gray-800">Qora ro'yxatga tavsiya etiladi</h2>
          {suggestions.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {suggestions.length} ta
            </span>
          )}
        </div>
        {suggestions.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            Hozircha tavsiya yo'q — kritik darajaga yetgan tashkilot topilmadi
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {suggestions.map(s => (
              <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
                  <p className="text-xs text-gray-400">
                    {[s.district, s.mahalla].filter(Boolean).join(' / ') || '—'} · {s.debtMonths} oy qarzdor
                    {s.suggestedAt && ` · ${fmtDate(s.suggestedAt)} dan beri`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-red-600">{fmt(s.debtAmount)} so'm</p>
                  <p className="text-[11px] text-gray-400 flex items-center gap-1 justify-end">
                    <Ban className="w-3 h-3" /> Tashkilotlar sahifasida qo'shing
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
