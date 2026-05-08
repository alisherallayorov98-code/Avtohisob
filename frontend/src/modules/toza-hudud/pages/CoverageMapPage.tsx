import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MapPin, Loader2, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, ThumbsUp, Info,
} from 'lucide-react'
import api from '../../../lib/api'

// ── Turlari ──────────────────────────────────────────────────────────────────

type CellState = 'covered' | 'historically_missed' | 'never_visited'

interface AnnotatedCell {
  lat: number
  lon: number
  covered: boolean
  state: CellState
}

interface CoverageInfo {
  coveredPct: number
  totalCells: number
  coveredCells: number
  historicallyMissedCells: number
  hasHistory: boolean
  cells: AnnotatedCell[]
}

interface CoverageData {
  mfy: { id: string; name: string; district: string | null; polygon: any }
  vehicle: { registrationNumber: string; brand: string; model: string }
  dates: string[]
  trackByDate: Record<string, number>
  coverage: CoverageInfo
}

// ── Katak rangi ──────────────────────────────────────────────────────────────

const CELL_COLORS: Record<CellState, { color: string; fill: string }> = {
  covered:             { color: '#16a34a', fill: '#22c55e' },
  historically_missed: { color: '#d97706', fill: '#f59e0b' },
  never_visited:       { color: '#dc2626', fill: '#ef4444' },
}

// ── Leaflet ──────────────────────────────────────────────────────────────────

let Lf: any = null

async function loadLeaflet() {
  if (Lf) return Lf
  const mod = await import('leaflet' as any)
  Lf = mod.default || mod
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link')
    link.id = 'leaflet-css'
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
  }
  return Lf
}

// ── Xarita ───────────────────────────────────────────────────────────────────

function CoverageMap({ cells, polygon }: { cells: AnnotatedCell[]; polygon: any }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!ref.current) return

    loadLeaflet().then((L) => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      if (!ref.current) return

      let centerLat = 39.7, centerLon = 64.5
      if (cells.length > 0) {
        centerLat = cells.reduce((s, c) => s + c.lat, 0) / cells.length
        centerLon = cells.reduce((s, c) => s + c.lon, 0) / cells.length
      }

      const map = L.map(ref.current, { zoomControl: true, scrollWheelZoom: true })
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // MFY polygon
      try {
        let coords: [number, number][] | null = null
        if (polygon?.type === 'Feature') coords = polygon.geometry?.coordinates?.[0]
        else if (polygon?.type === 'Polygon') coords = polygon.coordinates?.[0]
        else if (polygon?.type === 'FeatureCollection') coords = polygon.features?.[0]?.geometry?.coordinates?.[0]
        if (coords) {
          L.polygon(coords.map(([lon, lat]: number[]) => [lat, lon] as [number, number]), {
            color: '#1d4ed8', fillColor: 'transparent', weight: 2,
          }).addTo(map)
        }
      } catch { /* skip */ }

      // Kataklar
      const cellSizeDeg = 35 / 111000
      for (const cell of cells) {
        const halfLat = cellSizeDeg / 2
        const cellLon = 35 / (111000 * Math.cos(cell.lat * Math.PI / 180))
        const halfLon = cellLon / 2
        const { color, fill } = CELL_COLORS[cell.state]

        L.rectangle(
          [[cell.lat - halfLat, cell.lon - halfLon], [cell.lat + halfLat, cell.lon + halfLon]],
          { color, fillColor: fill, fillOpacity: 0.5, weight: 0 },
        ).addTo(map)
      }

      map.fitBounds(
        [[centerLat - 0.003, centerLon - 0.005], [centerLat + 0.003, centerLon + 0.005]],
        { padding: [20, 20] },
      )
    })

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [cells, polygon])

  return <div ref={ref} style={{ height: '420px' }} className="w-full rounded-2xl overflow-hidden shadow border border-gray-200" />
}

// ── Sana ─────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const DOW = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']
  const dt = new Date(iso + 'T12:00:00Z')
  const uzDow = (dt.getUTCDay() + 6) % 7
  return `${DOW[uzDow]}, ${dt.getUTCDate()}-${dt.toLocaleString('uz-UZ', { month: 'long' })}`
}

// ── Asosiy sahifa ─────────────────────────────────────────────────────────────

