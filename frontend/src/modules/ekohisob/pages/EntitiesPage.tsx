import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Plus, CalendarDays, AlertCircle, ShieldCheck, Loader2, X, Building2, MapPin, Navigation, FileText, Trash2, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import L from 'leaflet'
import ekoApi from '../lib/ekoApi'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import EntityLedgerModal from '../components/EntityLedgerModal'
import ServiceProofModal from '../components/ServiceProofModal'

// Leaflet icon fix
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

type Status = 'active' | 'blacklisted' | 'inactive' | 'draft'
type BillingMode = 'monthly_fixed' | 'variable' | 'talon'

interface Entity {
  id: string
  code: string
  name: string
  address: string
  monthlyFee: number
  status: Status
  billingMode?: BillingMode
  cubicPrice?: number
  debtLevel?: string
  phone?: string
  districtId: string
  mahallId: string
  mahallName?: string
  stir?: string
  lat?: number
  lon?: number
}

const DEBT_LEVEL_BADGE: Record<string, { dot: string; label: string }> = {
  current:    { dot: 'bg-green-400',  label: 'Joriy' },
  warning:    { dot: 'bg-yellow-400', label: '1 oy' },
  overdue:    { dot: 'bg-orange-500', label: '2 oy' },
  critical:   { dot: 'bg-red-600',   label: '3+ oy' },
  blacklisted:{ dot: 'bg-gray-700',  label: "Qora ro'yxat" },
}

interface District {
  id: string
  name: string
}

interface Mahalla {
  id: string
  name: string
  districtId: string
}

const STATUS_LABELS: Record<Status, string> = {
  active: 'Faol',
  blacklisted: "Qora ro'yxat",
  inactive: 'Nofaol',
  draft: '🟡 Chala (to\'ldirilmagan)',
}

const STATUS_COLORS: Record<Status, string> = {
  active: 'bg-green-100 text-green-700',
  blacklisted: 'bg-red-100 text-red-700',
  inactive: 'bg-gray-100 text-gray-600',
  draft: 'bg-amber-100 text-amber-700',
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('uz-UZ') + " so'm"
}

// ─── Talon ro'yxati va qo'shish (talon asosida — kub × narx) ─────────────────
interface Talon { id: string; volume: number; amount: number; date: string; note?: string; paid: boolean }

