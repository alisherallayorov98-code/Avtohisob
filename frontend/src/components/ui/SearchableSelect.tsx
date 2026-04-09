import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface Option {
  value: string
  label: string
}

interface SearchableSelectProps {
  label?: string
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  hint?: string
}

export default function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Qidiring...',
  error,
  hint,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)

  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  // When open: show what user is typing. When closed: show selected label.
  const inputDisplayValue = open ? search : (selected?.label ?? '')

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleFocus = () => {
    setOpen(true)
    setSearch('')
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    if (!open) setOpen(true)
  }

  const handleSelect = (opt: Option) => {
    onChange(opt.value)
    setOpen(false)
    setSearch('')
    inputRef.current?.blur()
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setSearch('')
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
        </label>
      )}

      {/* Combobox: the input itself is the trigger */}
      <div
        className={`flex items-center w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-700 transition-colors ${
          error
            ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500'
            : 'border-gray-300 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500'
        }`}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputDisplayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400 min-w-0 text-sm"
        />
        <div className="flex items-center gap-1 ml-1 flex-shrink-0">
          {selected && !open && (
            <button
              type="button"
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Dropdown options */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                Hech narsa topilmadi
              </div>
            ) : (
              filtered.map(opt => (
                <div
                  key={opt.value}
                  onMouseDown={e => e.preventDefault()} // prevent input blur before click fires
                  onClick={() => handleSelect(opt)}
                  className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                    opt.value === value
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
          <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100 dark:border-gray-700">
            {filtered.length} ta natija
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
