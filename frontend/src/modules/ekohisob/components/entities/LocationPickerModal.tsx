import { useEffect, useRef, useState } from 'react'
import { MapPin, Navigation, Search } from 'lucide-react'
import L from 'leaflet'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { invalidateEko } from '../../lib/queries'
import { Banner, Button, Field, Input, Modal, Textarea } from '../../ui'
import type { Entity } from './types'

// Leaflet standart ikonkalari (bundler yo'lini topa olmaydi)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OSM = { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { attribution: '© OpenStreetMap', maxZoom: 21, maxNativeZoom: 19 } }
const SAT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  opt: { attribution: '© Esri', maxZoom: 21, maxNativeZoom: 18 },
}

type Coords = { lat: number; lng: number }

/**
 * Manzil/telefon va xaritadan joy belgilash. ui/Modal (xl) ichida Leaflet:
 * xarita konteyneri `isolate` — Leaflet ichki z-index'lari modal ustiga chiqmaydi;
 * modal ochilish animatsiyasidan keyin `invalidateSize()` chaqiriladi; fon bosilganda
 * yopilmaydi (xaritani sudrashda tasodifan yopilmasin).
 */
export default function LocationPickerModal({
  entity, onClose, onSaved,
}: { entity: Entity; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)

  const [coords, setCoords] = useState<Coords | null>(
    entity.lat && entity.lon ? { lat: entity.lat, lng: entity.lon } : null,
  )
  const [address, setAddress] = useState(entity.address || '')
  const [phone, setPhone] = useState('')
  const [contactName, setContactName] = useState('')
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [satellite, setSatellite] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const detail = useQuery({
    queryKey: [...['eko', 'entities'], 'detail', entity.id],
    queryFn: async () => (await ekoApi.get(`/entities/${entity.id}`)).data.data,
    staleTime: 0,
    gcTime: 0,
  })
  useEffect(() => {
    const d = detail.data
    if (!d || loaded) return
    setAddress(d.address || '')
    setPhone(d.phone || '')
    setContactName(d.contactName || '')
    if (d.lat && d.lon && !coords) setCoords({ lat: d.lat, lng: d.lon })
    setLoaded(true)
  }, [detail.data, loaded, coords])

  function putMarker(lat: number, lng: number) {
    const map = mapRef.current
    if (!map) return
    if (markerRef.current) markerRef.current.setLatLng([lat, lng])
    else {
      const m = L.marker([lat, lng], { draggable: true }).addTo(map)
      m.on('dragend', () => { const p = m.getLatLng(); setCoords({ lat: p.lat, lng: p.lng }) })
      markerRef.current = m
    }
  }

  // Xaritani bir marta yaratish
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    const start: [number, number] = coords ? [coords.lat, coords.lng] : [41.2995, 69.2401]
    const map = L.map(mapDivRef.current, { center: start, zoom: coords ? 16 : 12, maxZoom: 21 })
    tileRef.current = L.tileLayer(OSM.url, OSM.opt).addTo(map)
    mapRef.current = map
    if (coords) putMarker(coords.lat, coords.lng)
    map.on('click', (e: L.LeafletMouseEvent) => {
      setCoords({ lat: e.latlng.lat, lng: e.latlng.lng })
      putMarker(e.latlng.lat, e.latlng.lng)
    })
    const t = window.setTimeout(() => map.invalidateSize(), 250)   // modal animatsiyasidan keyin
    return () => { window.clearTimeout(t); map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Aniqlangan koordinata kelganda marker
  useEffect(() => {
    if (coords && mapRef.current) putMarker(coords.lat, coords.lng)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !tileRef.current) return
    map.removeLayer(tileRef.current)
    const t = satellite ? SAT : OSM
    tileRef.current = L.tileLayer(t.url, t.opt).addTo(map)
  }, [satellite])

  async function geocode() {
    const q = address.trim()
    if (!q) { toast.error('Avval manzilni yozing'); return }
    setGeocoding(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Uzbekistan')}&format=json&limit=1&countrycodes=uz`
      const res = await fetch(url, { headers: { 'Accept-Language': 'uz,ru,en' } })
      const data = await res.json()
      if (!data?.length) { toast.error("Manzil topilmadi. Xaritadan qo'lda belgilang yoki aniqroq yozing."); return }
      const lat = parseFloat(data[0].lat)
      const lng = parseFloat(data[0].lon)
      setCoords({ lat, lng })
      mapRef.current?.flyTo([lat, lng], 17, { duration: 0.8 })
      toast.success('Topildi. Aniqlik uchun markerni sudrang.')
    } catch {
      toast.error('Qidirishda xato. Internetni tekshiring.')
    } finally { setGeocoding(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const jobs: Promise<unknown>[] = [ekoApi.put(`/entities/${entity.id}`, { address, phone, contactName })]
      if (coords) jobs.push(ekoApi.put(`/entities/${entity.id}/location`, { lat: coords.lat, lon: coords.lng }))
      await Promise.all(jobs)
      toast.success('Saqlandi')
      invalidateEko(qc, 'entity')
      onSaved()
    } catch (err) {
      toast.error(errMsg(err))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      onClose={onClose}
      size="xl"
      disableBackdropClose
      title="Manzil va joylashuv"
      hint={`${entity.name}${entity.code ? ` · ${entity.code}` : ''}`}
      footer={
        <>
          <p className="eko-text-xs text-eko-muted mr-auto hidden sm:block">
            {coords ? 'Koordinata tayyor' : 'Koordinata belgilanmagan (ixtiyoriy)'}
          </p>
          <Button onClick={onClose}>Bekor qilish</Button>
          <Button variant="primary" loading={saving} onClick={save}>Saqlash</Button>
        </>
      }
    >
      <div className="grid md:grid-cols-[280px_1fr] min-h-0">
        <div className="p-5 space-y-4 md:border-r border-eko-line">
          {detail.isError && (
            <Banner tone="warn" action={<Button size="sm" onClick={() => detail.refetch()}>Qayta urinish</Button>}>
              Ma'lumotni yuklab bo'lmadi: {errMsg(detail.error)}
            </Banner>
          )}
          <Field label="Manzil" required>
            {id => <Textarea id={id} rows={2} value={address} onChange={e => setAddress(e.target.value)}
              placeholder="Yunusobod t., Amir Temur ko'chasi 12" />}
          </Field>
          <Button block icon={<Search className="w-4 h-4" aria-hidden />} loading={geocoding}
            disabled={!address.trim()} onClick={geocode}>
            Manzilni xaritadan topish
          </Button>
          <Field label="Telefon">
            {id => <Input id={id} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998 90 123 45 67" />}
          </Field>
          <Field label="Mas'ul shaxs">
            {id => <Input id={id} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Ism Familiya" />}
          </Field>
          <div className="pt-3 border-t border-eko-line space-y-1">
            <p className="eko-text-sm font-medium text-eko-text">Joylashuv</p>
            {coords ? (
              <>
                <p className="eko-text-sm text-eko-text-2 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" aria-hidden /> Joy belgilandi
                </p>
                <p className="eko-text-xs font-mono text-eko-muted">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</p>
                <a className="inline-flex items-center gap-1 eko-text-sm text-eko-accent-text underline min-h-[44px] md:min-h-0"
                  href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`} target="_blank" rel="noopener noreferrer">
                  <Navigation className="w-4 h-4" aria-hidden /> Google Maps'da ko'rish
                </a>
              </>
            ) : (
              <p className="eko-text-sm text-eko-muted">Xaritada korxona joylashgan joyga bosing.</p>
            )}
          </div>
        </div>

        <div className="relative isolate h-[50dvh] md:h-[60dvh] min-h-[320px]">
          <div ref={mapDivRef} className="absolute inset-0" />
          <Button className="absolute top-3 right-3" style={{ zIndex: 500 }} onClick={() => setSatellite(v => !v)}>
            {satellite ? 'Oddiy xarita' : "Sun'iy yo'ldosh"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
