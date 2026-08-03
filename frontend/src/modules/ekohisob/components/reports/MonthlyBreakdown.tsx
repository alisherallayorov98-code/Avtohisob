import { useEffect, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import { Card, CardHeader, CardBody, EmptyState, ErrorState, Skeleton, cx, f } from '../../ui'

export interface MonthlyRow {
  month: string
  expected: number
  expectedCharge: number
  expectedTalon: number
  collected: number
  debt: number
  /** null — shu oyda kutilgan summa yo'q */
  collectRate: number | null
  payments: number
  payers: number
}

interface MonthlyData {
  rows: MonthlyRow[]
  totals: {
    expected: number; collected: number; debt: number
    payments: number; collectRate: number | null
  }
}

/** Foiz rangi — tuman kesimidagi shkala bilan bir xil. */
function rateClass(rate: number): string {
  return rate >= 80 ? 'text-eko-success' : rate >= 50 ? 'text-eko-warn' : 'text-eko-danger'
}

/**
 * Oyma-oy hisobot.
 *
 * Nega kerak: hisobot sahifasi davrning FAQAT oxirgi oyi bo'yicha kesim
 * berardi, oylar bo'yicha esa "qancha yig'ildi" grafigi bor edi. Grafik
 * "yaxshimi yoki yomonmi" degan savolga javob bermaydi — buning uchun o'sha
 * oyda qancha KUTILGANI kerak. Buxgalteriya va rahbar yig'ilishi aynan shu
 * jadvalni so'raydi, shuning uchun Excel va chop etishda ham bor.
 */
export default function MonthlyBreakdown({ query }: { query: string }) {
  const [data, setData] = useState<MonthlyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setFailed(false)
    ekoApi.get(`/reports/monthly?${query}`)
      .then(res => { if (alive) setData(res.data.data ?? res.data) })
      .catch(() => { if (alive) { setData(null); setFailed(true) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [query])

  return (
    <Card flush>
      <CardHeader
        title="Oyma-oy hisobot"
        hint="Har oy uchun kutilgan, yig'ilgan va qolgan qarz"
        icon={<CalendarRange className="w-4 h-4" />}
      />
      {loading ? (
        <CardBody><Skeleton className="h-40 w-full" /></CardBody>
      ) : failed || !data ? (
        <ErrorState />
      ) : data.rows.length === 0 ? (
        <CardBody><EmptyState title="Davr bo'sh" hint="Tanlangan davrda ma'lumot yo'q." /></CardBody>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-eko-muted border-b border-eko-line">
                  <th className="text-left font-medium px-4 sm:px-5 py-2">Oy</th>
                  <th className="text-right font-medium px-2 py-2">Kutilgan</th>
                  <th className="text-right font-medium px-2 py-2">Yig'ilgan</th>
                  <th className="text-right font-medium px-2 py-2">Yig'im</th>
                  <th className="text-right font-medium px-2 py-2">Qarz</th>
                  <th className="text-right font-medium px-4 sm:px-5 py-2">To'lagan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-eko-line">
                {data.rows.map(r => (
                  <tr key={r.month} className="hover:bg-eko-surface-2">
                    <td className="px-4 sm:px-5 py-2 whitespace-nowrap text-eko-text">
                      {f.monthLabel(r.month)}
                      {r.expectedTalon > 0 && (
                        <span className="block text-[11px] text-eko-muted">
                          talon: {f.num(r.expectedTalon)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right eko-num text-eko-text-2">{f.num(r.expected)}</td>
                    <td className="px-2 py-2 text-right eko-num font-medium text-eko-text">{f.num(r.collected)}</td>
                    <td className={cx(
                      'px-2 py-2 text-right eko-num font-semibold',
                      r.collectRate == null ? 'text-eko-subtle' : rateClass(r.collectRate),
                    )}>
                      {r.collectRate == null ? '—' : `${r.collectRate}%`}
                    </td>
                    <td className="px-2 py-2 text-right eko-num text-eko-danger">
                      {r.debt > 0 ? f.num(r.debt) : '—'}
                    </td>
                    <td className="px-4 sm:px-5 py-2 text-right eko-num text-eko-muted">
                      {r.payers} <span className="text-[11px]">({r.payments} to'lov)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-eko-line bg-eko-surface-2 font-semibold text-eko-text">
                  <td className="px-4 sm:px-5 py-2">JAMI</td>
                  <td className="px-2 py-2 text-right eko-num">{f.num(data.totals.expected)}</td>
                  <td className="px-2 py-2 text-right eko-num">{f.num(data.totals.collected)}</td>
                  <td className={cx(
                    'px-2 py-2 text-right eko-num',
                    data.totals.collectRate == null ? 'text-eko-subtle' : rateClass(data.totals.collectRate),
                  )}>
                    {data.totals.collectRate == null ? '—' : `${data.totals.collectRate}%`}
                  </td>
                  <td className="px-2 py-2 text-right eko-num text-eko-danger">{f.num(data.totals.debt)}</td>
                  <td className="px-4 sm:px-5 py-2 text-right eko-num text-eko-muted">
                    {data.totals.payments} to'lov
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-4 sm:px-5 py-2 text-[11px] text-eko-muted">
            "Qarz" — o'sha oy hisoblaridan BUGUNGACHA yopilmagan qism. Yig'im 100% dan
            oshishi mumkin: ortiqcha to'lov eski qarzni yopganda pul o'sha eski oyga yoziladi.
          </p>
        </>
      )}
    </Card>
  )
}
