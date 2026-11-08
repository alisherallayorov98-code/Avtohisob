import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Search } from 'lucide-react'
import { latToCyrl } from '../../lib/latToCyrl'
import { formatCurrency } from '../../lib/utils'

export interface InventoryPart {
  sparePartId: string
  name: string
  partCode: string
  stock: number
  unitPrice: number
}

// "salnik" ham "Сальник" ni, "svecha ngk" ham "Свеча NGK 4179" ni topishi uchun:
// har so'z lotin yoki kirill shaklida, yumshatish/qattiqlik belgilarisiz solishtiriladi.
const norm = (s: string) => s.toLowerCase().replace(/[ьъ'ʻʼ`]/g, '').replace(/ё/g, 'е')

export function matchesPart(part: InventoryPart, query: string): boolean {
  const hay = norm(`${part.name} ${part.partCode}`)
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  return tokens.every(tok => hay.includes(norm(tok)) || hay.includes(norm(latToCyrl(tok))))
}

interface Props {
  parts: InventoryPart[]
  loading: boolean
  disabledReason?: string
  selectedQty: Record<string, number>
  onAdd: (part: InventoryPart) => void
}

const MAX_RESULTS = 60

export default function PartPicker({ parts, loading, disabledReason, selectedQty, onAdd }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const list = query.trim() ? parts.filter(p => matchesPart(p, query)) : parts
    return list.slice(0, MAX_RESULTS)
  }, [parts, query])

  const add = (p: InventoryPart) => { onAdd(p); setOpen(true) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) add(results[active]) }
    else if (e.key === 'Escape') { e.stopPropagation(); if (query) setQuery(''); else setOpen(false) }
    requestAnimationFrame(() => listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
  }

  const disabled = !!disabledReason

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 px-3.5 h-11 rounded-xl border bg-white dark:bg-slate-800 transition ${
        disabled ? 'border-slate-200 dark:border-slate-700 opacity-70' : 'border-slate-300 dark:border-slate-600 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/15'
      }`}>
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={disabledReason || t('maintenanceForm.searchPlaceholder')}
          className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
          autoComplete="off"
        />
        {!disabled && parts.length > 0 && (
          <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">{parts.length}</span>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-20 left-0 right-0 mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {loading ? (
              <p className="px-4 py-6 text-sm text-center text-slate-400">{t('maintenanceForm.searchLoading')}</p>
            ) : !results.length ? (
              <p className="px-4 py-6 text-sm text-center text-slate-400">{t('maintenanceForm.searchEmpty')}</p>
            ) : results.map((p, i) => {
              const picked = selectedQty[p.sparePartId] || 0
              return (
                <button
                  key={p.sparePartId}
                  type="button"
                  data-active={i === active}
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(p)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                    i === active ? 'bg-blue-50 dark:bg-blue-900/25' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{p.name}</p>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{p.partCode}</p>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">{formatCurrency(p.unitPrice)}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0 tabular-nums ${
                    p.stock > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {p.stock > 0 ? `${p.stock} ta` : t('maintenanceForm.noStock')}
                  </span>
                  {picked > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                      <Check className="w-3.5 h-3.5" /> {picked}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40">
            {t('maintenanceForm.searchHint')}
          </p>
        </div>
      )}
    </div>
  )
}
