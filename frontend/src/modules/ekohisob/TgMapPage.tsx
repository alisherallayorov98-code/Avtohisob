import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import ekoApi from './lib/ekoApi'

interface MapEntity {
  id: string
  name: string
  address?: string
  lat: number | null
  lon: number | null
  status: string
  monthlyFee?: number
  paidThisMonth?: boolean
  debtMonths?: number
}

// Telegram WebApp SDK ni yuklash (bir marta)
function loadTelegramSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    const existing = (window as any).Telegram?.WebApp
    if (existing) { resolve(existing); return }
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-web-app.js'
    s.onload = () => {
      const tg = (window as any).Telegram?.WebApp
      tg ? resolve(tg) : reject(new Error('no-tg'))
    }
    s.onerror = () => reject(new Error('sdk-fail'))
    document.body.appendChild(s)
  })
}

export default function TgMapPage() {
  const [entities, setEntities] = useState<MapEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fullName, setFullName] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tg = await loadTelegramSdk()
        tg.ready?.()
        tg.expand?.()
        const initData: string = tg.initData || ''
        if (!initData) {
          setError('Bu sahifa faqat Telegram bot ichida ochiladi.')
          setLoading(false)
          return
        }
        // Telegram orqali avtomatik kirish
        const authRes = await ekoApi.post('/tg/auth', { initData })
        const { token, user } = authRes.data.data
        localStorage.setItem('ekohisob_token', token)
        if (!cancelled) setFullName(user?.fullName || '')
        // Xarita ma'lumoti (o'z tumani tashkilotlari)
        const mapRes = await ekoApi.get('/dashboard/map')
        const data = mapRes.data.data ?? mapRes.data
        if (!cancelled) setEntities(Array.isArray(data) ? data : (data.entities ?? []))
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || 'Yuklashda xato. Qayta urinib ko\'ring.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗺</div>
          <p style={{ color: '#dc2626', fontWeight: 600 }}>{error}</p>
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', color: '#16a34a' }}>
        Xarita yuklanmoqda…
      </div>
    )
  }

  const withCoords = entities.filter(e => e.lat != null && e.lon != null)
  const center: [number, number] = withCoords.length > 0
    ? [withCoords[0].lat as number, withCoords[0].lon as number]
    : [41.311081, 69.240562] // Toshkent markazi

  function markerColor(e: MapEntity): string {
    if (e.status === 'draft') return '#f59e0b'        // chala — sariq
    if (e.paidThisMonth) return '#16a34a'             // to'lagan — yashil
    return '#dc2626'                                  // to'lamagan — qizil
  }

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }} preferCanvas>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution=""
          maxZoom={19}
        />
        {withCoords.map(e => (
          <CircleMarker
            key={e.id}
            center={[e.lat as number, e.lon as number]}
            radius={8}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: markerColor(e), fillOpacity: 0.9 }}
          >
            <Popup>
              <div style={{ minWidth: 160 }}>
                <b>{e.name}</b><br />
                {e.address && <span style={{ color: '#666', fontSize: 12 }}>{e.address}<br /></span>}
                {e.status === 'draft'
                  ? <span style={{ color: '#f59e0b' }}>🟡 Chala (to'ldirilmagan)</span>
                  : e.paidThisMonth
                    ? <span style={{ color: '#16a34a' }}>✅ Bu oy to'langan</span>
                    : <span style={{ color: '#dc2626' }}>⚠️ To'lamagan{e.debtMonths ? ` (${e.debtMonths} oy)` : ''}</span>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Yuqori panel */}
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8, zIndex: 1000,
        background: 'rgba(255,255,255,0.92)', borderRadius: 12, padding: '8px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontFamily: 'Inter, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13,
      }}>
        <span style={{ fontWeight: 600 }}>🗺 {fullName}</span>
        <span style={{ color: '#666' }}>{withCoords.length} ta tashkilot</span>
      </div>
    </div>
  )
}