export default function CoverageMapPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CoverageData | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setError("Havola noto'g'ri yoki eskirgan"); setLoading(false); return }
    api.get(`/th/coverage-public?token=${encodeURIComponent(token)}`)
      .then(r => { setData(r.data.data); setLoading(false) })
      .catch(e => { setError(e.response?.data?.message || "Xatolik yuz berdi"); setLoading(false) })
  }, [token])

  const handleVerify = useCallback(async () => {
    if (!token || verifying) return
    setVerifying(true)
    setVerifyMsg(null)
    try {
      const r = await api.post('/th/coverage-verify', { token })
      const d = r.data.data
      // Xaritani yangilaymiz
      setData(prev => prev ? {
        ...prev,
        trackByDate: d.trackByDate,
        coverage: {
          ...prev.coverage,
          coveredPct: d.coveredPct,
          coveredCells: d.coveredCells,
          totalCells: d.totalCells,
          historicallyMissedCells: d.historicallyMissedCells,
          cells: d.cells,
        },
      } : prev)

      const diff = d.coveredPct - (data?.coverage.coveredPct ?? 0)
      if (diff > 0) {
        setVerifyMsg(`✅ Yangilandi: qamrov ${d.coveredPct}% ga yetdi (+${diff}%)`)
      } else if (d.coveredPct >= 80) {
        setVerifyMsg(`✅ Yaxshi! Qamrov ${d.coveredPct}% — to'liq`)
      } else {
        setVerifyMsg(`⚠️ GPS yangilandi: ${d.coveredPct}% — ba'zi ko'chalar hali qoplanmagan`)
      }
    } catch (e: any) {
      setVerifyMsg(`❌ ${e.response?.data?.message || "Tekshirishda xatolik"}`)
    } finally {
      setVerifying(false)
    }
  }, [token, verifying, data])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">Yuklanmoqda...</p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="font-semibold text-gray-800 mb-1">Xatolik</p>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  const { mfy, vehicle, dates, trackByDate, coverage } = data
  const pct = coverage.coveredPct
  const pctColor = pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600'
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  const notCoveredCells = coverage.totalCells - coverage.coveredCells

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">{mfy.name}</h1>
              {mfy.district && <p className="text-xs text-gray-500">{mfy.district} tumani</p>}
              <p className="text-xs text-gray-500">{vehicle.registrationNumber} · {vehicle.brand} {vehicle.model}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {dates.map(d => (
              <span key={d} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-lg">
                {fmtDate(d)}
                {(trackByDate[d] ?? 0) > 0
                  ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                  : <XCircle className="w-3 h-3 text-red-400" />
                }
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {/* Statistika */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Qamrov darajasi</span>
            <span className={`text-xl font-bold ${pctColor}`}>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl p-2">
              <p className="text-base font-bold text-gray-800">{coverage.totalCells}</p>
              <p className="text-xs text-gray-500">Jami</p>
            </div>
            <div className="bg-green-50 rounded-xl p-2">
              <p className="text-base font-bold text-green-700">{coverage.coveredCells}</p>
              <p className="text-xs text-green-600">Qoplandi</p>
            </div>
            {coverage.hasHistory && (
              <div className="bg-amber-50 rounded-xl p-2">
                <p className="text-base font-bold text-amber-700">{coverage.historicallyMissedCells}</p>
                <p className="text-xs text-amber-600">Avval borgan</p>
              </div>
            )}
            <div className="bg-red-50 rounded-xl p-2">
              <p className="text-base font-bold text-red-700">{notCoveredCells}</p>
              <p className="text-xs text-red-600">O'tkazildi</p>
            </div>
          </div>
        </div>

        {/* AI tushuntirish (agar tarix bo'lsa) */}
        {coverage.hasHistory && coverage.historicallyMissedCells > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <b>AI aniqladi:</b> {coverage.historicallyMissedCells} ta katak oldingi oylar tarixida qoplangan edi,
              lekin bu safar o'tkazib yuborildi (sariq rangda). Bu ko'chalarga qaytish tavsiya qilinadi.
            </p>
          </div>
        )}

        {/* "Men oldim" tugmasi */}
        {pct < 100 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-sm font-medium text-gray-700 mb-1">
              Chala qolgan ko'chalarni oldingizmi?
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Tugma bosganingizda GPS dan yangi ma'lumot tortib olinadi va haqiqatan borganligingiz tekshiriladi.
            </p>
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              {verifying
                ? <><Loader2 className="w-4 h-4 animate-spin" /> GPS tekshirilmoqda...</>
                : <><RefreshCw className="w-4 h-4" /> GPS yangilab tekshirish</>
              }
            </button>

            {verifyMsg && (
              <div className="mt-2 flex items-start gap-2 bg-gray-50 rounded-xl p-2.5">
                <ThumbsUp className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700">{verifyMsg}</p>
              </div>
            )}
          </div>
        )}

        {/* Izoh */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-green-500 rounded opacity-70" />Borildi
          </span>
          {coverage.hasHistory && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 bg-amber-400 rounded opacity-70" />Avval borgan, endi yo'q
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-red-500 rounded opacity-70" />O'tkazildi
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 border-2 border-blue-600 rounded opacity-70" />MFY chegarasi
          </span>
        </div>

        {/* Xarita */}
        <CoverageMap cells={coverage.cells} polygon={mfy.polygon} />
      </div>
    </div>
  )
}
