import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '../../lib/utils'
import { LEVEL_STYLE, fmtKm, positionLabel, tireTitle } from '../tires/tireUi'
import { Card, Empty } from './vehicleUi'

const STATUS_LABEL: Record<string, string> = {
  in_stock: 'Omborda', installed: "O'rnatilgan", returned: 'Qaytarilgan', written_off: 'Hisobdan chiqqan', damaged: 'Shikastlangan',
}

export default function TiresTab({ tiresData }: { tiresData: any }) {
  const [showHistory, setShowHistory] = useState(false)
  const current: any[] = tiresData?.current || []
  const history: any[] = tiresData?.history || []
  const pastTires = history.filter(h => !current.some(c => c.id === h.id))

  if (current.length === 0 && history.length === 0) {
    return <Empty text="Bu mashinaga hali shina biriktirilmagan. «Shinalar» bo'limida raqam bilan o'rnatish mumkin." />
  }

  return (
    <div className="p-5 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Hozir o'rnatilgan ({current.length})</h3>
          <Link to="/tires" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Shinalar bo'limi →</Link>
        </div>
        {current.length === 0 ? (
          <p className="text-sm text-gray-400">Hozir shina o'rnatilmagan.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {current.map(t => {
              const st = LEVEL_STYLE[(t.usageLevel as 'ok') || 'ok']
              const pct = Math.min(100, Math.round(t.usedPct ?? 0))
              return (
                <Link key={t.id} to={`/tires/${t.id}`} className="block border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{positionLabel(t.position)}</p>
                      <p className="font-mono font-bold text-gray-900 dark:text-white mt-0.5">{t.serialCode}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{tireTitle(t)}</p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0 ${st.chip}`}>{st.label}</span>
                  </div>
                  <div className="mt-3 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{fmtKm(t.usedKm)} yurgan</span>
                    <span>me'yor {fmtKm(t.standardMileageKm || 40000)}</span>
                  </div>
                  {t.installationDate && <p className="text-[11px] text-gray-400 mt-1">O'rnatilgan: {formatDate(t.installationDate)}</p>}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {pastTires.length > 0 && (
        <Card>
          <button onClick={() => setShowHistory(s => !s)} className="w-full px-5 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300">
            <span>Avval o'rnatilgan shinalar ({pastTires.length})</span>
            <span className="text-xs text-blue-600 dark:text-blue-400 font-normal">{showHistory ? 'Yashirish' : "Ko'rsatish"}</span>
          </button>
          {showHistory && (
            <div className="divide-y divide-gray-100 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
              {pastTires.map(t => {
                const ded = t.tireDeductions?.[0]
                return (
                  <Link key={t.id} to={`/tires/${t.id}`} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-gray-900 dark:text-white">{t.serialCode}</p>
                      <p className="text-xs text-gray-500 truncate">{tireTitle(t)}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                      <p>{t.installationDate ? formatDate(t.installationDate) : '—'} → {t.removedDate ? formatDate(t.removedDate) : '—'}</p>
                      <p>{t.actualMileageUsed ? fmtKm(t.actualMileageUsed) : '—'} · {STATUS_LABEL[t.status] || t.status}</p>
                      {ded && <p className={ded.isSettled ? 'text-green-600' : 'text-red-600'}>Ushlab qolish: {formatCurrency(Number(ded.deductionAmount))}</p>}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
