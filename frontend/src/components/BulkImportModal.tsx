import { useState, useRef } from 'react'
import { Upload, Download, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'
import api from '../lib/api'

interface ImportRow {
  row: number
  data: Record<string, string>
  status: 'pending' | 'success' | 'error'
  error?: string
}

interface Props {
  open: boolean
  onClose: () => void
  type: 'vehicles' | 'spare-parts'
  onSuccess: () => void
}

const TEMPLATES: Record<string, { headers: string[]; sample: string[][] }> = {
  vehicles: {
    headers: ['registrationNumber', 'brand', 'model', 'year', 'fuelType', 'branchId', 'purchaseDate', 'mileage'],
    sample: [
      ['01A001AA', 'Chevrolet', 'Nexia 3', '2021', 'petrol', '', '2021-01-15', '45000'],
      ['01B002BB', 'Chevrolet', 'Cobalt', '2020', 'gas', '', '2020-06-20', '78000'],
    ],
  },
  'spare-parts': {
    headers: ['name', 'partCode', 'category', 'unitPrice', 'supplierId', 'description'],
    sample: [
      ['Moy filtri', 'OF-001', 'filters', '45000', '', ''],
      ['Tormoz kolodkasi', 'BP-001', 'brakes', '120000', '', ''],
    ],
  },
}

function parseCSV(text: string): string[][] {
  return text.trim().split('\n').map(line =>
    line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
  )
}

export default function BulkImportModal({ open, onClose, type, onSuccess }: Props) {
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const template = TEMPLATES[type]

  function downloadTemplate() {
    const csv = [template.headers.join(','), ...template.sample.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}-template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const lines = parseCSV(text)
      if (lines.length < 2) { toast.error('Fayl bo\'sh yoki noto\'g\'ri format'); return }
      const headers = lines[0]
      const dataRows = lines.slice(1).filter(r => r.some(c => c))
      const parsed: ImportRow[] = dataRows.map((row, i) => {
        const data: Record<string, string> = {}
        headers.forEach((h, j) => { data[h] = row[j] || '' })
        return { row: i + 2, data, status: 'pending' }
      })
      setRows(parsed)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    const updated = [...rows]
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'success') continue
      try {
        await api.post(`/${type}`, updated[i].data)
        updated[i] = { ...updated[i], status: 'success' }
      } catch (err: any) {
        updated[i] = { ...updated[i], status: 'error', error: err.response?.data?.error || 'Xato' }
      }
      setRows([...updated])
    }
    setImporting(false)
    const success = updated.filter(r => r.status === 'success').length
    const errors = updated.filter(r => r.status === 'error').length
    if (success > 0) { toast.success(`${success} ta muvaffaqiyatli import qilindi`); onSuccess() }
    if (errors > 0) toast.error(`${errors} ta xato`)
  }

  const successCount = rows.filter(r => r.status === 'success').length
  const errorCount = rows.filter(r => r.status === 'error').length

  return (
    <Modal open={open} onClose={onClose} title={`CSV Import — ${type === 'vehicles' ? 'Avtomobillar' : 'Ehtiyot qismlar'}`} size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
          {rows.length > 0 && (
            <Button onClick={handleImport} loading={importing} disabled={rows.every(r => r.status === 'success')}>
              Import qilish ({rows.filter(r => r.status !== 'success').length} ta)
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <Button variant="outline" icon={<Download className="w-4 h-4" />} onClick={downloadTemplate} size="sm">
            Shablon yuklab olish
          </Button>
          <Button variant="outline" icon={<Upload className="w-4 h-4" />} onClick={() => fileRef.current?.click()} size="sm">
            CSV yuklash
          </Button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>

        {rows.length > 0 && (
          <div>
            <div className="flex items-center gap-4 mb-2 text-sm">
              <span className="text-gray-500">Jami: {rows.length}</span>
              {successCount > 0 && <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" />{successCount}</span>}
              {errorCount > 0 && <span className="text-red-600 flex items-center gap-1"><XCircle className="w-4 h-4" />{errorCount}</span>}
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <table className="text-xs w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 w-10">#</th>
                    {template.headers.slice(0, 4).map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>
                    ))}
                    <th className="px-3 py-2 text-left text-gray-500">Holat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(r => (
                    <tr key={r.row} className={r.status === 'error' ? 'bg-red-50' : r.status === 'success' ? 'bg-green-50' : ''}>
                      <td className="px-3 py-1.5 text-gray-400">{r.row}</td>
                      {template.headers.slice(0, 4).map(h => (
                        <td key={h} className="px-3 py-1.5 text-gray-700 truncate max-w-24">{r.data[h] || '-'}</td>
                      ))}
                      <td className="px-3 py-1.5">
                        {r.status === 'success' && <CheckCircle className="w-4 h-4 text-green-500" />}
                        {r.status === 'error' && <span className="text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" />{r.error}</span>}
                        {r.status === 'pending' && <AlertCircle className="w-4 h-4 text-gray-400" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
