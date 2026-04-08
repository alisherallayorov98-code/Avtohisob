import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Car, Wrench, Fuel, Package, BarChart2, Settings, GitBranch, ArrowRight, HeartPulse, AlertOctagon, Lightbulb, CalendarClock, TrendingUp, CreditCard } from 'lucide-react'

interface Command {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  action: () => void
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const commands: Command[] = [
    { id: 'vehicles', label: 'Avtomobillar', description: 'Avtomobil ro\'yxati', icon: <Car className="w-4 h-4" />, action: () => navigate('/vehicles') },
    { id: 'maintenance', label: 'Texnik xizmat', description: 'Texnik xizmat yozuvlari', icon: <Wrench className="w-4 h-4" />, action: () => navigate('/maintenance') },
    { id: 'fuel', label: 'Yoqilgi', description: 'Yoqilgi hisobi', icon: <Fuel className="w-4 h-4" />, action: () => navigate('/fuel') },
    { id: 'inventory', label: 'Ombor', description: 'Ehtiyot qismlar ombori', icon: <Package className="w-4 h-4" />, action: () => navigate('/inventory') },
    { id: 'spare-parts', label: 'Ehtiyot qismlar', description: 'Ehtiyot qismlar katalogi', icon: <Package className="w-4 h-4" />, action: () => navigate('/spare-parts') },
    { id: 'reports', label: 'Hisobotlar', description: 'Tahlil va hisobotlar', icon: <BarChart2 className="w-4 h-4" />, action: () => navigate('/reports') },
    { id: 'branches', label: 'Filiallar', description: 'Filiallar boshqaruvi', icon: <GitBranch className="w-4 h-4" />, action: () => navigate('/branches') },
    { id: 'settings', label: 'Sozlamalar', description: 'Tizim sozlamalari', icon: <Settings className="w-4 h-4" />, action: () => navigate('/settings') },
    { id: 'vehicle-health', label: 'Avtomobil Salomatligi', description: 'Health score monitoring', icon: <HeartPulse className="w-4 h-4" />, action: () => navigate('/vehicle-health') },
    { id: 'anomalies', label: 'Anomaliyalar', description: 'Anomaliya aniqlash', icon: <AlertOctagon className="w-4 h-4" />, action: () => navigate('/anomalies') },
    { id: 'recommendations', label: 'Tavsiyalar', description: 'AI tavsiyalar', icon: <Lightbulb className="w-4 h-4" />, action: () => navigate('/recommendations') },
    { id: 'predictions', label: 'Bashoratlar', description: 'Texnik xizmat bashorati', icon: <CalendarClock className="w-4 h-4" />, action: () => navigate('/predictions') },
    { id: 'fuel-analytics', label: "Yoqilg'i Tahlili", description: 'Yoqilg\'i sarfi va anomaliyalar', icon: <TrendingUp className="w-4 h-4" />, action: () => navigate('/fuel-analytics') },
    { id: 'billing', label: "Obuna va To'lov", description: 'Tarif rejalari va to\'lov tarixi', icon: <CreditCard className="w-4 h-4" />, action: () => navigate('/billing') },
  ]

  const filtered = query.trim()
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); if (filtered[selected]) { filtered[selected].action(); onClose() } }
    if (e.key === 'Escape') onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Qidirish yoki sahifaga o'tish..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400 text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">Esc</kbd>
        </div>

        <div className="py-1 max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">Hech narsa topilmadi</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => { cmd.action(); onClose() }}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
              >
                <div className={`flex-shrink-0 ${i === selected ? 'text-blue-500' : 'text-gray-400'}`}>{cmd.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${i === selected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>{cmd.label}</div>
                  {cmd.description && <div className="text-xs text-gray-400 truncate">{cmd.description}</div>}
                </div>
                {i === selected && <ArrowRight className="w-4 h-4 text-blue-400 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 flex gap-4 text-xs text-gray-400">
          <span><kbd className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">↑↓</kbd> navigatsiya</span>
          <span><kbd className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">Enter</kbd> tanlash</span>
          <span><kbd className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">Esc</kbd> yopish</span>
        </div>
      </div>
    </div>
  )
}
