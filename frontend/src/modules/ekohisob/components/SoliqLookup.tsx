import { useEffect, useRef, useState } from 'react'
import { Search, CheckCircle2, Loader2 } from 'lucide-react'
import ekoApi from '../lib/ekoApi'
import { Banner, Button } from '../ui'

export interface SoliqCompany {
  stir: string
  name: string
  fullName: string
  address: string
  phone: string
  directorName: string
  status: 'active' | 'inactive' | 'unknown' | ''
  statusText: string
}

type Field = 'name' | 'address' | 'phone' | 'contactName'
export type SoliqPatch = Partial<Record<Field, string>>

const LABEL: Record<Field, string> = {
  name: 'Nomi', address: 'Manzil', phone: 'Telefon', contactName: "Mas'ul shaxs (rahbar)",
}

// Funksiya yoqilganmi — bir marta so'raladi
let configuredCache: boolean | null = null
async function isConfigured(): Promise<boolean> {
  if (configuredCache !== null) return configuredCache
  try {
    configuredCache = Boolean((await ekoApi.get('/soliq/status')).data.data.configured)
  } catch { configuredCache = false }
  return configuredCache
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; company: SoliqCompany; leftovers: Field[]; filled: Field[] }
  | { kind: 'duplicate'; existing: { id: string; name: string } }
  | { kind: 'info'; text: string }

const digits = (s: string) => s.replace(/\D/g, '')
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * STIR bo'yicha Soliqdan ma'lumot olish.
 *  - Bo'sh maydonlar avtomatik to'ldiriladi.
 *  - Foydalanuvchi kiritgan va Soliqdan FARQ qiluvchi maydonlar jim ustidan yozilmaydi —
 *    "sizda / soliqda" ko'rsatiladi, almashtirishni foydalanuvchi o'zi tanlaydi.
 *  - Soliqda topilmasa yoki xizmat ishlamasa — xato emas, qo'lda kiritish davom etadi.
 */
export default function SoliqLookup({
  stir, initialStir = '', excludeId, current, onApply, onSynced, onOpenExisting,
}: {
  stir: string
  /** Forma ochilgandagi STIR: o'zgarmagan bo'lsa o'zi so'ramaydi (faqat tugma bilan) */
  initialStir?: string
  excludeId?: string
  current: Partial<Record<Field, string>>
  onApply: (patch: SoliqPatch) => void
  /** Soliq ma'lumoti qo'llandi — saqlashda `soliqSynced` yuboriladi */
  onSynced: () => void
  onOpenExisting?: (id: string) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const seq = useRef(0)
  const currentRef = useRef(current)
  currentRef.current = current

  useEffect(() => { isConfigured().then(setEnabled) }, [])

  const clean = digits(stir)
  const valid = clean.length === 9

  async function run() {
    if (!valid) return
    const id = ++seq.current
    setState({ kind: 'loading' })
    try {
      const res = await ekoApi.get('/soliq/lookup', { params: { stir: clean, excludeId } })
      if (id !== seq.current) return
      const d = res.data.data
      if (d.existing) { setState({ kind: 'duplicate', existing: d.existing }); return }
      if (!d.found) { setState({ kind: 'info', text: d.message || 'Soliqda topilmadi — maʼlumotni qo\'lda kiriting.' }); return }

      const c: SoliqCompany = d.company
      const incoming: Record<Field, string> = {
        name: c.name, address: c.address, phone: c.phone, contactName: c.directorName,
      }
      const patch: SoliqPatch = {}
      const leftovers: Field[] = []
      for (const k of Object.keys(current) as Field[]) {
        const now = currentRef.current[k] ?? ''
        const next = incoming[k]
        if (!next) continue
        if (!now.trim()) patch[k] = next            // bo'sh — to'ldiramiz
        else if (norm(now) !== norm(next)) leftovers.push(k) // farq — foydalanuvchi hal qiladi
      }
      if (Object.keys(patch).length) { onApply(patch); onSynced() }
      setState({ kind: 'found', company: c, leftovers, filled: Object.keys(patch) as Field[] })
    } catch {
      if (id === seq.current) setState({ kind: 'info', text: 'Soliq tekshiruvi hozir ishlamadi — qo\'lda davom eting.' })
    }
  }

  // STIR 9 xonaga yetganda (va o'zgargan bo'lsa) o'zi so'raydi
  useEffect(() => {
    if (!enabled) return
    if (!valid || clean === digits(initialStir)) { setState({ kind: 'idle' }); return }
    const t = setTimeout(run, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean, enabled])

  if (!enabled) return null

  function apply(k: Field, c: SoliqCompany) {
    const v = { name: c.name, address: c.address, phone: c.phone, contactName: c.directorName }[k]
    onApply({ [k]: v })
    onSynced()
    setState(s => s.kind === 'found' ? { ...s, leftovers: s.leftovers.filter(x => x !== k) } : s)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!valid || state.kind === 'loading'} onClick={run}
          icon={state.kind === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}>
          Soliqdan to'ldirish
        </Button>
        {!valid && clean.length > 0 && <span className="eko-text-xs text-eko-muted">STIR 9 ta raqam bo'lishi kerak</span>}
      </div>

      {state.kind === 'duplicate' && (
        <Banner tone="warn" action={onOpenExisting && (
          <Button size="sm" onClick={() => onOpenExisting(state.existing.id)}>Ochish</Button>
        )}>
          Bu STIR bilan tashkilot <b>allaqachon kiritilgan</b>: {state.existing.name}. Yangisini qo'shmang.
        </Banner>
      )}

      {state.kind === 'info' && <p className="eko-text-xs text-eko-muted">{state.text}</p>}

      {state.kind === 'found' && (
        <>
          {state.company.status === 'inactive' && (
            <Banner tone="danger">Soliqda bu korxonaning faoliyati <b>tugatilgan</b>{state.company.statusText ? ` (${state.company.statusText})` : ''}.</Banner>
          )}
          <Banner tone="success">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Soliqdan topildi: <b>{state.company.fullName || state.company.name}</b>
            </span>
            {state.filled.length > 0 && (
              <span className="block mt-1 eko-text-xs">To'ldirildi: {state.filled.map(k => LABEL[k]).join(', ')}</span>
            )}
          </Banner>
          {state.leftovers.length > 0 && (
            <div className="border border-eko-line rounded-eko-lg divide-y divide-eko-line">
              <p className="px-3 py-2 eko-text-xs text-eko-muted">Quyidagilar sizda boshqacha. Qaysi birini Soliq bilan almashtiramiz?</p>
              {state.leftovers.map(k => {
                const c = state.company
                const soliq = { name: c.name, address: c.address, phone: c.phone, contactName: c.directorName }[k]
                return (
                  <div key={k} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="eko-text-xs text-eko-muted">{LABEL[k]}</p>
                      <p className="text-eko-muted truncate">Sizda: {current[k]}</p>
                      <p className="text-eko-text truncate">Soliqda: {soliq}</p>
                    </div>
                    <Button size="sm" onClick={() => apply(k, c)}>Almashtirish</Button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
