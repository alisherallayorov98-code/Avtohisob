// Robotga savol berish: "30 574 OBA qachon motor remont bo'lgan?"
// Javob serverda qoidalar bilan, aniq yozuvlardan hisoblanadi (tashqi AI yo'q).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Send, MessageCircleQuestion, ChevronDown, X, Bot } from 'lucide-react'
import api from '../../lib/api'
import { cn } from '../../lib/utils'
import { MiniTable } from './parts'

interface Answer {
  understood: boolean
  intent: string
  title: string
  text: string
  table?: { columns: string[]; rows: Array<Array<string | number>> }
  links?: Array<{ label: string; path: string }>
  suggestions?: string[]
}

export default function AskBox({ examples, branchId }: { examples: Array<{ group: string; q: string }>; branchId?: string }) {
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<Array<{ q: string; a: Answer }>>([])
  const [showExamples, setShowExamples] = useState(false)

  const m = useMutation({
    mutationFn: (question: string) => api.post('/insights/ask', { q: question, branchId: branchId || undefined }).then(r => r.data.data as Answer),
    onSuccess: (a, question) => setHistory(h => [{ q: question, a }, ...h].slice(0, 5)),
  })

  const send = (question: string) => {
    const t = question.trim()
    if (!t || m.isPending) return
    setQ('')
    setShowExamples(false)
    m.mutate(t)
  }

  const groups = [...new Set(examples.map(e => e.group))]

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
        <MessageCircleQuestion className="w-4 h-4 text-blue-600" /> Robotdan so'rang
      </div>
      <form onSubmit={e => { e.preventDefault(); send(q) }} className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} maxLength={300}
          placeholder="Masalan: 30 574 OBA qachon motor remont bo'lgan?"
          className="flex-1 min-w-0 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
        <button type="submit" disabled={!q.trim() || m.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {m.isPending ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
          <span className="hidden sm:inline">So'rash</span>
        </button>
      </form>

      <button onClick={() => setShowExamples(s => !s)} className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
        {examples.length} ta savol namunasi <ChevronDown className={cn('w-3 h-3 transition-transform', showExamples && 'rotate-180')} />
      </button>

      {showExamples && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
          {groups.map(g => (
            <div key={g}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{g}</p>
              <div className="flex flex-wrap gap-1.5">
                {examples.filter(e => e.group === g).map(e => (
                  <button key={e.q} onClick={() => send(e.q)}
                    className="text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30">
                    {e.q}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {m.isError && <p className="text-sm text-red-600">Javob olib bo'lmadi. Qayta urinib ko'ring.</p>}

      {history.map((h, i) => (
        <div key={i} className={cn('rounded-lg border p-3 space-y-2', i === 0 ? 'border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700 opacity-80')}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Siz: «{h.q}»</p>
            <button onClick={() => setHistory(x => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-600" aria-label="Yopish"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex gap-2">
            <Bot className={cn('w-4 h-4 mt-0.5 flex-shrink-0', h.a.understood ? 'text-blue-600' : 'text-amber-500')} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{h.a.title}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{h.a.text}</p>
              {h.a.table && h.a.table.rows.length > 0 && <MiniTable columns={h.a.table.columns} rows={h.a.table.rows} />}
              {h.a.links && h.a.links.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {h.a.links.map(l => <Link key={l.path + l.label} to={l.path} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{l.label} →</Link>)}
                </div>
              )}
              {h.a.suggestions && h.a.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {h.a.suggestions.map(s => (
                    <button key={s} onClick={() => send(s)} className="text-xs px-2.5 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:border-blue-300">{s}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
