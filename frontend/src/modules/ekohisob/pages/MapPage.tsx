import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X, List, MapPinOff, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { ekoKeys, invalidateEko, useDistricts } from '../lib/queries'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { useAuthStore } from '../../../stores/authStore'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import RoutePanel from '../components/map/RoutePanel'
import NearbyPanel, { NearbyItem } from '../components/map/NearbyPanel'
import EntityPanelCard, { EntityDetail } from '../components/map/EntityPanelCard'
import DraftCompleteModal from '../components/map/DraftCompleteModal'
import CoordlessModal from '../components/map/CoordlessModal'
import { MapToolbar, MapLegend } from '../components/map/MapControls'
import { exportDebtors } from '../components/map/exportDebtors'
import { useLeafletMap, UserLoc } from '../components/map/useLeafletMap'
import { MapEntity, MapBbox, debtOf, useMapEntities } from '../components/map/useMapEntities'
import { distM, GPS_ACCURACY_WARN_M } from '../components/map/geo'
import { RoutePoint, orderNearest, orderByDebt } from '../lib/routePlanner'
import {
  Banner, Button, DebtDot, ErrorState, InputWithIcon, Modal, SegmentedControl, Select, Skeleton, SplitPane, Tabs,
  useIsMobile, f, cx,
} from '../ui'
import { levelOf } from '../components/map/mapIcons'

type MapFilter = 'all' | 'unpaid'
type PanelTab = 'list' | 'route'

