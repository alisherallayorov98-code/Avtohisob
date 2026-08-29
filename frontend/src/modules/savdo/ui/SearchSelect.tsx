import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Plus } from 'lucide-react'

export interface SearchSelectOption {
  id: string
  label: string
  sublabel?: string
}

interface SearchSelectProps {
  options: SearchSelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  /** "+ Yangi mijoz" kabi qo'shimcha amal — ro'yxat pastida ko'rinadi */
  extraAction?: { label: string; onClick: () => void }
}

// 100+ mahsulot/mijoz orasidan tez qidirib topish uchun — oddiy <select> o'rniga.
// Nomi yoki ikkinchi maydon (SKU/telefon) bo'yicha filtrlaydi.
export default function SearchSelect({ options, value, onChange, placeholder, className, extraAction }: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.id === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sublabel && o.sublabel.toLowerCase().includes(q))
    )
  }, [options, query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={rootRef} className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-amber-600 bg-white"
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? selected.label : (placeholder || 'Tanlang...')}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="relative border-b border-gray-100">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Qidirish..."
              className="w-full pl-8 pr-3 py-2 text-sm focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-400 text-center">Topilmadi</p>
            ) : (
              filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setQuery('') }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-50 transition-colors ${o.id === value ? 'bg-amber-50 text-amber-800 font-medium' : 'text-gray-700'}`}
                >
                  {o.label}
                  {o.sublabel && <span className="text-gray-400 text-xs ml-1.5">{o.sublabel}</span>}
                </button>
              ))
            )}
          </div>
          {extraAction && (
            <button
              type="button"
              onClick={() => { setOpen(false); setQuery(''); extraAction.onClick() }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 border-t border-gray-100 font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> {extraAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
