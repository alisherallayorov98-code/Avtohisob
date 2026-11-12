import { useState, useRef, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  /** Xavfli amal (bekor qilish, o'chirish) — qizil, ro'yxat oxirida ajratib ko'rsatiladi */
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
}

const MENU_W = 220

// Jadval qatoridagi "⋮" menyusi: tahrirlash/bekor qilish kabi amallar ochiq turmaydi,
// tasodifan bosib yuborish bo'lmaydi. Menyu `fixed` + portal — jadvalning overflow'i qirqib qo'ymaydi.
export default function RowMenu({ items }: { items: MenuItem[] }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const visible = items.filter(i => !i.hidden)

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-rowmenu]') && !btnRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos])

  if (visible.length === 0) return null

  function toggle() {
    if (pos) { setPos(null); return }
    const r = btnRef.current!.getBoundingClientRect()
    const height = visible.length * 38 + 12
    const top = r.bottom + height > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4
    setPos({ top, left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)) })
  }

  const normal = visible.filter(i => !i.danger)
  const danger = visible.filter(i => i.danger)

  const renderItem = (i: MenuItem) => (
    <button
      key={i.label} type="button" disabled={i.disabled}
      onClick={() => { setPos(null); i.onClick() }}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left disabled:opacity-40 ${i.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
    >
      {i.icon}{i.label}
    </button>
  )

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-label="Amallar" title="Amallar"
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
        <MoreVertical className="w-4 h-4" />
      </button>
      {pos && createPortal(
        <div data-rowmenu style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W, zIndex: 60 }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {normal.map(renderItem)}
          {normal.length > 0 && danger.length > 0 && <div className="my-1 border-t border-gray-100" />}
          {danger.map(renderItem)}
        </div>,
        document.body,
      )}
    </>
  )
}
