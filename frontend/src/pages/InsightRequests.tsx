// Filial mas'uli uchun "Tahlil": faqat markaz (admin) yuborgan so'rovlar.
// Javob: ma'lumotni kiritish (savol o'zi yopiladi) yoki matnli javob.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Inbox, Send, PenLine, Calculator, ArrowRight, Clock, CheckCircle2 } from 'lucide-react'
import api from '../lib/api'
import { cn, formatDate } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import Button from '../components/ui/Button'
import QuickForm from '../components/insights/QuickForm'
import { MiniTable, type Finding } from '../components/insights/parts'
import { Thread, REQ_STATUS, isOverdue, type InsightRequestRow } from '../components/insights/RequestParts'

const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || 'Xatolik'

/** Mavjud API ruxsatlari: mashina/dvigatel/moy formalari filial rahbari va menejer uchun (operator — faqat matnli javob) */
const CAN_FORM = ['manager', 'branch_manager']

function RequestCard({ r, canForm }: { r: InsightRequestRow; canForm: boolean }) {
  const qc = useQueryClient()
  const [panel, setPanel] = useState<'quick' | 'evidence' | null>(null)
  const [text, setText] = useState('')
  const active = r.status === 'open' || r.status === 'answered'
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['insight-requests-mine'] })
    qc.invalidateQueries({ queryKey: ['insight-badge'] })
  }

  const answer = useMutation({
    mutationFn: () => api.post(`/insight-requests/${r.id}/answer`, { text }),
    onSuccess: () => { toast.success('Javob markazga yuborildi'); setText(''); refresh() },
    onError: (e) => toast.error(errText(e)),
  })

  const afterQuickSave = async () => {
    setPanel(null)
    try {
      const res = await api.post(`/insight-requests/${r.id}/recheck`)
      if (res.data.data.resolved) toast.success("Ma'lumot kiritildi — savol hal bo'ldi")
      else toast("Saqlandi. Savol hali to'liq hal bo'lmadi — kerak bo'lsa izoh yozing.", { icon: 'ℹ️' })
    } catch { /* qayta tekshirish xatosi — ro'yxat baribir yangilanadi */ }
    refresh()
  }

  const pseudoFinding = { quick: r.quick, vehicleId: r.vehicleId } as unknown as Finding
  const btn = 'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors'

  return (
    <div className={cn('glass-card rounded-xl p-4 space-y-2 border-l-4',
      r.status === 'open' ? (isOverdue(r) ? 'border-l-red-500' : 'border-l-amber-500') : r.status === 'answered' ? 'border-l-violet-500' : 'border-l-emerald-500')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', REQ_STATUS[r.status].cls)}>
          {r.status === 'answered' ? "Javob berildi — markaz ko'rib chiqadi" : REQ_STATUS[r.status].label}
        </span>
        {r.plate && <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{r.plate}</span>}
        {r.dueDate && (
          <span className={cn('inline-flex items-center gap-1 text-xs', isOverdue(r) ? 'text-red-600 font-semibold' : 'text-gray-500')}>
            <Clock className="w-3 h-3" /> Muddat: {formatDate(r.dueDate)}{isOverdue(r) && " — o'tib ketdi"}
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">{formatDate(r.createdAt)}</span>
      </div>
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{r.title}</p>
      <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{r.detail}</p>
      <Thread messages={r.messages} />

      {active && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {r.quick && r.vehicleId && canForm && (
            <button onClick={() => setPanel(p => (p === 'quick' ? null : 'quick'))} className={cn(btn, 'bg-blue-600 text-white hover:bg-blue-700')}>
              <PenLine className="w-3 h-3" /> Ma'lumotni kiritish
            </button>
          )}
          {r.evidence && r.evidence.rows?.length > 0 && (
            <button onClick={() => setPanel(p => (p === 'evidence' ? null : 'evidence'))} className={cn(btn, 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700')}>
              <Calculator className="w-3 h-3" /> Dalil
            </button>
          )}
          {r.actionPath && (
            <Link to={r.actionPath} className={cn(btn, 'border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800')}>
              Bo'limga o'tish <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}
      {panel === 'quick' && r.quick && <QuickForm finding={pseudoFinding} onCancel={() => setPanel(null)} onDone={afterQuickSave} />}
      {panel === 'evidence' && r.evidence && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 max-h-80 overflow-y-auto">
          {r.evidence.note && <p className="text-xs text-gray-500 mb-2">{r.evidence.note}</p>}
          <MiniTable columns={r.evidence.columns} rows={r.evidence.rows} />
        </div>
      )}

      {r.status === 'open' && (
        <div className="space-y-2 pt-1">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={2000}
            placeholder="Javobingiz: nima bo'lgan, nega kiritilmagan, nima qilindi..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
          <div className="flex justify-end">
            <Button size="sm" icon={<Send className="w-3.5 h-3.5" />} loading={answer.isPending} disabled={text.trim().length < 3} onClick={() => answer.mutate()}>
              Javob yuborish
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function InsightRequests() {
  const role = useAuthStore(s => s.user?.role ?? '')
  const canForm = CAN_FORM.includes(role)
  const [showDone, setShowDone] = useState(false)
  const { data = [], isLoading } = useQuery<InsightRequestRow[]>({
    queryKey: ['insight-requests-mine'],
    queryFn: () => api.get('/insight-requests/mine').then(r => r.data.data),
    refetchInterval: 60_000,
  })
  const open = data.filter(r => r.status === 'open')
    .sort((a, b) => (isOverdue(b) ? 1 : 0) - (isOverdue(a) ? 1 : 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const rest = data.filter(r => r.status !== 'open')

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0"><Inbox className="w-6 h-6" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tahlil — markaz savollari</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Markaz tahlilda aniqlagan va sizdan aniqlashtirishni so'ragan savollar. Ma'lumotni kiriting yoki javob yozing.
          </p>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-gray-500 text-center py-8">Yuklanmoqda...</p> : (
        <>
          {open.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <CheckCircle2 className="w-10 h-10 mx-auto text-green-500 mb-2" />
              <p className="font-semibold text-gray-900 dark:text-white">Javob kutayotgan savol yo'q</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Javob kutilmoqda ({open.length})</h2>
              {open.map(r => <RequestCard key={r.id} r={r} canForm={canForm} />)}
            </div>
          )}

          {rest.length > 0 && (
            <div className="space-y-3">
              <button onClick={() => setShowDone(s => !s)} className="text-sm text-gray-500 hover:text-blue-600">
                {showDone ? '▲' : '▼'} Javob berilgan va yopilganlar ({rest.length})
              </button>
              {showDone && rest.map(r => <RequestCard key={r.id} r={r} canForm={canForm} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
