import toast from 'react-hot-toast'
import { MapEntity, debtOf } from './useMapEntities'

/** Qarzdorlar ro'yxatini (xaritada yuklangan) Excel ochadigan TSV fayl sifatida yuklab olish. */
export function exportDebtors(entities: MapEntity[]) {
  const debtors = entities.filter(e => !e.paid && e.status === 'active')
  if (debtors.length === 0) { toast.error("Qarzdorlar yo'q"); return }
  const header = ['Tashkilot', 'Manzil', 'Qarz oylari', 'Rejim', 'Jami qarz', 'Koordinata']
  const rows = debtors.map(e => [
    e.name, e.address, e.debtMonths || 0,
    e.billingMode === 'talon' ? 'Talon' : e.billingMode === 'variable' ? "O'zgaruvchan" : 'Oylik',
    debtOf(e),
    e.lat && e.lng ? `${e.lat},${e.lng}` : '',
  ])
  const csv = [header, ...rows].map(r => r.join('\t')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/tab-separated-values;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `qarzdorlar-${new Date().toISOString().split('T')[0]}.xls`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`${debtors.length} ta qarzdor yuklab olindi`)
}
