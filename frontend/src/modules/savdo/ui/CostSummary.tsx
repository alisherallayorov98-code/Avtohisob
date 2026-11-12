import { fmtMoney } from '../lib/docs'

export interface CostSummaryData {
  goodsLocal: number; customs: number; other: number; levy: number; extra: number; extraPct: number; landed: number
}

// Import kirim jamilari: tovar → bojxona / qo'shimcha / yig'im → jami xarajat → to'liq tannarx.
// Jami xarajat alohida ajratib ko'rsatiladi (tovar qiymatiga nisbati bilan).
export default function CostSummary({ t, currencyNote }: { t: CostSummaryData; currencyNote?: string }) {
  const Item = ({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'amber' | 'dark' }) => (
    <div className={`rounded-xl px-3 py-2.5 border ${tone === 'dark' ? 'bg-amber-800 border-amber-800 text-white' : tone === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
      <p className={`text-[11px] uppercase tracking-wide ${tone === 'dark' ? 'text-amber-100' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-base font-semibold savdo-num ${tone === 'dark' ? 'text-white' : 'text-gray-800'}`}>{fmtMoney(value)} <span className="text-xs font-normal opacity-70">so'm</span></p>
      {hint && <p className={`text-[11px] ${tone === 'dark' ? 'text-amber-100' : 'text-gray-400'}`}>{hint}</p>}
    </div>
  )
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Item label="Tovar qiymati" value={t.goodsLocal} hint={currencyNote} />
        <Item label="Bojxona xarajatlari" value={t.customs} />
        <Item label="Qo'shimcha xarajatlar" value={t.other} hint="sertifikat, transport, deklarant ..." />
        <Item label="Yig'im (utilizatsiya)" value={t.levy} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Item label="Jami xarajat" value={t.extra} tone="amber" hint={`bojxona + qo'shimcha + yig'im · tovar qiymatining ${t.extraPct}%`} />
        <Item label="To'liq tannarx" value={t.landed} tone="dark" hint="omborga shu qiymat bilan kiradi" />
      </div>
    </div>
  )
}