function TalonModal({ entity, onClose, readOnly = false }: { entity: Entity; onClose: () => void; readOnly?: boolean }) {
  const [talons, setTalons] = useState<Talon[]>([])
  const [total, setTotal] = useState(0)
  const [totalUnpaid, setTotalUnpaid] = useState(0)
  const [totalVolume, setTotalVolume] = useState(0)
  const [cubicPrice, setCubicPrice] = useState(entity.cubicPrice || 0)
  const [loading, setLoading] = useState(false)
  // Davr filtri (oy) — '' = barchasi
  const [filterMonth, setFilterMonth] = useState('')
  // Yangi talon formasi
  const [volume, setVolume] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const fmt = (n: number) => n.toLocaleString('uz-UZ')

  function load() {
    setLoading(true)
    let url = `/talons?entityId=${entity.id}`
    if (filterMonth) {
      url += `&from=${filterMonth}-01&to=${filterMonth}-31`
    }
    ekoApi.get(url).then(res => {
      const d = res.data.data ?? res.data
      setTalons(d.talons || [])
      setTotal(d.total || 0)
      setTotalUnpaid(d.totalUnpaid || 0)
      setTotalVolume(d.totalVolume || 0)
    }).catch(() => {}).finally(() => setLoading(false))
    ekoApi.get(`/entities/${entity.id}`).then(res => {
      const d = res.data.data ?? res.data
      setCubicPrice(d.cubicPrice || 0)
    }).catch(() => {})
  }
  useEffect(load, [entity.id, filterMonth])

  const previewAmount = volume && cubicPrice ? Math.round(parseFloat(volume) * cubicPrice) : 0

  async function addTalon() {
    const v = parseFloat(volume)
    if (!v || v <= 0) { toast.error('Kub (hajm) kiriting'); return }
    if (cubicPrice <= 0) { toast.error('Avval tashkilotga bir kub narxini belgilang'); return }
    setSaving(true)
    try {
      await ekoApi.post('/talons', { entityId: entity.id, volume: v, date, note: note.trim() || undefined })
      toast.success('Talon qo\'shildi')
      setVolume(''); setNote('')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Xato')
    } finally { setSaving(false) }
  }

  async function togglePaid(t: Talon) {
    try {
      await ekoApi.patch(`/talons/${t.id}`, { paid: !t.paid })
      load()
    } catch { toast.error('Xato') }
  }

  async function removeTalon(id: string) {
    if (!window.confirm('Talon o\'chirilsinmi?')) return
    try {
      await ekoApi.delete(`/talons/${id}`)
      toast.success('O\'chirildi')
      load()
    } catch { toast.error('Xato') }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">📋 Talonlar — {entity.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Bir kub narxi: <b>{fmt(cubicPrice)} so'm</b>
              {cubicPrice <= 0 && <span className="text-red-500"> — belgilanmagan!</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {/* Davr filtri */}
        <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-2">
          <span className="text-xs text-gray-500">Davr:</span>
          <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-200 rounded-lg" />
          {filterMonth && (
            <button onClick={() => setFilterMonth('')} className="text-xs text-blue-600 hover:underline">Barchasi</button>
          )}
        </div>

        {/* Hisob xulosa */}
        <div className="grid grid-cols-3 gap-2 px-5 py-3 border-b border-gray-100">
          <div className="bg-blue-50 rounded-lg p-2.5">
            <p className="text-xs text-blue-500">Jami hajm</p>
            <p className="text-base font-bold text-blue-700">{totalVolume.toFixed(1)} <span className="text-xs font-normal">m³</span></p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-500">Jami summa</p>
            <p className="text-base font-bold text-gray-800">{fmt(total)}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-2.5">
            <p className="text-xs text-red-500">To'lanmagan</p>
            <p className="text-base font-bold text-red-700">{fmt(totalUnpaid)}</p>
          </div>
        </div>

        {/* Yangi talon — faqat yozish huquqi borlar uchun */}
        {!readOnly && (
        <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/40">
          <p className="text-xs font-semibold text-gray-600 mb-2">➕ Yangi talon (bajarilgan ish)</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Sana</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Kub (m³)</label>
              <input type="number" step="0.1" value={volume} onChange={e => setVolume(e.target.value)}
                placeholder="3.5" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Summa</label>
              <div className="px-2 py-1.5 text-sm bg-gray-100 rounded-lg text-gray-700 font-medium">{fmt(previewAmount)}</div>
            </div>
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy)"
            className="w-full mt-2 px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
          <button onClick={addTalon} disabled={saving || cubicPrice <= 0}
            className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Talon qo'shish
          </button>
        </div>
        )}

        {/* Ro'yxat */}
        <div className="overflow-y-auto flex-1 p-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : talons.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">Hali talon yo'q</p>
          ) : (
            <div className="space-y-1.5">
              {talons.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{t.volume} m³ · {fmt(t.amount)} so'm</p>
                    <p className="text-xs text-gray-400">{new Date(t.date).toLocaleDateString('uz-UZ')}{t.note ? ` · ${t.note}` : ''}</p>
                  </div>
                  <button onClick={() => !readOnly && togglePaid(t)} disabled={readOnly}
                    className={`text-xs px-2 py-1 rounded-full font-medium ${t.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} ${readOnly ? 'cursor-default' : ''}`}>
                    {t.paid ? '✓ To\'langan' : 'To\'lanmagan'}
                  </button>
                  {!readOnly && (
                    <button onClick={() => removeTalon(t.id)} className="p-1 text-gray-300 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Korxona ma'lumotlari + Xaritadan manzil belgilash ───────────────────────
function LocationPickerModal({
  entity, onClose, onSaved,
}: { entity: Entity; onClose: () => void; onSaved: () => void }) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef    = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    entity.lat && entity.lon ? { lat: entity.lat, lng: entity.lon } : null
  )
  const [address,     setAddress]     = useState(entity.address || '')
  const [phone,       setPhone]       = useState('')
  const [contactName, setContactName] = useState('')
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [satellite, setSatellite] = useState(false)
  const tileRef = useRef<L.TileLayer | null>(null)

  // Manzil bo'yicha xaritadan topish (Nominatim OSM geocoding)
  async function geocodeAddress() {
    const q = address.trim()
    if (!q) { toast.error('Avval manzilni yozing'); return }
    setGeocoding(true)
    try {
      // O'zbekiston bilan cheklab, aniqroq natija
      const url = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(q + ', Uzbekistan')}&format=json&limit=1&countrycodes=uz`
      const res = await fetch(url, { headers: { 'Accept-Language': 'uz,ru,en' } })
      const data = await res.json()
      if (!data || data.length === 0) {
        toast.error('Manzil topilmadi. Xaritadan qo\'lda belgilang yoki aniqroq yozing.')
        return
      }
      const lat = parseFloat(data[0].lat)
      const lng = parseFloat(data[0].lon)
      setCoords({ lat, lng })
      const map = mapRef.current
      if (map) {
        map.flyTo([lat, lng], 17, { duration: 0.8 })
        if (markerRef.current) markerRef.current.setLatLng([lat, lng])
        else {
          const m = L.marker([lat, lng], { draggable: true }).addTo(map)
          m.on('dragend', () => { const p = m.getLatLng(); setCoords({ lat: p.lat, lng: p.lng }) })
          markerRef.current = m
        }
      }
      toast.success('Topildi! Aniqlik uchun markerni sudrang.')
    } catch {
      toast.error('Qidirishda xato. Internet yoki manzilni tekshiring.')
    } finally { setGeocoding(false) }
  }

  // Tashkilot to'liq ma'lumotlarini yuklash
  useEffect(() => {
    ekoApi.get(`/entities/${entity.id}`).then(res => {
      const d = res.data.data ?? res.data
      setAddress(d.address || '')
      setPhone(d.phone || '')
      setContactName(d.contactName || '')
      if (d.lat && d.lon && !coords) {
        setCoords({ lat: d.lat, lng: d.lon })
      }
    }).catch(() => {})
  }, [entity.id])

  // Xarita boshlash
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    const initCoords: [number, number] = coords ? [coords.lat, coords.lng] : [41.2995, 69.2401]
    const map = L.map(mapDivRef.current, { center: initCoords, zoom: coords ? 16 : 12, maxZoom: 21 })
    tileRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 21, maxNativeZoom: 19,
    }).addTo(map)

    if (coords) {
      const m = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(map)
      m.on('dragend', () => { const p = m.getLatLng(); setCoords({ lat: p.lat, lng: p.lng }) })
      markerRef.current = m
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      setCoords({ lat, lng })
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        const m = L.marker([lat, lng], { draggable: true }).addTo(map)
        m.on('dragend', () => { const p = m.getLatLng(); setCoords({ lat: p.lat, lng: p.lng }) })
        markerRef.current = m
      }
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
  }, [])

  // Tashqi coords o'zgarganda markerni ko'chirish
  useEffect(() => {
    if (coords && markerRef.current) {
      markerRef.current.setLatLng([coords.lat, coords.lng])
    }
  }, [coords?.lat, coords?.lng])

  // Tile almashtirish (oddiy / sun'iy yo'ldosh)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !tileRef.current) return
    map.removeLayer(tileRef.current)
    tileRef.current = satellite
      ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 21, maxNativeZoom: 18 })
      : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 21, maxNativeZoom: 19 })
    tileRef.current.addTo(map)
  }, [satellite])

  async function handleSave() {
    setSaving(true)
    try {
      const updates: Promise<any>[] = []

      // Ma'lumotlarni saqlash
      updates.push(ekoApi.put(`/entities/${entity.id}`, { address, phone, contactName }))

      // Koordinatani saqlash (tanlangan bo'lsa)
      if (coords) {
        updates.push(ekoApi.put(`/entities/${entity.id}/location`, { lat: coords.lat, lon: coords.lng }))
      }

      await Promise.all(updates)
      toast.success('Saqlandi')
      onSaved()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Xato')
    } finally { setSaving(false) }
  }

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full flex flex-col" style={{ maxWidth: '900px', height: '85vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">📍 Korxona ma'lumotlari va manzil</h2>
            <p className="text-xs text-gray-500 mt-0.5">{entity.name} · {entity.code}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Asosiy kontent — ikki panel */}
        <div className="flex flex-1 min-h-0">

          {/* ── Chap panel: Ma'lumotlar ── */}
          <div className="w-72 shrink-0 border-r border-gray-100 flex flex-col overflow-y-auto p-4 space-y-4">

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Korxona ma'lumotlari</p>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 font-medium block mb-1">Nomi</label>
                  <div className="px-3 py-2 text-sm bg-gray-50 rounded-lg text-gray-700 border border-gray-100">
                    {entity.name}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-600 font-medium block mb-1">Manzil *</label>
                  <textarea
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    rows={2}
                    placeholder="Masalan: Yunusobod tumani, Amir Temur ko'chasi 12"
                    className={inputCls + ' resize-none'}
                  />
                  <button
                    type="button"
                    onClick={geocodeAddress}
                    disabled={geocoding || !address.trim()}
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    Manzilni xaritadan topish
                  </button>
                  <p className="text-[10px] text-gray-400 mt-1">Manzilni yozib tugmani bosing — xarita o'sha joyga uchadi</p>
                </div>

                <div>
                  <label className="text-xs text-gray-600 font-medium block mb-1">Telefon</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+998 90 123 45 67"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600 font-medium block mb-1">Mas'ul shaxs</label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder="Ism Familiya"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* Koordinata info */}
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Joylashuv</p>
              {coords ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                    <MapPin className="w-3.5 h-3.5" /> Joy belgilandi
                  </div>
                  <p className="text-xs font-mono text-gray-500">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </p>
                  <a
                    href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
                  >
                    <Navigation className="w-3 h-3" /> Google Maps da ko'rish
                  </a>
                </div>
              ) : (
                <p className="text-xs text-orange-500 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> O'ngdagi xaritadan joy tanlang
                </p>
              )}
            </div>

            {/* Yo'riqnoma */}
            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Qanday ishlaydi?</p>
              <p>🖱 Xaritada korxona joylashgan joyga bosing</p>
              <p>✋ Markerni sudrab aniqroq joyga qo'ying</p>
              <p>🔍 Zoom uchun g'ildirak yoki +/− tugmalar</p>
            </div>
          </div>

          {/* ── O'ng panel: Xarita ── */}
          <div className="flex-1 relative">
            <div ref={mapDivRef} className="absolute inset-0" />
            {/* Sun'iy yo'ldosh toggle */}
            <button
              type="button"
              onClick={() => setSatellite(v => !v)}
              className="absolute top-3 right-3 z-[500] flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-md border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <MapPin className="w-3.5 h-3.5" />
              {satellite ? 'Oddiy' : "Sun'iy yo'ldosh"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-400">
            {coords ? '✓ Koordinata tayyor' : '⚠ Koordinata belgilanmagan (ixtiyoriy)'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
              Bekor
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5 font-medium"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Saqlash
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface NewEntityForm {
  code: string
  name: string
  address: string
  monthlyFee: string
  districtId: string
  mahallId: string
  stir: string
  billingMode: BillingMode
  cubicPrice: string
  contractNumber: string
}

const EMPTY_FORM: NewEntityForm = {
  code: '',
  name: '',
  address: '',
  monthlyFee: '',
  districtId: '',
  mahallId: '',
  stir: '',
  billingMode: 'variable',
  cubicPrice: '',
  contractNumber: '',
}

export default function EntitiesPage({ readOnly = false }: { readOnly?: boolean }) {
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterDistrict, setFilterDistrict] = useState('')
  const [filterMahalla, setFilterMahalla] = useState('')
  const [filterStatus, setFilterStatus] = useState<Status | ''>('')
  const [districts, setDistricts] = useState<District[]>([])
  const [mahallas, setMahallas] = useState<Mahalla[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [paymentEntity, setPaymentEntity] = useState<EntityBasic | null>(null)
  const [ledgerEntity, setLedgerEntity] = useState<Entity | null>(null)
  const [proofEntity, setProofEntity]   = useState<Entity | null>(null)
  const [locationEntity, setLocationEntity] = useState<Entity | null>(null)
  const [talonEntity, setTalonEntity] = useState<Entity | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewEntityForm>(EMPTY_FORM)
  const [formMahallas, setFormMahallas] = useState<Mahalla[]>([])
  const [formLoading, setFormLoading] = useState(false)
  const [blacklistTarget, setBlacklistTarget] = useState<Entity | null>(null)
  const [blacklistReason, setBlacklistReason] = useState('')
  const [filterDebtLevel, setFilterDebtLevel] = useState('')
  const [smsLoadingId, setSmsLoadingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const PAGE_SIZE = 20

  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!filterDistrict) {
      setMahallas([])
      setFilterMahalla('')
      return
    }
    ekoApi.get(`/mahallas?districtId=${filterDistrict}`).then(res => {
      const data = res.data.data ?? res.data
      setMahallas(Array.isArray(data) ? data : [])
      setFilterMahalla('')
    }).catch(() => {})
  }, [filterDistrict])

  useEffect(() => {
    if (!form.districtId) {
      setFormMahallas([])
      return
    }
    ekoApi.get(`/mahallas?districtId=${form.districtId}`).then(res => {
      const data = res.data.data ?? res.data
      setFormMahallas(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [form.districtId])

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const fetchEntities = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (filterDistrict) params.set('districtId', filterDistrict)
    if (filterMahalla) params.set('mahallId', filterMahalla)
    if (filterStatus) params.set('status', filterStatus)
    if (filterDebtLevel) params.set('debtLevel', filterDebtLevel)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    ekoApi.get(`/entities?${params.toString()}`)
      .then(res => {
        // Backend: { success, data: Entity[], meta: { total, page, limit } }
        const list = Array.isArray(res.data.data) ? res.data.data : (res.data.data?.items ?? [])
        setEntities(list)
        setTotal(res.data.meta?.total ?? list.length ?? 0)
      })
      .catch(() => { setEntities([]) })
      .finally(() => setLoading(false))
  }, [debouncedSearch, filterDistrict, filterMahalla, filterStatus, filterDebtLevel, page])

  useEffect(() => { fetchEntities() }, [fetchEntities])

  async function confirmBlacklist() {
    if (!blacklistTarget) return
    if (!blacklistReason.trim()) { toast.error('Sabab kiritilishi shart'); return }
    try {
      await ekoApi.post('/blacklist', { entityId: blacklistTarget.id, reason: blacklistReason.trim() })
      toast.success("Qora ro'yxatga qo'shildi")
      setBlacklistTarget(null); setBlacklistReason('')
      fetchEntities()
    } catch { toast.error("Xato yuz berdi") }
  }

  async function handleSmsReminder(entity: Entity) {
    if (!window.confirm(`${entity.name} tashkilotiga qarz haqida SMS eslatma yuborilsinmi?`)) return
    setSmsLoadingId(entity.id)
    try {
      const res = await ekoApi.post('/reminders/sms', { entityId: entity.id })
      const debt = res.data.data?.debt
      toast.success(`SMS yuborildi${debt ? ` (qarz: ${Math.round(debt).toLocaleString('en-US').replace(/,/g, ' ')} so'm)` : ''}`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'SMS yuborilmadi')
    } finally {
      setSmsLoadingId(null)
    }
  }

  function exportExcel() {
    const rows = entities.map(e => [e.code, e.name, e.address, e.stir || '', e.monthlyFee, STATUS_LABELS[e.status]])
    const header = ['Kod', 'Nomi', 'Manzil', 'STIR', 'Oylik to\'lov', 'Holat']
    const csv = [header, ...rows].map(r => r.join('\t')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'tashkilotlar.xls'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCreateEntity(e: React.FormEvent) {
    e.preventDefault()
    const isTalon = form.billingMode === 'talon'
    if (!form.name.trim() || !form.address.trim() || (isTalon ? !form.cubicPrice : !form.monthlyFee)) {
      toast.error("Majburiy maydonlarni to'ldiring")
      return
    }
    setFormLoading(true)
    try {
      await ekoApi.post('/entities', {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        address: form.address.trim(),
        monthlyFee: isTalon ? 0 : parseInt(form.monthlyFee, 10),
        cubicPrice: isTalon ? parseInt(form.cubicPrice, 10) : 0,
        districtId: form.districtId || undefined,
        mahallId: form.mahallId || undefined,
        stir: form.stir.trim() || undefined,
        billingMode: form.billingMode,
        contractNumber: form.contractNumber.trim() || undefined,
      })
      toast.success('Tashkilot qo\'shildi')
      setShowModal(false)
      setForm(EMPTY_FORM)
      fetchEntities()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Xato yuz berdi'
      toast.error(msg)
    } finally {
      setFormLoading(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Tashkilotlar</h1>
          <p className="text-xs text-gray-500 mt-0.5">Jami: {total} ta</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            📊 Excel
          </button>
          {!readOnly && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Yangi tashkilot
            </button>
          )}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Nom, STIR, kod bo'yicha qidirish..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <select
            value={filterDistrict}
            onChange={e => { setFilterDistrict(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[130px]"
          >
            <option value="">Barcha tumanlar</option>
            {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          {filterDistrict && mahallas.length > 0 && (
            <select
              value={filterMahalla}
              onChange={e => { setFilterMahalla(e.target.value); setPage(1) }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[130px]"
            >
              <option value="">Barcha mahallalar</option>
              {mahallas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}

          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value as Status | ''); setPage(1) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[120px]"
          >
            <option value="">Barcha holat</option>
            <option value="draft">🟡 Chala (botdan)</option>
            <option value="active">Faol</option>
            <option value="blacklisted">Qora ro'yxat</option>
            <option value="inactive">Nofaol</option>
          </select>

          <select
            value={filterDebtLevel}
            onChange={e => { setFilterDebtLevel(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[130px]"
          >
            <option value="">Barcha qarz</option>
            <option value="current">✅ Joriy</option>
            <option value="warning">🟡 1 oy</option>
            <option value="overdue">🟠 2 oy</option>
            <option value="critical">🔴 3+ oy</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : entities.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Tashkilotlar topilmadi</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kod</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Manzil</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Oylik to'lov</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Holat</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entities.map(entity => (
                  <tr key={entity.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{entity.code || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{entity.name}</p>
                        {entity.billingMode === 'monthly_fixed' && (
                          <span className="bg-indigo-100 text-indigo-700 text-[10px] font-medium px-1.5 py-0.5 rounded">
                            Belgilangan
                          </span>
                        )}
                        {entity.billingMode === 'monthly_fixed' && entity.debtLevel && entity.debtLevel !== 'current' && (
                          (() => {
                            const badge = DEBT_LEVEL_BADGE[entity.debtLevel!]
                            return badge ? (
                              <span className="flex items-center gap-1 text-[10px] font-medium text-gray-600">
                                <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                                {badge.label} qarz
                              </span>
                            ) : null
                          })()
                        )}
                      </div>
                      {entity.mahallName && (
                        <p className="text-xs text-gray-400 mt-0.5">{entity.mahallName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell max-w-[180px] truncate">{entity.address}</td>
                    <td className="px-4 py-3 text-gray-700 font-medium hidden lg:table-cell">{formatAmount(entity.monthlyFee)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[entity.status]}`}>
                        {STATUS_LABELS[entity.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {entity.billingMode === 'talon' ? (
                          <button
                            title="Talonlar (bajarilgan ish)"
                            onClick={() => setTalonEntity(entity)}
                            className="p-1.5 hover:bg-amber-50 hover:text-amber-600 rounded-lg transition-colors text-gray-400"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            title="To'lovlar tasmasi"
                            onClick={() => setLedgerEntity(entity)}
                            className="p-1.5 hover:bg-green-50 hover:text-green-600 rounded-lg transition-colors text-gray-400"
                          >
                            <CalendarDays className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          title="Xizmat isboti (GPS)"
                          onClick={() => setProofEntity(entity)}
                          className="p-1.5 hover:bg-emerald-50 hover:text-emerald-600 rounded-lg transition-colors text-gray-400"
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                        <button
                          title={entity.lat ? 'Manzilni ko\'rish / yangilash' : 'Xaritadan belgilash'}
                          onClick={() => setLocationEntity(entity)}
                          className={`p-1.5 rounded-lg transition-colors ${entity.lat ? 'text-blue-500 hover:bg-blue-50' : 'text-gray-400 hover:bg-blue-50 hover:text-blue-500'}`}
                        >
                          <MapPin className="w-4 h-4" />
                        </button>
                        {!readOnly && entity.status === 'active' && entity.phone && (
                          <button
                            title="Qarz haqida SMS eslatma yuborish"
                            onClick={() => handleSmsReminder(entity)}
                            disabled={smsLoadingId === entity.id}
                            className="p-1.5 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors text-gray-400 disabled:opacity-50"
                          >
                            {smsLoadingId === entity.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                          </button>
                        )}
                        {!readOnly && entity.status === 'active' && (
                          <button
                            title="Qora ro'yxatga qo'shish"
                            onClick={() => { setBlacklistTarget(entity); setBlacklistReason('') }}
                            className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400"
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">{total} ta tashkilot</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition-colors"
              >
                Oldingi
              </button>
              <span className="text-xs text-gray-600">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition-colors"
              >
                Keyingi
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Entity Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Yangi tashkilot qo'shish</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateEntity} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Kod</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="E001"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">STIR</label>
                  <input
                    type="text"
                    value={form.stir}
                    onChange={e => setForm(f => ({ ...f, stir: e.target.value }))}
                    placeholder="123456789"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Tashkilot nomi"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Manzil <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Toshkent sh., Chilonzor t., ..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  {form.billingMode === 'talon' ? (
                    <>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Bir kub narxi (so'm) <span className="text-red-500">*</span></label>
                      <input
                        required
                        type="number"
                        value={form.cubicPrice}
                        onChange={e => setForm(f => ({ ...f, cubicPrice: e.target.value }))}
                        placeholder="50000"
                        min={1}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </>
                  ) : (
                    <>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Oylik to'lov (so'm) <span className="text-red-500">*</span></label>
                      <input
                        required
                        type="number"
                        value={form.monthlyFee}
                        onChange={e => setForm(f => ({ ...f, monthlyFee: e.target.value }))}
                        placeholder="50000"
                        min={1}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">To'lov rejimi</label>
                  <select
                    value={form.billingMode}
                    onChange={e => setForm(f => ({ ...f, billingMode: e.target.value as BillingMode }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="variable">O'zgaruvchan (har oy har xil)</option>
                    <option value="monthly_fixed">Belgilangan oylik (avto-hisob)</option>
                    <option value="talon">Talon (bajarilgan ish — kub)</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-400 -mt-2">
                {form.billingMode === 'talon'
                  ? '«Talon» — oylik to\'lov yo\'q. Har bajarilgan ish: kub × bir kub narxi = qarzga qo\'shiladi.'
                  : form.billingMode === 'monthly_fixed'
                  ? '«Belgilangan oylik» — har oy avtomatik hisob yoziladi va qarz hisoblanadi.'
                  : '«O\'zgaruvchan» — faqat to\'lov qilganda yoziladi, qarz to\'planmaydi.'}
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tuman</label>
                  <select
                    value={form.districtId}
                    onChange={e => setForm(f => ({ ...f, districtId: e.target.value, mahallId: '' }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Tanlang</option>
                    {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Mahalla</label>
                  <select
                    value={form.mahallId}
                    onChange={e => setForm(f => ({ ...f, mahallId: e.target.value }))}
                    disabled={formMahallas.length === 0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                  >
                    <option value="">Tanlang</option>
                    {formMahallas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ledger (month timeline) Modal */}
      {ledgerEntity && (
        <EntityLedgerModal
          entityId={ledgerEntity.id}
          entityName={ledgerEntity.name}
          onClose={() => setLedgerEntity(null)}
          onAddPayment={() => {
            setPaymentEntity({
              id: ledgerEntity.id,
              name: ledgerEntity.name,
              address: ledgerEntity.address,
              monthlyFee: ledgerEntity.monthlyFee,
            })
            setLedgerEntity(null)
          }}
        />
      )}

      {/* Talon ro'yxati / qo'shish */}
      {talonEntity && (
        <TalonModal
          entity={talonEntity}
          onClose={() => setTalonEntity(null)}
          readOnly={readOnly}
        />
      )}

      {/* Qora ro'yxat tasdiqlash */}
      {blacklistTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Qora ro'yxatga qo'shish
            </h3>
            <p className="text-sm text-gray-600">
              <span className="font-medium">"{blacklistTarget.name}"</span> tashkilotini qora ro'yxatga qo'shmoqchisiz.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sabab *</label>
              <textarea
                value={blacklistReason}
                onChange={e => setBlacklistReason(e.target.value)}
                rows={3}
                placeholder="Qora ro'yxatga qo'shish sababi..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setBlacklistTarget(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Bekor</button>
              <button
                onClick={confirmBlacklist}
                disabled={!blacklistReason.trim()}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Qo'shish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Location Picker Modal */}
      {locationEntity && (
        <LocationPickerModal
          entity={locationEntity}
          onClose={() => setLocationEntity(null)}
          onSaved={() => { setLocationEntity(null); fetchEntities() }}
        />
      )}

      {/* Service Proof (GPS) Modal */}
      {proofEntity && (
        <ServiceProofModal
          entityId={proofEntity.id}
          entityName={proofEntity.name}
          hasLocation={Boolean(proofEntity.lat && proofEntity.lon)}
          onClose={() => setProofEntity(null)}
        />
      )}

      {/* Payment Modal */}
      {paymentEntity && (
        <PaymentModal
          entity={paymentEntity}
          onClose={() => setPaymentEntity(null)}
          onSuccess={fetchEntities}
        />
      )}
    </div>
  )
}
