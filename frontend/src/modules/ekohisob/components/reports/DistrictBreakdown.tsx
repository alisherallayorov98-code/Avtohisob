import { useState, useCallback } from 'react'
import { MapPin, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import { Card, CardHeader, CardBody, EmptyState, cx, f } from '../../ui'

export interface DistrictRow {
  id: string; name: string; total: number; obliged: number; paid: number
  unpaid: number; collected: number; debt: number; payRate: number | null
}

export interface MahallaRow {
  id: string; name: string; total: number; obliged: number; paid: number
  unpaid: number; collected: number; debt: number; payRate: number | null
}

/** Foiz rangi — 80%+ yaxshi, 50%+ e'tibor, undan past — muammo. */
function rateClass(rate: number): string {
  return rate >= 80 ? 'text-eko-success' : rate >= 50 ? 'text-eko-warn' : 'text-eko-danger'
}

/**
 * Tuman kesimi + mahalla drill-down.
 *
 * Nega drill-down: inspektorlar mahalla bo'yicha ishlaydi, tuman darajasidagi
 * raqam "qayerda ish yurishmayapti" degan savolga javob bermaydi. Mahallalar
 * talab bo'lganda yuklanadi — umumiy hisobotga qo'shilsa har ochilishda
 * yuzlab mahalla so'ralardi.
 */
export default function DistrictBreakdown({
  districts, query, monthLabel,
}: {
  districts: DistrictRow[]
  /** Hisobot davri query satri (`from=...&to=...`) */
  query: string
  monthLabel: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [mahallas, setMahallas] = useState<Record<string, MahallaRow[] | 'loading'>>({})

  const toggle = useCallback((d: DistrictRow) => {
    if (open === d.id) { setOpen(null); return }
    setOpen(d.id)
    if (mahallas[d.id]) return
    setMahallas(m => ({ ...m, [d.id]: 'loading' }))
    ekoApi.get(`/reports/district/${d.id}/mahallas?${query}`)
      .then(res => setMahallas(m => ({ ...m, [d.id]: res.data.data?.mahallas ?? [] })))
      .catch(() => setMahallas(m => ({ ...m, [d.id]: [] })))
  }, [open, mahallas, query])

  const maxCollected = Math.max(1, ...districts.map(d => d.collected))

  return (
    <Card flush>
      <CardHeader title="Tuman bo'yicha" hint={monthLabel} icon={<MapPin className="w-4 h-4" />} />
      <CardBody>
        {districts.length === 0 ? (
          <EmptyState title="Ma'lumot yo'q" hint="Tumanlar hali qo'shilmagan." />
        ) : (
          <div className="space-y-3.5">
            {districts.map(d => {
              const isOpen = open === d.id
              const rows = mahallas[d.id]
              return (
                <div key={d.id}>
                  <button onClick={() => toggle(d)} className="w-full text-left">
                    <div className="flex items-center justify-between text-sm mb-1 gap-2">
                      <span className="font-medium text-eko-text truncate flex items-center gap-1">
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-eko-subtle shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-eko-subtle shrink-0" />}
                        {d.name}
                      </span>
                      <span className="text-eko-muted shrink-0 eko-num">
                        {f.moneyShort(d.collected)}
                        {d.payRate != null && (
                          <span className={cx('ml-2 font-semibold', rateClass(d.payRate))}>{d.payRate}%</span>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-eko-surface-2 rounded-full h-2">
                      <div className="bg-eko-accent h-2 rounded-full"
                           style={{ width: `${Math.round(d.collected * 100 / maxCollected)}%` }} />
                    </div>
                    <p className="text-[11px] text-eko-muted mt-1">
                      {d.paid}/{d.obliged} to'lagan
                      {d.debt > 0 && <> · qarz <b className="text-eko-danger eko-num">{f.moneyShort(d.debt)}</b></>}
                    </p>
                  </button>

                  {isOpen && (
                    <div className="mt-2 ml-4 pl-3 border-l border-eko-line space-y-2">
                      {rows === 'loading' ? (
                        <p className="text-xs text-eko-muted flex items-center gap-1.5 py-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Mahallalar yuklanmoqda...
                        </p>
                      ) : !rows || rows.length === 0 ? (
                        <p className="text-xs text-eko-muted py-1">Mahalla ma'lumoti yo'q</p>
                      ) : rows.map(m => (
                        <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-eko-text-2 truncate">{m.name}</span>
                          <span className="shrink-0 text-eko-muted eko-num">
                            {m.paid}/{m.obliged}
                            {m.debt > 0 && <span className="text-eko-danger ml-2">{f.moneyShort(m.debt)}</span>}
                            {m.payRate != null && (
                              <span className={cx('ml-2 font-semibold', rateClass(m.payRate))}>{m.payRate}%</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
