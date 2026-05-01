import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { X, Printer, Loader2 } from 'lucide-react'
import QRCode from 'qrcode'
import api, { getFileUrl } from '../../lib/api'
import { formatCurrency, formatDate, formatDateLong, uzNumberToWords } from '../../lib/utils'

interface Props {
  maintenanceId: string
  onClose: () => void
}

export default function MaintenanceDocumentModal({ maintenanceId, onClose }: Props) {
  const { data: record, isLoading } = useQuery({
    queryKey: ['maintenance-detail', maintenanceId],
    queryFn: () => api.get(`/maintenance/${maintenanceId}`).then(r => r.data.data),
  })

  // Soddalashtirilgan ko'rinish yoqilganmi? Yoqilgan bo'lsa "Umumiy" variant ko'rinmaydi
  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => api.get('/org-settings').then(r => r.data.data).catch(() => null),
    staleTime: 30_000,
  })
  const simplifiedMode = !!orgSettings?.simplifiedView

  const [qrDataUrl, setQrDataUrl] = useState('')
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  // Variant: 'umumiy' = hammasi (rasmiy + norasmiy)
  //          'buxgalteriya' = faqat rasmiy yozuv uchun chiqarish (norasmiy bo'lsa man)
  // Soddalashtirilgan rejimda default = 'buxgalteriya' va boshqa tanlov yo'q
  const [variant, setVariant] = useState<'umumiy' | 'buxgalteriya'>(simplifiedMode ? 'buxgalteriya' : 'umumiy')

  // Soddalashtirilgan rejim yoqilganda variant'ni majburiy 'buxgalteriya' qilamiz
  useEffect(() => {
    if (simplifiedMode && variant !== 'buxgalteriya') setVariant('buxgalteriya')
  }, [simplifiedMode, variant])

  useEffect(() => {
    const url = `${window.location.origin}/maintenance?id=${maintenanceId}`
    QRCode.toDataURL(url, { width: 100, margin: 1 }).then(setQrDataUrl).catch(() => {})
  }, [maintenanceId])

  // Esc tugmasi bilan lightbox yopish
  useEffect(() => {
    if (!lightboxImage) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxImage(null) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [lightboxImage])

  const handlePrint = () => {
    const el = document.getElementById('maintenance-doc-content')
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dalolatnoma</title>
    <style>
      @page { size: A4; margin: 18mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; margin: 0; line-height: 1.4; }
      .doc-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 14px; }
      .doc-header .org { font-size: 10pt; color: #444; letter-spacing: 1px; }
      .doc-header h1 { font-size: 22pt; font-weight: bold; letter-spacing: 6px; margin: 4px 0 2px; }
      .doc-header .subtitle { font-size: 10pt; color: #666; }
      .doc-meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11pt; }
      .doc-no { font-weight: bold; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; font-size: 11pt; }
      .info-grid > div { border-bottom: 1px dotted #999; padding: 3px 0; }
      .label { color: #555; display: inline-block; width: 130px; }
      .value { font-weight: bold; }
      table.items { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11pt; }
      table.items th { background: #e8e8e8; padding: 6px 8px; text-align: left; border: 1px solid #000; font-weight: bold; }
      table.items td { padding: 6px 8px; border: 1px solid #000; }
      table.items .num { text-align: right; }
      table.items .ctr { text-align: center; }
      .totals-block { width: 60%; margin-left: auto; margin-bottom: 12px; }
      .totals-block table { width: 100%; border-collapse: collapse; }
      .totals-block td { padding: 4px 8px; border: 1px solid #000; font-size: 11pt; }
      .totals-block .label { color: #333; width: auto; }
      .totals-block .total-row td { font-weight: bold; background: #f0f0f0; font-size: 12pt; }
      .amount-words { margin: 10px 0; padding: 8px; border: 1px solid #000; font-size: 11pt; font-style: italic; }
      .amount-words b { font-style: normal; }
      .notes { margin: 10px 0; padding: 8px; border: 1px solid #ccc; font-size: 11pt; background: #fafafa; }
      .photos { margin: 10px 0; }
      .photos img { width: 90px; height: 90px; object-fit: cover; border: 1px solid #999; margin-right: 6px; margin-bottom: 6px; }
      .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 30px; padding-top: 12px; }
      .sig-block .sig-role { font-weight: bold; margin-bottom: 38px; font-size: 11pt; }
      .sig-block .sig-line { border-bottom: 1px solid #000; margin-bottom: 4px; }
      .sig-block .sig-name { font-size: 10pt; color: #555; font-style: italic; }
      .stamp-area { margin-top: 24px; padding: 16px; border: 1px dashed #999; text-align: center; color: #aaa; font-size: 10pt; width: 200px; }
      .doc-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 9pt; color: #666; }
      .qr-corner { position: absolute; top: 0; right: 0; }
      /* Hide screen-only elements when printing */
      .screen-only, button { display: none !important; }
      @media print {
        body { margin: 0; }
        .photos img { width: 80px; height: 80px; }
      }
    </style></head><body>${el.innerHTML}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 500)
  }

  const { data: evidence } = useQuery({
    queryKey: ['maintenance-evidence', maintenanceId],
    queryFn: () => api.get(`/maintenance/${maintenanceId}/evidence`).then(r => r.data.data),
  })

  if (isLoading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Loader2 className="w-8 h-8 animate-spin text-white" />
    </div>
  )
  if (!record) return null

  const items = record.items?.length > 0 ? record.items : (record.sparePart ? [{ sparePart: record.sparePart, quantityUsed: record.quantityUsed, unitCost: record.cost }] : [])
  const totalParts = items.reduce((s: number, i: any) => s + Number(i.unitCost) * i.quantityUsed, 0)
  const totalAll = totalParts + Number(record.laborCost || 0)

  // Norasmiy yozuv uchun "Buxgalteriya" variantini tanlasak — kontentni man qilamiz
  const recordIsOfficial = (record as any).isOfficial !== false
  const blockedForBuxgalteriya = variant === 'buxgalteriya' && !recordIsOfficial

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Toolbar — print da ko'rinmaydi */}
        <div className="flex items-center justify-between px-5 py-3 border-b print:hidden">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-800">Texnik xizmat dalolatnomasi</h2>
            {/* Variant tanlash — soddalashtirilgan rejimda faqat Buxgalteriya */}
            {simplifiedMode ? (
              <span className="text-xs px-3 py-1 bg-gray-100 rounded-md font-medium text-gray-700">
                📑 Buxgalteriya
              </span>
            ) : (
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setVariant('umumiy')}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    variant === 'umumiy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="Barcha yozuvlar (rasmiy + norasmiy)"
                >
                  📄 Umumiy
                </button>
                <button
                  onClick={() => setVariant('buxgalteriya')}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    variant === 'buxgalteriya' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="Faqat rasmiy yozuvlar uchun"
                >
                  📑 Buxgalteriya
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              disabled={blockedForBuxgalteriya}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" /> Chop etish
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Hujjat — scroll */}
        <div className="overflow-y-auto flex-1 p-6 bg-white">
          {/* Norasmiy yozuv "Buxgalteriya" variantida tanlanganda ogohlantirish */}
          {blockedForBuxgalteriya && (
            <div className="mb-4 bg-orange-50 border-2 border-orange-300 rounded-xl p-5 text-center">
              <p className="text-2xl font-bold text-orange-700 mb-2">⚠ Bu yozuv norasmiy</p>
              <p className="text-sm text-orange-600 mb-1">
                Bu texnik xizmat <b>norasmiy</b> deb belgilangan (ko'chadan, hujjatsiz qism).
              </p>
              <p className="text-sm text-orange-600">
                Buxgalteriya hujjati sifatida chiqarib bo'lmaydi. <br />
                <button onClick={() => setVariant('umumiy')} className="text-blue-600 hover:underline font-semibold">
                  📄 Umumiy variantga o'ting
                </button>
              </p>
            </div>
          )}
          <div id="maintenance-doc-content" style={blockedForBuxgalteriya ? { display: 'none' } : undefined}>
          {/* Rasmiy sarlavha */}
          <div className="doc-header text-center border-b-2 border-gray-900 pb-3 mb-5 relative">
            <p className="org text-xs text-gray-600 tracking-widest uppercase">AvtoHisob — Avtopark boshqaruv tizimi</p>
            <h1 className="text-2xl font-bold tracking-[6px] text-gray-900 mt-1">DALOLATNOMA</h1>
            <p className="subtitle text-xs text-gray-500 mt-0.5">
              Texnik xizmat ko'rsatish hujjati
              {variant === 'buxgalteriya' && <span className="ml-2 font-semibold text-emerald-700">(Buxgalteriya uchun)</span>}
            </p>
            {qrDataUrl && (
              <div className="qr-corner absolute top-0 right-0 flex flex-col items-center">
                <img src={qrDataUrl} alt="QR" className="w-16 h-16 border border-gray-300" />
                <p className="text-[9px] text-gray-400 mt-0.5">Tekshirish</p>
              </div>
            )}
          </div>

          {/* Hujjat raqami va sana */}
          <div className="doc-meta flex justify-between items-center mb-3 text-sm">
            <div>
              <span className="text-gray-500">Hujjat raqami: </span>
              <span className="doc-no font-bold">DH-{record.id?.slice(0, 8).toUpperCase()}</span>
            </div>
            <div className="text-right">
              <span className="text-gray-500">Tuzilgan sanasi: </span>
              <span className="font-bold">{formatDateLong(record.installationDate)}</span>
            </div>
          </div>

          {/* Asosiy ma'lumotlar — chiziqli */}
          <div className="info-grid grid grid-cols-2 gap-x-6 gap-y-1 mb-4 text-sm">
            <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Avtomashina:</span><span className="value font-bold font-mono">{record.vehicle?.registrationNumber}</span></div>
            <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Marka/Model:</span><span className="value font-bold">{record.vehicle?.brand} {record.vehicle?.model}</span></div>
            <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Holat:</span>
              <span className={`value font-bold ${record.status === 'approved' ? 'text-green-700' : record.status === 'rejected' ? 'text-red-600' : 'text-amber-600'}`}>
                {record.status === 'approved' ? 'TASDIQLANGAN' : record.status === 'rejected' ? 'RAD ETILGAN' : 'KUTMOQDA'}
              </span>
            </div>
            <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Bajardi:</span><span className="value font-bold">{record.performedBy?.fullName || '—'}</span></div>
            {record.workerName && <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Usta:</span><span className="value font-bold">{record.workerName}</span></div>}
            {record.supplier?.name && <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Yetkazuvchi:</span><span className="value font-bold">{record.supplier.name}</span></div>}
            <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">To'lov turi:</span>
              <span className="value font-bold">{record.paymentType === 'cash' ? 'Naqd' : record.isPaid ? 'Qarz (to\'langan)' : 'Qarz'}</span>
            </div>
            {record.approvedBy?.fullName && <div className="border-b border-dotted border-gray-400 py-1"><span className="label text-gray-600 inline-block w-32">Tasdiqladi:</span><span className="value font-bold">{record.approvedBy.fullName}</span></div>}
          </div>

          {/* Ehtiyot qismlar jadvali */}
          {items.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-900 mb-2 uppercase tracking-wide">Bajarilgan ishlar va ehtiyot qismlar</h3>
              <table className="items w-full text-sm border-collapse border-2 border-gray-900">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="text-left px-2 py-1.5 border border-gray-900 font-bold w-10">№</th>
                    <th className="text-left px-2 py-1.5 border border-gray-900 font-bold">Nomi</th>
                    <th className="text-center px-2 py-1.5 border border-gray-900 font-bold w-20">Miqdor</th>
                    <th className="text-right px-2 py-1.5 border border-gray-900 font-bold w-32">Narxi (so'm)</th>
                    <th className="text-right px-2 py-1.5 border border-gray-900 font-bold w-32">Jami (so'm)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 border border-gray-900 ctr text-center">{i + 1}</td>
                      <td className="px-2 py-1.5 border border-gray-900">{item.sparePart?.name}</td>
                      <td className="px-2 py-1.5 border border-gray-900 ctr text-center">{item.quantityUsed} ta</td>
                      <td className="px-2 py-1.5 border border-gray-900 num text-right">{formatCurrency(Number(item.unitCost))}</td>
                      <td className="px-2 py-1.5 border border-gray-900 num text-right font-bold">{formatCurrency(Number(item.unitCost) * item.quantityUsed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Yakuniy summa — chiziqli */}
          <div className="totals-block w-3/5 ml-auto mb-3">
            <table className="w-full border-collapse">
              <tbody>
                {totalParts > 0 && (
                  <tr>
                    <td className="border border-gray-900 px-2 py-1.5 text-sm">Qism narxi (jami):</td>
                    <td className="border border-gray-900 px-2 py-1.5 text-sm text-right">{formatCurrency(totalParts)}</td>
                  </tr>
                )}
                {Number(record.laborCost) > 0 && (
                  <tr>
                    <td className="border border-gray-900 px-2 py-1.5 text-sm">Usta haqi:</td>
                    <td className="border border-gray-900 px-2 py-1.5 text-sm text-right">{formatCurrency(Number(record.laborCost))}</td>
                  </tr>
                )}
                <tr className="total-row">
                  <td className="border border-gray-900 px-2 py-2 font-bold bg-gray-100">JAMI:</td>
                  <td className="border border-gray-900 px-2 py-2 font-bold bg-gray-100 text-right text-base">{formatCurrency(totalAll)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Summa so'zda */}
          {totalAll > 0 && (
            <div className="amount-words border border-gray-900 p-2 mb-4 text-sm italic">
              <b className="not-italic">Summa so'z bilan: </b>
              {uzNumberToWords(totalAll)} so'm
            </div>
          )}

          {/* Izoh */}
          {record.notes && (
            <div className="notes border border-gray-300 bg-gray-50 p-2 mb-4 text-sm">
              <b>Izoh: </b>
              <span className="italic">{record.notes}</span>
            </div>
          )}

          {/* Fotolar */}
          {(evidence || []).length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                Fotolar ({(evidence || []).length} ta)
              </h3>
              <div className="flex gap-3 flex-wrap">
                {(evidence || []).map((ev: any) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setLightboxImage(getFileUrl(ev.fileUrl))}
                    className="relative group cursor-zoom-in"
                    title="Bosib kattalashtiring"
                  >
                    <img
                      src={getFileUrl(ev.fileUrl)}
                      alt="evidence"
                      style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e5e7eb' }}
                      className="w-32 h-32 object-cover rounded-lg border border-gray-200 transition-opacity group-hover:opacity-80"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors rounded-lg pointer-events-none">
                      <span className="text-white opacity-0 group-hover:opacity-100 text-xs font-medium bg-black/60 px-2 py-1 rounded">
                        🔍 Kattalashtirish
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Imzo qatorlari — rasmiy uslubda */}
          <div className="signatures grid grid-cols-2 gap-8 mt-10 text-sm">
            <div className="sig-block">
              <p className="sig-role font-bold mb-10">Bajardi:</p>
              <div className="sig-line border-b border-gray-900 mb-1" />
              <p className="sig-name text-xs text-gray-600 italic">
                {record.performedBy?.fullName || '________________________'}
              </p>
              <p className="text-xs text-gray-500 mt-2">Imzo: ___________ Sana: ___________</p>
            </div>
            <div className="sig-block">
              <p className="sig-role font-bold mb-10">Tasdiqladi (Rahbar):</p>
              <div className="sig-line border-b border-gray-900 mb-1" />
              <p className="sig-name text-xs text-gray-600 italic">
                {record.approvedBy?.fullName || '________________________'}
              </p>
              <p className="text-xs text-gray-500 mt-2">Imzo: ___________ Sana: ___________</p>
            </div>
          </div>

          {/* Shtamp joyi */}
          <div className="stamp-area mt-6 p-4 border border-dashed border-gray-400 text-center text-xs text-gray-400 w-52">
            M.O.<br/>
            (muhr o'rni)
          </div>

          {/* Pastki ma'lumot */}
          <div className="doc-footer mt-6 pt-2 border-t border-gray-300 flex justify-between text-xs text-gray-500">
            <span>Hujjat raqami: DH-{record.id?.slice(0, 8).toUpperCase()}</span>
            <span>AvtoHisob tizimi tomonidan elektron tarzda yaratildi · {new Date().toLocaleDateString('uz-UZ')}</span>
          </div>
          </div>{/* end maintenance-doc-content */}
        </div>
      </div>

      {/* Lightbox — to'liq o'lchamda rasm ko'rish */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxImage(null) }}
            className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full"
            title="Yopish (Esc)"
          >
            <X className="w-6 h-6" />
          </button>
          <a
            href={lightboxImage}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-4 left-4 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            ↗ Yangi tabda ochish
          </a>
          <img
            src={lightboxImage}
            alt="evidence-full"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
