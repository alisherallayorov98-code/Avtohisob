import { useMemo, useState } from 'react'
import { formatDate, FUEL_TYPES } from '../../lib/utils'
import { Empty, SearchBox, ShowMore, groupByMonth, monthLabel, money } from './vehicleUi'

const PAGE = 30

export default function FuelTab({ fuelRecords }: { fuelRecords: any[] }) {
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  // Har bir to'ldirish uchun: oldingi to'ldirishdan beri bosib o'tilgan km (odometr bo'yicha)
  const kmSincePrev = useMemo(() => {
    const byOdo = [...fuelRecords]
      .filter(f => Number(f.odometerReading) > 0)
      .sort((a, b) => Number(a.odometerReading) - Number(b.odometerReading))
    const map = new Map<string, number>()
    for (let i = 1; i < byOdo.length; i++) {
      const d = Number(byOdo[i].odometerReading) - Number(byOdo[i - 1].odometerReading)
      if (d > 0 && d < 5000) map.set(byOdo[i].id, d)
    }
    return map
  }, [fuelRecords])

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return fuelRecords
    return fuelRecords.filter(f => {
      const hay = [f.supplier?.name, f.createdBy?.fullName, FUEL_TYPES[f.fuelType], String(f.odometerReading)].filter(Boolean).join(' ').toLowerCase()
      return words.every(w => hay.includes(w))
    })
  }, [fuelRecords, q])

  const liters = filtered.reduce((s, f) => s + Number(f.amountLiters), 0)
  const cost = filtered.reduce((s, f) => s + Number(f.cost), 0)
  const visible = filtered.slice(0, shown)
  const groups = groupByMonth(visible, f => f.refuelDate)

  return (
    <div>
      <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={v => { setQ(v); setShown(PAGE) }} placeholder="Yetkazib beruvchi yoki xodim bo'yicha…" />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {filtered.length} ta · <b className="text-gray-900 dark:text-white">{Math.round(liters).toLocaleString('uz-UZ')} litr</b> · <b className="text-gray-900 dark:text-white">{money(cost)}</b>
          {liters > 0 && <> · o'rtacha {Math.round(cost / liters).toLocaleString('uz-UZ')} so'm/litr</>}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty text={q ? 'Hech narsa topilmadi' : "Bu davrda yoqilg'i yozuvi yo'q"} />
      ) : groups.map(g => {
        const gl = g.rows.reduce((s, f) => s + Number(f.amountLiters), 0)
        const gc = g.rows.reduce((s, f) => s + Number(f.cost), 0)
        return (
          <div key={g.key}>
            <div className="px-5 py-2 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{monthLabel(g.key)}</span>
              <span className="text-gray-500 dark:text-gray-400">{Math.round(gl)} litr · {money(gc)}</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {g.rows.map(f => {
                const price = Number(f.amountLiters) > 0 ? Number(f.cost) / Number(f.amountLiters) : 0
                const km = kmSincePrev.get(f.id)
                return (
                  <div key={f.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {Number(f.amountLiters).toFixed(1)} litr
                        <span className="text-xs text-gray-400 font-normal"> · {FUEL_TYPES[f.fuelType] || f.fuelType} · {Math.round(price).toLocaleString('uz-UZ')} so'm/l</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {Number(f.odometerReading) > 0 && <>Odometr {Number(f.odometerReading).toLocaleString('uz-UZ')} km</>}
                        {km != null && <span className="text-gray-400"> (oldingisidan +{km.toLocaleString('uz-UZ')} km)</span>}
                        {f.supplier && ` · ${f.supplier.name}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{money(Number(f.cost))}</p>
                      <p className="text-xs text-gray-400">{formatDate(f.refuelDate)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <ShowMore shown={visible.length} total={filtered.length} onMore={() => setShown(s => s + PAGE)} />
    </div>
  )
}
