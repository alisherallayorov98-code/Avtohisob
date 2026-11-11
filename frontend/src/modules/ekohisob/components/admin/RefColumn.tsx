import { ReactNode, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, IconButton, Input, SkeletonList, cx } from '../../ui'

export interface RefItem { id: string; name: string }

/**
 * Spravochnik ustuni (tuman yoki mahalla): sarlavha + bir bosishda qo'shish +
 * nom tahrirlash (qatorning o'zida) + o'chirish. Faol qator — neytral fon.
 */
export default function RefColumn({
  title, count, items, loading, error, onRetry, selectedId, onSelect,
  addPlaceholder, onAdd, onRename, onDelete, emptyTitle, emptyHint,
}: {
  title: ReactNode
  count?: number
  items: RefItem[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  selectedId?: string | null
  onSelect?: (item: RefItem) => void
  addPlaceholder: string
  onAdd: (name: string) => Promise<boolean>
  onRename: (item: RefItem, name: string) => Promise<boolean>
  onDelete: (item: RefItem) => void
  emptyTitle: string
  emptyHint?: string
}) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const v = name.trim()
    if (!v || adding) return
    setAdding(true)
    if (await onAdd(v)) setName('')
    setAdding(false)
  }

  async function saveEdit(item: RefItem) {
    const v = editName.trim()
    if (!v) return
    if (v === item.name) { setEditId(null); return }
    setSaving(true)
    if (await onRename(item, v)) setEditId(null)
    setSaving(false)
  }

  return (
    <Card flush className="flex flex-col min-h-[420px]">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-eko-line shrink-0">
        <h2 className="eko-text-md font-semibold text-eko-text truncate">{title}</h2>
        {count != null && <span className="eko-text-xs text-eko-muted eko-num">{count}</span>}
      </div>

      <form onSubmit={add} className="flex gap-2 p-3 border-b border-eko-line shrink-0">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={addPlaceholder}
          aria-label={addPlaceholder}
        />
        <Button type="submit" variant="primary" loading={adding} disabled={!name.trim()} icon={<Plus className="w-4 h-4" aria-hidden />}>
          Qo'shish
        </Button>
      </form>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {error ? (
          <ErrorState title={error} onRetry={onRetry} compact />
        ) : loading ? (
          <SkeletonList rows={5} />
        ) : items.length === 0 ? (
          <EmptyState compact title={emptyTitle} hint={emptyHint} />
        ) : (
          <ul className="divide-y divide-eko-line">
            {items.map(item => {
              const active = selectedId === item.id
              return (
                <li key={item.id} className={cx('border-l-2', active ? 'border-eko-text bg-eko-surface-3' : 'border-transparent')}>
                  {editId === item.id ? (
                    <div className="flex items-center gap-1 px-3 py-1.5">
                      <Input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit(item)
                          if (e.key === 'Escape') setEditId(null)
                        }}
                        aria-label="Yangi nom"
                      />
                      <IconButton label="Saqlash" variant="primary" loading={saving} onClick={() => saveEdit(item)} icon={<Check className="w-4 h-4" aria-hidden />} />
                      <IconButton label="Bekor qilish" variant="ghost" onClick={() => setEditId(null)} icon={<X className="w-4 h-4" aria-hidden />} />
                    </div>
                  ) : (
                    <div className="flex items-center pl-4 pr-1 min-h-[48px]">
                      {onSelect ? (
                        <button
                          type="button"
                          onClick={() => onSelect(item)}
                          aria-pressed={active}
                          className="flex-1 min-w-0 text-left py-2 min-h-[44px] eko-text-base font-medium text-eko-text truncate"
                        >
                          {item.name}
                        </button>
                      ) : (
                        <span className="flex-1 min-w-0 py-2 eko-text-base text-eko-text truncate">{item.name}</span>
                      )}
                      <IconButton
                        label={`${item.name} nomini tahrirlash`}
                        variant="ghost"
                        onClick={() => { setEditId(item.id); setEditName(item.name) }}
                        icon={<Pencil className="w-4 h-4" aria-hidden />}
                      />
                      <IconButton
                        label={`${item.name} ni o'chirish`}
                        variant="ghost"
                        onClick={() => onDelete(item)}
                        icon={<Trash2 className="w-4 h-4" aria-hidden />}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
