import { useMemo, useState } from 'react'
import { Plus, Wrench } from 'lucide-react'
import { Empty, MONTH_NAMES, SearchBox, ShowMore, groupByMonth, monthLabel, money } from './vehicleUi'

const PAGE = 25

interface Line { name: string; qty: number; sum: number }

function linesOf(m: any): Line[] {
  if (m.items && m.items.length > 0) {
    return m.items.map((it: any) => ({ name: it.sparePart?.name || '—', qty: it.quantityUsed, sum: Number(it.unitCost) * it.quantityUsed }))
  }
  if (m.sparePart?.name) return [{ name: m.sparePart.name, qty: m.quantityUsed || 1, sum: Number(m.cost) }]
  return []
}

const totalOf = (m: any) => Number(m.cost) + Number(m.laborCost)

export default function MaintenanceTab({ maintenance, onAdd }: { maintenance: any[]; onAdd: () => void }) {
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return maintenance
    return maintenance.filter(m => {
      const hay = [
        ...linesOf(m).map(l => l.name),
        m.performedBy?.fullName, m.workerName, m.supplier?.name, m.notes,
      ].filter(Boolean).join(' ').toLowerCase()
      return words.every(w => hay.includes(w))
    })
  }, [maintenance, q])

  const visible = filtered.slice(0, shown)
  const groups = groupByMonth(visible, m => m.installationDate)
  const filteredTotal = filtered.reduce((s, m) => s + totalOf(m), 0)

  return (
    <div>
      <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox value={q} onChange={v => { setQ(v); setShown(PAGE) }} placeholder="Qism, usta yoki yetkazib beruvchi bo'yicha qidirish…" />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {filtered.length} ta yozuv · jami <b className="text-gray-900 dark:text-white">{money(filteredTotal)}</b>
          </span>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1.5 text-sm px-3 h-9 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
          <Plus className="w-4 h-4" /> Ta'mirlash qo'shish
        </button>
      </div>

      {filtered.length === 0 ? (
        <Empty text={q ? 'Hech narsa topilmadi' : "Bu davrda ta'mirlash yozuvi yo'q"} />
      ) : groups.map(g => {
        const monthSum = g.rows.reduce((s, m) => s + totalOf(m), 0)
        return (
          <div key={g.key}>
            <div className="px-5 py-2 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{monthLabel(g.key)}</span>
              <span className="text-gray-500 dark:text-gray-400">{g.rows.length} ta · {money(monthSum)}</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {g.rows.map(m => {
                const lines = linesOf(m)
                const who = [m.performedBy?.fullName, m.supplier?.name].filter(Boolean).join(' · ')
                return (
                  <div key={m.id} className="px-5 py-3.5 flex gap-4">
                    <div className="w-14 flex-shrink-0 text-center">
                      <p className="text-lg font-bold leading-none text-gray-900 dark:text-white">{new Date(m.installationDate).getDate()}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{MONTH_NAMES[new Date(m.installationDate).getMonth()].slice(0, 3)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      {lines.length === 0 ? (
                        <p className="text-sm text-gray-500 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Faqat ish haqi</p>
                      ) : (
                        <div className="space-y-1">
                          {lines.map((l, i) => (
                            <div key={i} className="flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium text-gray-900 dark:text-white min-w-0">
                                <span className="break-words">{l.name}</span>
                                {l.qty > 1 && <span className="ml-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">× {l.qty}</span>}
                              </p>
                              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0">{money(l.sum)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {Number(m.laborCost) > 0 && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ish haqi: {money(Number(m.laborCost))}</p>}
                      {who && <p className="text-xs text-gray-400 mt-1 truncate">{who}</p>}
                      {m.notes && <p className="text-xs text-gray-400 italic mt-0.5">{m.notes}</p>}
                    </div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums flex-shrink-0">{money(totalOf(m))}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <ShowMore shown={visible.length} total={filtered.length} onMore={() => setShown(s => s + PAGE)} />
    </div>
  )
}
