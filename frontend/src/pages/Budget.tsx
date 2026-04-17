import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, TrendingUp, TrendingDown, Edit2, Check, X, AlertTriangle } from 'lucide-react'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'

const MONTHS_UZ = ['', 'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const CATS = [
  { key: 'fuel',        label: "Yoqilg'i",  color: 'text-blue-600' },
  { key: 'maintenance', label: "Ta'mirlash", color: 'text-orange-600' },
  { key: 'expense',     label: 'Boshqa',     color: 'text-purple-600' },
  { key: 'total',       label: 'Jami',       color: 'text-gray-900 dark:text-white' },
]

interface MonthRow {
  month: number
  actual: Record<string, number>
  budget: Record<string, number | null>
  overBudget: Record<string, boolean>
}

interface BudgetActual {
  year: number
  months: MonthRow[]
  yearly: { actual: Record<string, number>; budget: Record<string, number | null> }
}

interface BudgetPlan { month: number; category: string; amount: number }

function pct(actual: number, budget: number | null): string | null {
  if (!budget || budget === 0) return null
  const p = Math.round((actual / budget) * 100)
  return `${p}%`
}

export default function Budget() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const canEdit = hasRole('admin', 'super_admin', 'manager')
  const year = new Date().getFullYear()
  const [editCell, setEditCell] = useState<{ month: number; cat: string } | null>(null)
  const [editVal, setEditVal] = useState('')

  const { data: actual, isLoading } = useQuery<BudgetActual>({
    queryKey: ['budget-actual', year],
    queryFn: () => api.get('/budget/actual', { params: { year } }).then(r => r.data),
    staleTime: 60000,
  })

  const { data: plans } = useQuery<{ plans: BudgetPlan[] }>({
    queryKey: ['budget-plans', year],
    queryFn: () => api.get('/budget', { params: { year } }).then(r => r.data),
    staleTime: 60000,
  })

  const saveMut = useMutation({
    mutationFn: (body: any) => api.post('/budget', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-actual'] })
      qc.invalidateQueries({ queryKey: ['budget-plans'] })
      setEditCell(null)
      toast.success('Byudjet saqlandi')
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  function getBudgetVal(month: number, cat: string): number | null {
    const p = plans?.plans.find(p => p.month === month && p.category === cat)
    return p ? p.amount : null
  }

  function startEdit(month: number, cat: string) {
    const cur = getBudgetVal(month, cat)
    setEditVal(cur != null ? String(cur) : '')
    setEditCell({ month, cat })
  }

  function saveEdit() {
    if (!editCell || !editVal) { setEditCell(null); return }
    saveMut.mutate({ year, month: editCell.month, category: editCell.cat, amount: Number(editVal) })
  }

  const months = actual?.months ?? []
  const yearly = actual?.yearly

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Wallet className="w-7 h-7 text-green-600" />
          Xarajat Byudjeti — {year}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Oylik byudjet rejalashtirish va haqiqiy xarajatlarni solishtirish
        </p>
      </div>

      {/* Yillik jami */}
      {yearly && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CATS.map(c => {
            const act = yearly.actual[c.key] ?? 0
            const bud = yearly.budget[c.key] ?? null
            const over = bud !== null && act > bud
            return (
              <div key={c.key} className={`bg-white dark:bg-gray-800 rounded-xl border p-4 ${over ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="text-xs text-gray-400 mb-1">{c.label} (yillik)</div>
                <div className={`text-lg font-bold ${over ? 'text-red-600' : c.color}`}>{formatCurrency(act)}</div>
                {bud !== null && (
                  <div className="text-xs mt-0.5 flex items-center gap-1">
                    {over
                      ? <><TrendingUp className="w-3 h-3 text-red-400" /><span className="text-red-500">Reja: {formatCurrency(bud)} (+{pct(act, bud)})</span></>
                      : <><TrendingDown className="w-3 h-3 text-green-400" /><span className="text-green-500">Reja: {formatCurrency(bud)} ({pct(act, bud)})</span></>
                    }
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Oylik jadval */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">Oylik reja vs haqiqiy</h2>
          {canEdit && <p className="text-xs text-gray-400 mt-0.5">Byudjet katakchasini bosib tahrirlang</p>}
        </div>
        {isLoading ? (
          <div className="py-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 pb-3 pt-2 font-medium">Oy</th>
                  {CATS.map(c => (
                    <th key={c.key} className="pb-3 pt-2 pr-4 font-medium text-right">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map(row => (
                  <tr key={row.month} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    <td className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200">
                      {MONTHS_UZ[row.month]}
                    </td>
                    {CATS.map(c => {
                      const act = row.actual[c.key] ?? 0
                      const bud = getBudgetVal(row.month, c.key)
                      const over = bud !== null && act > bud
                      const isEdit = editCell?.month === row.month && editCell?.cat === c.key

                      return (
                        <td key={c.key} className="py-2.5 pr-4 text-right">
                          <div className={`text-sm font-medium ${over ? 'text-red-600' : act > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                            {act > 0 ? formatCurrency(act) : '—'}
                          </div>
                          {/* Byudjet satri */}
                          {isEdit ? (
                            <div className="flex items-center justify-end gap-1 mt-0.5">
                              <input autoFocus type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                                className="text-xs px-1.5 py-0.5 border border-green-400 rounded w-24 text-right dark:bg-gray-700 dark:text-white focus:outline-none" />
                              <button onClick={saveEdit} className="p-0.5 text-green-600 hover:text-green-700"><Check className="w-3 h-3" /></button>
                              <button onClick={() => setEditCell(null)} className="p-0.5 text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <div
                              onClick={() => canEdit && startEdit(row.month, c.key)}
                              className={`text-xs mt-0.5 flex items-center justify-end gap-1 ${canEdit ? 'cursor-pointer group' : ''}`}
                            >
                              {bud !== null ? (
                                <>
                                  {over && <AlertTriangle className="w-3 h-3 text-red-400" />}
                                  <span className={over ? 'text-red-500' : 'text-gray-400'}>
                                    {formatCurrency(bud)}
                                  </span>
                                  {pct(act, bud) && <span className={`${over ? 'text-red-400' : 'text-gray-400'}`}>({pct(act, bud)})</span>}
                                </>
                              ) : canEdit ? (
                                <span className="text-gray-300 dark:text-gray-600 group-hover:text-blue-500 transition-colors">
                                  <Edit2 className="w-3 h-3 inline" /> reja
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              {/* Jami qatori */}
              {yearly && (
                <tfoot className="border-t-2 border-gray-200 dark:border-gray-600">
                  <tr className="bg-gray-50 dark:bg-gray-700/50">
                    <td className="px-5 py-3 text-sm font-bold text-gray-900 dark:text-white">Yillik jami</td>
                    {CATS.map(c => {
                      const act = yearly.actual[c.key] ?? 0
                      const bud = getBudgetVal(0, c.key)
                      const over = bud !== null && act > bud
                      const isEdit = editCell?.month === 0 && editCell?.cat === c.key
                      return (
                        <td key={c.key} className="py-3 pr-4 text-right">
                          <div className={`text-sm font-bold ${over ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                            {formatCurrency(act)}
                          </div>
                          {isEdit ? (
                            <div className="flex items-center justify-end gap-1 mt-0.5">
                              <input autoFocus type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                                className="text-xs px-1.5 py-0.5 border border-green-400 rounded w-28 text-right dark:bg-gray-700 dark:text-white focus:outline-none" />
                              <button onClick={saveEdit} className="p-0.5 text-green-600"><Check className="w-3 h-3" /></button>
                              <button onClick={() => setEditCell(null)} className="p-0.5 text-gray-400"><X className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <div onClick={() => canEdit && startEdit(0, c.key)} className={`text-xs mt-0.5 ${canEdit ? 'cursor-pointer' : ''} text-gray-400`}>
                              {bud != null ? formatCurrency(bud) : canEdit ? <span className="hover:text-blue-500"><Edit2 className="w-3 h-3 inline" /> yillik reja</span> : null}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 text-xs text-green-700 dark:text-green-300">
        <div className="font-medium mb-1">Qanday foydalanish?</div>
        <ul className="space-y-0.5 list-disc list-inside">
          <li>Har bir oyning reja summasini bosib kiriting (Enter bilan saqlang)</li>
          <li>Yillik reja ham belgilash mumkin (oxirgi qatordagi "yillik reja" ni bosing)</li>
          <li>Haqiqiy xarajat rejadan oshsa — qizil rangda ko'rinadi</li>
          <li>Xarajatlar ta'mirlash, yoqilg'i va boshqa xarajatlardan avtomatik yig'iladi</li>
        </ul>
      </div>
    </div>
  )
}
