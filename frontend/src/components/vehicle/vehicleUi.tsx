import { useState } from 'react'
import { Calendar } from 'lucide-react'

// Kichik umumiy yordamchilar — mashina sahifasi tablari uchun.

export const MONTH_NAMES = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

/** "2026-09" -> "Sentabr 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${MONTH_NAMES[Number(m) - 1] || m} ${y}`
}

/** Sana -> "YYYY-MM" (mahalliy vaqt) */
export function monthOf(d: string | Date): string {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}

/** 1 250 000 -> "1,25 mln", 85 000 -> "85 ming" (grafik/kartalarda ixcham ko'rsatish uchun) */
export function shortMoney(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')} mln`
  if (a >= 1_000) return `${Math.round(n / 1_000)} ming`
  return String(Math.round(n))
}

export const money = (n: number) => `${Math.round(n).toLocaleString('uz-UZ')} so'm`

export function groupByMonth<T>(rows: T[], getDate: (r: T) => string | Date): { key: string; rows: T[] }[] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = monthOf(getDate(r))
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(r)
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, rows]) => ({ key, rows }))
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full sm:w-72 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

const isoDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

const PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: 'all', label: 'Hammasi', days: null },
  { key: '30', label: '30 kun', days: 30 },
  { key: '90', label: '3 oy', days: 90 },
  { key: '365', label: '1 yil', days: 365 },
]

/** Davr tanlash: tezkor tugmalar + "Boshqa" (qo'lda sana) */
export function PeriodFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [custom, setCustom] = useState(false)
  const active = custom ? 'custom'
    : !from && !to ? 'all'
    : PRESETS.find(p => p.days && !to && from === isoDay(new Date(Date.now() - p.days * 86400000)))?.key || 'custom'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="w-4 h-4 text-gray-400" />
      {PRESETS.map(p => (
        <button
          key={p.key}
          onClick={() => { setCustom(false); onChange(p.days ? isoDay(new Date(Date.now() - p.days * 86400000)) : '', '') }}
          className={`px-3 h-8 text-sm rounded-lg border transition-colors ${active === p.key
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >{p.label}</button>
      ))}
      <button
        onClick={() => setCustom(c => !c)}
        className={`px-3 h-8 text-sm rounded-lg border transition-colors ${active === 'custom'
          ? 'bg-blue-600 border-blue-600 text-white'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
      >Boshqa</button>
      {(custom || active === 'custom') && (
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={e => onChange(e.target.value, to)}
            className="h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-gray-400">—</span>
          <input type="date" value={to} onChange={e => onChange(from, e.target.value)}
            className="h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      )}
    </div>
  )
}

export function Card({ title, right, children, className = '' }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm ${className}`}>
      {title && (
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="py-12 text-center text-gray-400 text-sm">{text}</p>
}

export function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null
  return (
    <div className="p-4 text-center">
      <button onClick={onMore} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
        Yana ko'rsatish ({total - shown} ta qoldi)
      </button>
    </div>
  )
}
