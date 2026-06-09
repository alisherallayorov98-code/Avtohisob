import { useState, useEffect, useCallback } from 'react'
import { Wrench, Plus, Pencil, Trash2, Loader2, X, Calendar, Link2, Send, Unlink } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../lib/api'

const WEEKDAYS = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan']
const WEEKDAYS_FULL = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']

interface CareTask {
  id: string
  name: string
  description?: string | null
  weekdays: number[]
  scope: string
  branchId?: string | null
  vehicleIds: string[]
  isActive: boolean
}

interface Branch { id: string; name: string }

const SCOPE_LABEL: Record<string, string> = {
  all: 'Barcha mashinalar',
  branch: 'Filial',
  vehicles: 'Tanlangan mashinalar',
}

const EMPTY: Partial<CareTask> = { name: '', description: '', weekdays: [], scope: 'all', branchId: null, vehicleIds: [] }

export default function VehicleCareTasks() {
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<CareTask>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'tasks' | 'drivers'>('tasks')
  const [vehicles, setVehicles] = useState<any[]>([])
  const [vLoading, setVLoading] = useState(false)
  const [tokenInfo, setTokenInfo] = useState<{ deepLink: string | null; token: string; reg: string } | null>(null)
  const [tokenLoadingId, setTokenLoadingId] = useState<string | null>(null)

  const fetchDrivers = useCallback(() => {
    setVLoading(true)
    api.get('/vehicle-care-tasks/drivers')
      .then(r => setVehicles(r.data.data ?? r.data ?? []))
      .catch(() => setVehicles([]))
      .finally(() => setVLoading(false))
  }, [])

  useEffect(() => { if (tab === 'drivers') fetchDrivers() }, [tab, fetchDrivers])

  async function genToken(v: any) {
    setTokenLoadingId(v.id)
    try {
      const r = await api.post('/vehicle-care-tasks/driver-token', { vehicleId: v.id })
      const d = r.data.data ?? r.data
      setTokenInfo({ deepLink: d.deepLink, token: d.token, reg: d.registrationNumber })
    } catch (e) { toast.error(apiErrorMessage(e)) }
    finally { setTokenLoadingId(null) }
  }

  async function unlinkDriver(v: any) {
    if (!window.confirm(`${v.registrationNumber} — haydovchi bog'lanishini uzasizmi?`)) return
    try {
      await api.delete(`/vehicle-care-tasks/driver/${v.id}`)
      toast.success('Uzildi')
      fetchDrivers()
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  const fetchTasks = useCallback(() => {
    setLoading(true)
    api.get('/vehicle-care-tasks')
      .then(r => setTasks(r.data.data ?? r.data ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchTasks()
    api.get('/branches').then(r => setBranches(r.data.data ?? r.data ?? [])).catch(() => {})
  }, [fetchTasks])

  function openNew() { setEditId(null); setForm(EMPTY); setModalOpen(true) }
  function openEdit(t: CareTask) {
    setEditId(t.id)
    setForm({ name: t.name, description: t.description || '', weekdays: t.weekdays, scope: t.scope, branchId: t.branchId, vehicleIds: t.vehicleIds })
    setModalOpen(true)
  }

  function toggleDay(d: number) {
    setForm(f => {
      const days = f.weekdays || []
      return { ...f, weekdays: days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort() }
    })
  }

  async function save() {
    if (!form.name?.trim()) { toast.error('Vazifa nomini kiriting'); return }
    if (!form.weekdays || form.weekdays.length === 0) { toast.error('Kamida bitta kun tanlang'); return }
    if (form.scope === 'branch' && !form.branchId) { toast.error('Filialni tanlang'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        weekdays: form.weekdays,
        scope: form.scope,
        branchId: form.scope === 'branch' ? form.branchId : null,
        vehicleIds: form.vehicleIds || [],
      }
      if (editId) await api.put(`/vehicle-care-tasks/${editId}`, payload)
      else await api.post('/vehicle-care-tasks', payload)
      toast.success(editId ? 'Yangilandi' : 'Vazifa yaratildi')
      setModalOpen(false)
      fetchTasks()
    } catch (e) { toast.error(apiErrorMessage(e)) }
    finally { setSaving(false) }
  }

  async function toggleActive(t: CareTask) {
    try {
      await api.put(`/vehicle-care-tasks/${t.id}`, { isActive: !t.isActive })
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, isActive: !x.isActive } : x))
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function remove(t: CareTask) {
    if (!window.confirm(`"${t.name}" vazifasini o'chirasizmi?`)) return
    try {
      await api.delete(`/vehicle-care-tasks/${t.id}`)
      toast.success('O\'chirildi')
      setTasks(ts => ts.filter(x => x.id !== t.id))
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Wrench className="w-6 h-6 text-blue-600" /> Texnik parvarish
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm">Davriy vazifalar (havo filtri, smazka...) — haydovchiga bot orqali eslatiladi</p>
      </div>

      {/* Tab */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
          <button onClick={() => setTab('tasks')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'tasks' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}>Vazifalar</button>
          <button onClick={() => setTab('drivers')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'drivers' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}>Haydovchilar</button>
        </div>
        {tab === 'tasks' && (
          <button onClick={openNew} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Yangi vazifa
          </button>
        )}
      </div>

      {/* ── Haydovchilar tab ── */}
      {tab === 'drivers' && (
        vLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-blue-600 animate-spin" /></div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center border border-gray-200 dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">Mashina topilmadi</p>
          </div>
        ) : (
          <div className="space-y-2">
            {vehicles.map(v => (
              <div key={v.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white font-mono">{v.registrationNumber}</p>
                  <p className="text-xs text-gray-500">{v.brand} {v.model}</p>
                  {v.careDriver ? (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">📱 {v.careDriver.tgUsername ? '@' + v.careDriver.tgUsername : (v.careDriver.driverName || 'ulangan')}</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">Haydovchi ulanmagan</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => genToken(v)} disabled={tokenLoadingId === v.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-gray-700 disabled:opacity-50">
                    {tokenLoadingId === v.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    {v.careDriver ? 'Qayta ulash' : 'Biriktirish'}
                  </button>
                  {v.careDriver && (
                    <button onClick={() => unlinkDriver(v)} title="Uzish" className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-gray-700"><Unlink className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Vazifalar tab ── */}
      {tab === 'tasks' && (loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-blue-600 animate-spin" /></div>
      ) : tasks.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 text-center border border-gray-200 dark:border-gray-700">
          <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Hali vazifa yo'q</p>
          <p className="text-gray-400 text-sm mt-1">"Yangi vazifa" bilan birinchisini qo'shing (masalan: Havo filtrini tozalash — Chor, Shan)</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className={`bg-white dark:bg-gray-800 rounded-xl p-4 border ${t.isActive ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white">{t.name}</p>
                  {t.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</p>}
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                      <Calendar className="w-3 h-3" /> {t.weekdays.map(d => WEEKDAYS[d]).join(', ')}
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                      {SCOPE_LABEL[t.scope]}{t.scope === 'branch' ? `: ${branches.find(b => b.id === t.branchId)?.name || '—'}` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(t)} title={t.isActive ? 'Faol — o\'chirish' : 'Yoqish'}
                    className={`text-xs px-2 py-1 rounded-lg font-medium ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {t.isActive ? 'Faol' : 'O\'chiq'}
                  </button>
                  <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-gray-700"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(t)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-gray-700"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">{editId ? 'Vazifani tahrirlash' : 'Yangi vazifa'}</h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X className="w-4 h-4 text-gray-500" /></button>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Vazifa nomi</label>
              <input type="text" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Havo filtrini tozalash" autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Izoh (ixtiyoriy)</label>
              <input type="text" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Changli yo'lda haftada 2 marta"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5">Qaysi kunlar bajariladi?</label>
              <div className="flex gap-1.5 flex-wrap">
                {WEEKDAYS.map((d, i) => {
                  const on = (form.weekdays || []).includes(i)
                  return (
                    <button key={i} type="button" onClick={() => toggleDay(i)} title={WEEKDAYS_FULL[i]}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${on ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Qamrov</label>
              <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="all">Barcha mashinalar</option>
                <option value="branch">Bitta filial</option>
              </select>
            </div>

            {form.scope === 'branch' && (
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Filial</label>
                <select value={form.branchId || ''} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  <option value="">— tanlang —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Bekor</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token (haydovchini ulash) modal */}
      {tokenInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTokenInfo(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">Haydovchini ulash</h3>
              <button onClick={() => setTokenInfo(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              🚗 <b className="font-mono">{tokenInfo.reg}</b> mashinasi uchun. Haydovchiga quyidagi havolani yuboring — u bossa, boti aynan shu mashinaga ulanadi.
            </p>
            {tokenInfo.deepLink ? (
              <a href={tokenInfo.deepLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
                <Send className="w-4 h-4" /> Telegram'da ochish va ulash
              </a>
            ) : (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
                ⚠️ Bot sozlanmagan (CARE_BOT_TOKEN). Havola yaratilmadi — quyidagi kodni qo'lda yuboring.
              </div>
            )}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Yoki qo'lda — botga yuboring:</p>
              <code className="text-sm font-mono text-gray-800 dark:text-gray-200 break-all">/start {tokenInfo.token}</code>
            </div>
            <p className="text-xs text-gray-400">Havola 30 kun amal qiladi va bir marta ishlatiladi.</p>
          </div>
        </div>
      )}
    </div>
  )
}