export default function MapPage({ readOnly = false }: { readOnly?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const mobile = useIsMobile()

  const ekoUser = useEkoAuthStore(s => s.user)
  const mainUser = useAuthStore(s => s.user)
  const isInspector = ekoUser?.role === 'inspector' || mainUser?.role === 'ekohisob_user'
  const userDistrictIds: string[] = ekoUser?.districtIds ?? []
  const singleDistrict = isInspector && userDistrictIds.length === 1

  const districtsQ = useDistricts()
  const districts = districtsQ.data ?? []
  const districtOptions = isInspector && userDistrictIds.length > 0
    ? districts.filter(d => userDistrictIds.includes(d.id))
    : districts

  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [bbox, setBbox] = useState<MapBbox | null>(null)
  const [mapFilter, setMapFilter] = useState<MapFilter>('all')
  const [search, setSearch] = useState('')
  const [satellite, setSatellite] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  const [tab, setTab] = useState<PanelTab>('list')
  const [sheetOpen, setSheetOpen] = useState(false)       // mobil bottom-sheet
  const [selectedSnap, setSelectedSnap] = useState<MapEntity | null>(null)
  const [payEntity, setPayEntity] = useState<EntityBasic | null>(null)
  const [completeDraft, setCompleteDraft] = useState<MapEntity | null>(null)
  const [showCoordless, setShowCoordless] = useState(false)
  const [userLoc, setUserLoc] = useState<UserLoc | null>(null)
  const [locating, setLocating] = useState(false)
  const [routeSel, setRouteSel] = useState<MapEntity[]>([])
  const [routeMode, setRouteMode] = useState<'nearest' | 'debt'>('nearest')

  // Bitta inspektor tumani — avtomatik tanlanadi
  useEffect(() => {
    if (singleDistrict && !selectedDistrict) setSelectedDistrict(userDistrictIds[0])
  }, [singleDistrict, userDistrictIds, selectedDistrict])

  const { entities, truncated, isLoading, isFetching, isError, refetch } = useMapEntities(selectedDistrict, bbox)

  const visibleEntities = useMemo(
    () => (mapFilter === 'unpaid' ? entities.filter(e => !e.paid && e.status === 'active') : entities),
    [entities, mapFilter],
  )

  // Tanlangan tashkilot — ro'yxat yangilansa (to'lovdan keyin) yangi holati olinadi
  const selected = selectedSnap ? (entities.find(e => e.id === selectedSnap.id) ?? selectedSnap) : null

  const inRoute = (id: string) => routeSel.some(e => e.id === id)

  const routeOrdered = useMemo<RoutePoint[]>(() => {
    const pts: RoutePoint[] = routeSel
      .filter(e => e.lat && e.lng)
      .map(e => ({ id: e.id, name: e.name, lat: e.lat!, lng: e.lng!, debtAmount: debtOf(e) }))
    return routeMode === 'nearest' ? orderNearest(pts, userLoc) : orderByDebt(pts)
  }, [routeSel, routeMode, userLoc])

  const routeCoords = useMemo<[number, number][] | null>(() => {
    if (routeOrdered.length < 2) return null
    return [
      ...(userLoc ? [[userLoc.lat, userLoc.lng] as [number, number]] : []),
      ...routeOrdered.map(p => [p.lat, p.lng] as [number, number]),
    ]
  }, [routeOrdered, userLoc])

  function selectEntity(e: MapEntity) {
    setSelectedSnap(e)
    setTab('list')
    if (mobile) setSheetOpen(true)
  }

  const { setContainer, flyTo, flyToEntity } = useLeafletMap({
    entities: visibleEntities,
    allEntities: entities,
    satellite,
    heatmap: showHeatmap,
    labels: showLabels,
    routeCoords,
    userLoc,
    onSelect: selectEntity,
    onBboxChange: setBbox,
    fitKey: selectedDistrict,
  })

  function changeDistrict(id: string) {
    setSelectedDistrict(id)
    setBbox(null)       // yangi hududga qayta moslash uchun
  }

  // Tanlangan tashkilotning to'liq ma'lumoti (STIR/telefon/shartnoma) — faqat o'sha bittasi uchun
  const detailQ = useQuery<EntityDetail | null>({
    queryKey: [...ekoKeys.entities, 'map-detail', selected?.id],
    queryFn: async () => (await ekoApi.get(`/entities/${selected!.id}`)).data.data ?? null,
    enabled: !!selected,
    staleTime: 30_000,
  })

  // ─── Geolokatsiya ───────────────────────────────────────────────────────
  function locateMe() {
    if (!navigator.geolocation) { toast.error("Brauzer geolokatsiyani qo'llab-quvvatlamaydi"); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
        setUserLoc(loc)
        flyTo(loc.lat, loc.lng, 15)
        setLocating(false)
      },
      () => { toast.error("Joylashuvni aniqlab bo'lmadi. GPS ruxsatini bering."); setLocating(false) },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }
  const gpsWeak = !!userLoc?.accuracy && userLoc.accuracy > GPS_ACCURACY_WARN_M

  // ─── Ro'yxatlar ─────────────────────────────────────────────────────────
  const debtors = useMemo<NearbyItem[]>(() => {
    const base = entities.filter(e => e.lat && e.lng && !e.paid && e.status === 'active')
    if (userLoc) {
      return base
        .map(e => ({ ...e, dist: distM(userLoc.lat, userLoc.lng, e.lat!, e.lng!) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20)
    }
    return [...base].sort((a, b) => debtOf(b) - debtOf(a)).slice(0, 20)
  }, [entities, userLoc])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return entities
      .filter(e => e.lat && e.lng && (e.name.toLowerCase().includes(q) || e.address.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [search, entities])

  function toggleRoute(e: MapEntity) {
    if (!e.lat || !e.lng) { toast.error("Tashkilotda koordinata yo'q"); return }
    setRouteSel(prev => (prev.some(x => x.id === e.id) ? prev.filter(x => x.id !== e.id) : [...prev, e]))
  }

  function openFromList(e: MapEntity) {
    flyToEntity(e)
    selectEntity(e)
    setSearch('')
  }

  const stats = useMemo(() => {
    const active = entities.filter(e => e.status === 'active')
    const paid = active.filter(e => e.paid).length
    const unpaid = active.filter(e => !e.paid)
    return {
      unpaidCount: unpaid.length,
      totalDebt: unpaid.reduce((s, e) => s + debtOf(e), 0),
      payRate: active.length > 0 ? Math.round((paid * 100) / active.length) : 0,
      hasActive: active.length > 0,
    }
  }, [entities])

  const scopeLabel = bbox
    ? "Ko'rinayotgan hududda"
    : selectedDistrict ? (districts.find(d => d.id === selectedDistrict)?.name ?? 'Tuman') : 'Barcha tumanlar'

  // ─── Qidiruv ────────────────────────────────────────────────────────────
  const searchBox = (
    <div className="relative">
      <InputWithIcon
        icon={<Search className="w-4 h-4" aria-hidden />}
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Tashkilot yoki manzil qidirish"
        aria-label="Tashkilot qidirish"
        type="search"
        className="pr-11"
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch('')}
          aria-label="Qidiruvni tozalash"
          className="absolute right-0 top-0 h-full w-11 inline-flex items-center justify-center text-eko-muted hover:text-eko-text"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
    </div>
  )

  const resultsList = search.trim() ? (
    searchResults.length === 0 ? (
      <p className="px-4 py-6 eko-text-sm text-eko-muted text-center">Hech narsa topilmadi. Boshqa so'z bilan urinib ko'ring.</p>
    ) : (
      <ul className="divide-y divide-eko-line">
        {searchResults.map(e => (
          <li key={e.id}>
            <button type="button" onClick={() => openFromList(e)} className="w-full text-left px-4 py-2.5 min-h-[56px] hover:bg-eko-surface-2">
              <span className="flex items-center gap-1.5 eko-text-base font-medium text-eko-text">
                <DebtDot level={e.paid ? 'current' : levelOf(e.debtMonths)} />
                <span className="truncate">{e.name}</span>
              </span>
              <span className="block eko-text-xs text-eko-muted truncate">{e.address}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  ) : null

  // ─── Chap panel ─────────────────────────────────────────────────────────
  const panel = (
    <div className="flex flex-col min-h-0 h-full">
      {selected ? (
        <div className="overflow-y-auto flex-1">
          <EntityPanelCard
            entity={selected}
            detail={detailQ.data ?? null}
            detailLoading={detailQ.isLoading}
            detailError={detailQ.isError}
            readOnly={readOnly}
            inRoute={inRoute(selected.id)}
            onBack={() => setSelectedSnap(null)}
            onPay={() => setPayEntity({ id: selected.id, name: selected.name, address: selected.address, monthlyFee: selected.monthlyFee })}
            onComplete={() => setCompleteDraft(selected)}
            onToggleRoute={() => toggleRoute(selected)}
            onOpenAkt={() => navigate(`/ekohisob/akt/${selected.id}`)}
          />
        </div>
      ) : (
        <>
          {!mobile && <div className="p-3 border-b border-eko-line shrink-0">{searchBox}</div>}
          {mobile && <div className="px-3 pt-2 shrink-0"><MapLegend className="!border-0 !px-0" /></div>}
          <Tabs<PanelTab>
            value={tab}
            onChange={setTab}
            ariaLabel="Panel bo'limlari"
            idPrefix="map-tab"
            className="px-3 shrink-0"
            items={[
              { value: 'list', label: "Ro'yxat" },
              { value: 'route', label: 'Marshrut', count: routeSel.length },
            ]}
          />
          <div className="overflow-y-auto flex-1 min-h-0" role="tabpanel" aria-labelledby={`map-tab-${tab}`}>
            {tab === 'list' ? (
              resultsList ?? (
                <NearbyPanel
                  items={debtors}
                  hasLocation={!!userLoc}
                  locating={locating}
                  onLocate={locateMe}
                  onOpen={openFromList}
                  inRoute={inRoute}
                  onToggleRoute={toggleRoute}
                />
              )
            ) : (
              <RoutePanel
                ordered={routeOrdered}
                mode={routeMode}
                onModeChange={setRouteMode}
                onRemove={id => setRouteSel(prev => prev.filter(e => e.id !== id))}
                onClear={() => setRouteSel([])}
                onFocus={pt => { const ent = entities.find(e => e.id === pt.id); if (ent) openFromList(ent) }}
                userLoc={userLoc}
              />
            )}
          </div>
        </>
      )}
    </div>
  )

  // ─── Xarita maydoni ─────────────────────────────────────────────────────
  const mapArea = (
    <div className="relative isolate h-full min-h-[320px]">
      <div ref={setContainer} className="absolute inset-0" />

      {isLoading && (
        <div className="absolute inset-0 eko-z-sticky bg-eko-canvas/70 p-6 space-y-3" aria-busy="true" aria-label="Xarita yuklanmoqda">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      )}

      {isError && entities.length === 0 && (
        <div className="absolute inset-0 eko-z-sticky bg-eko-canvas flex items-center justify-center">
          <ErrorState title="Xarita yuklanmadi" onRetry={() => refetch()} />
        </div>
      )}

      {/* Qidiruv — faqat mobilda xaritada (desktopda panelda) */}
      {mobile && (
        <div className="absolute top-3 left-3 right-3 eko-z-sticky">
          {searchBox}
          {resultsList && (
            <div className="mt-1 bg-eko-surface border border-eko-line rounded-eko shadow-eko-lg max-h-[50dvh] overflow-y-auto">
              {resultsList}
            </div>
          )}
        </div>
      )}

      <MapToolbar
        className={cx('absolute right-3 eko-z-sticky', mobile ? 'top-[68px]' : 'top-3')}
        satellite={satellite} onSatellite={() => setSatellite(v => !v)}
        heatmap={showHeatmap} onHeatmap={() => setShowHeatmap(v => !v)}
        labels={showLabels} onLabels={() => setShowLabels(v => !v)}
        onExport={() => exportDebtors(entities)}
        onLocate={locateMe} locating={locating}
      />

      <div className="absolute left-3 bottom-3 right-16 md:right-auto md:max-w-md eko-z-sticky flex flex-col gap-2 items-start">
        {gpsWeak && (
          <Banner
            tone="warn"
            icon={<AlertTriangle className="w-4 h-4" />}
            action={<Button size="sm" variant="secondary" loading={locating} onClick={locateMe}>Qayta o'lchash</Button>}
          >
            GPS aniqligi past (±{Math.round(userLoc!.accuracy!)} m). Ochiq joyga chiqing.
          </Banner>
        )}
        {mobile ? (
          <Button variant="primary" size="lg" icon={<List className="w-4 h-4" aria-hidden />} onClick={() => setSheetOpen(true)}>
            Ro'yxat{routeSel.length > 0 ? ` · marshrut ${routeSel.length}` : ''}
          </Button>
        ) : (
          <MapLegend />
        )}
      </div>

      {!isLoading && !isError && entities.length === 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 eko-z-sticky max-w-[90%]">
          <Banner tone="info">Bu hududda koordinatali tashkilot topilmadi. Xaritani siljiting yoki tumanni o'zgartiring.</Banner>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Ixcham sarlavha qatori */}
      <div className="px-4 sm:px-6 pt-3 pb-2 shrink-0 space-y-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="eko-text-lg font-semibold text-eko-text">Xarita</h1>
          <SegmentedControl<MapFilter>
            ariaLabel="Tashkilotlar filtri"
            value={mapFilter}
            onChange={setMapFilter}
            options={[{ value: 'all', label: 'Hammasi' }, { value: 'unpaid', label: "To'lamaganlar" }]}
          />
          {!singleDistrict && (
            <Select
              aria-label="Tuman"
              value={selectedDistrict}
              onChange={e => changeDistrict(e.target.value)}
              className="!w-auto min-w-[160px]"
            >
              <option value="">Barcha tumanlar</option>
              {districtOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
          <span className="eko-text-sm text-eko-muted eko-num" aria-live="polite">
            {isFetching && !isLoading ? 'Yangilanmoqda...' : `${visibleEntities.length} ta tashkilot`}
          </span>
          <Button size="sm" variant="ghost" icon={<MapPinOff className="w-4 h-4" aria-hidden />} onClick={() => setShowCoordless(true)}>
            Koordinatasizlar
          </Button>
        </div>

        {/* Statistika — matn qatori */}
        {stats.hasActive && (
          <p className="eko-text-sm text-eko-text-2 eko-num">
            <span className="text-eko-muted">{scopeLabel}:</span>{' '}
            To'lov foizi <b className="text-eko-text">{stats.payRate}%</b>
            <span className="text-eko-subtle" aria-hidden> · </span>
            to'lamagan <b className="text-eko-text">{stats.unpaidCount} ta</b>
            <span className="text-eko-subtle" aria-hidden> · </span>
            jami qarz <b className="text-eko-text">{f.money(stats.totalDebt)} so'm</b>
          </p>
        )}
        {truncated && (
          <p className="eko-text-sm text-eko-warn">
            {f.num(truncated.total)} tadan {f.num(truncated.shown)} tasi yuklandi — tuman tanlang.
          </p>
        )}
      </div>

      {mobile ? (
        <div className="flex-1 min-h-0 relative">{mapArea}</div>
      ) : (
        <SplitPane
          className="flex-1 mx-4 sm:mx-6 mb-4 sm:mb-6"
          list={panel}
          detail={mapArea}
          detailOpen
          listWidth={360}
        />
      )}

      {/* Mobil bottom-sheet */}
      {mobile && (
        <Modal
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={selected ? 'Tashkilot' : "Qarzdorlar va marshrut"}
          size="lg"
        >
          <div className="min-h-[50dvh]">{panel}</div>
        </Modal>
      )}

      {payEntity && (
        <PaymentModal
          entity={payEntity}
          onClose={() => setPayEntity(null)}
          onSuccess={() => invalidateEko(qc, 'payment')}
        />
      )}

      {completeDraft && (
        <DraftCompleteModal
          entity={completeDraft}
          onClose={() => setCompleteDraft(null)}
          onSaved={() => { setCompleteDraft(null); invalidateEko(qc, 'entity') }}
        />
      )}

      {showCoordless && <CoordlessModal districtId={selectedDistrict} onClose={() => setShowCoordless(false)} />}
    </div>
  )
}
