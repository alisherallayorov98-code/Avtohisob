import { useState, useEffect, useCallback } from 'react'
import { Loader2, Target, Check, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

interface InspectorPlan {
  inspectorId: string
  fullName: string
  target: number | null
  done: number
  note: string | null
}

export default function PlansPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [inspectors, setInspectors] = useState<InspectorPlan[]>([])
  const [loading, setLoading] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const fetchPlans = useCallback(() => {
    setLoading(true)
    ekoApi.get(`/plans?date=${date}`)
      .then(res => {
        const data: InspectorPlan[] = res.data.data?.inspectors ?? []
        setInspectors(data)
        const d: Record<string, string> = {}
        data.forEach(i => { d[i.inspectorId] = i.target != null ? String(i.target) : '' })
        setDrafts(d)
      })
      .catch(() => setInspectors([]))
      .finally(() => setLoading(false))
  }, [date])

  useEffect(() => { fetchPlans() }, [fetchPlans])

  async function savePlan(inspectorId: string) {
    const target = parseInt(drafts[inspectorId] || '0')
    if (isNaN(target) || target < 0) { toast.error('To\'g\'ri son kiriting'); return }
    setSavingId(inspectorId)
    try {
      await ekoApi.post('/plans', { inspectorId, date, targetCount: target })
      toast.success('Plan saqlandi')
      fetchPlans()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSavingId(null)
    }
  }

  const isToday = date === new Date().toISOString().slice(0, 10)

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-green-600" /> Kunlik planlar
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Inspektorlarga topshiriq bering — kuniga nechta tashkilot kiritsin</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-green-600 animate-spin" /></div>
      ) : inspectors.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Inspektor topilmadi</p>
          <p className="text-gray-400 text-sm mt-1">Avval Foydalanuvchilar bo'limidan inspektor qo'shing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inspectors.map(insp => {
            const target = insp.target ?? 0
            const pct = target > 0 ? Math.min(100, Math.round(insp.done * 100 / target)) : 0
            const reached = target > 0 && insp.done >= target
            return (
              <div key={insp.inspectorId} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-gray-900">{insp.fullName}</p>
                  <span className={`text-sm font-semibold ${reached ? 'text-green-600' : 'text-gray-700'}`}>
                    {insp.done} / {insp.target ?? '—'}
                    {reached && ' ✅'}
                  </span>
                </div>

                {target > 0 && (
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all ${reached ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={drafts[insp.inspectorId] ?? ''}
                    onChange={e => setDrafts(d => ({ ...d, [insp.inspectorId]: e.target.value }))}
                    placeholder="Maqsad (nechta tashkilot)"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    onClick={() => savePlan(insp.inspectorId)}
                    disabled={savingId === insp.inspectorId}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
                  >
                    {savingId === insp.inspectorId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Saqlash
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!isToday && (
        <p className="text-xs text-amber-600 text-center">
          ⓘ Tanlangan sana bugun emas — progress o'sha kunda kiritilgan tashkilotlar bo'yicha
        </p>
      )}
    </div>
  )
}
