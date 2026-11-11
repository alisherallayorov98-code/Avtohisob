import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, MoreHorizontal, Download, Upload, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { invalidateEko } from '../lib/queries'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'
import EntityLedgerModal from '../components/EntityLedgerModal'
import ServiceProofModal from '../components/ServiceProofModal'
import TalonModal from '../components/TalonModal'
import EntityCardModal from '../components/EntityCardModal'
import LocationPickerModal from '../components/entities/LocationPickerModal'
import NewEntityModal from '../components/entities/NewEntityModal'
import BlacklistReasonModal from '../components/entities/BlacklistReasonModal'
import EntityFilters from '../components/entities/EntityFilters'
import { entityColumns, entityRowActions } from '../components/entities/EntityRows'
import { PAGE_SIZE, buildEntityParams, useEntitiesQuery } from '../components/entities/useEntitiesQuery'
import { EMPTY_FILTERS, Entity, EntityFilterState, UserOption } from '../components/entities/types'
import { Button, Card, Column, DataTable, Menu, Page, PageHeader, useConfirm } from '../ui'

function toBasic(e: Entity): EntityBasic {
  return { id: e.id, name: e.name, address: e.address ?? '', monthlyFee: e.monthlyFee, billingMode: e.billingMode }
}

/** Tashkilotlar ro'yxati. Asosiy ish: qarzdorni topish va "To'lov" bosish. */
export default function EntitiesPage({ readOnly = false, isAdmin = false }: { readOnly?: boolean; isAdmin?: boolean }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [filters, setFilters] = useState<EntityFilterState>(EMPTY_FILTERS)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300)
    return () => clearTimeout(t)
  }, [filters.search])
  const queryFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [filters, debouncedSearch])
  useEffect(() => { setPage(1) }, [queryFilters])

  const list = useEntitiesQuery(queryFilters, page)
  const users = useQuery<UserOption[]>({
    queryKey: ['eko', 'users', 'options'],
    queryFn: async () => (await ekoApi.get('/users/options')).data.data ?? [],
    staleTime: 5 * 60 * 1000,
  })

  const [payEntity, setPayEntity] = useState<EntityBasic | null>(null)
  const [ledger, setLedger] = useState<Entity | null>(null)
  const [talons, setTalons] = useState<Entity | null>(null)
  const [proof, setProof] = useState<Entity | null>(null)
  const [location, setLocation] = useState<Entity | null>(null)
  const [blacklist, setBlacklist] = useState<Entity | null>(null)
  const [card, setCard] = useState<{ id: string; edit: boolean } | null>(null)
  const [reopenCardId, setReopenCardId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [smsBusyId, setSmsBusyId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const refresh = () => invalidateEko(qc, 'entity')

  async function sendSms(e: Entity) {
    const ok = await confirm({
      title: 'SMS eslatma yuborish',
      message: `${e.name} tashkilotiga qarz haqida SMS yuborilsinmi?`,
      consequences: ['Oylik SMS limitidan sarflanadi', '24 soat ichida qayta yuborib bo\'lmaydi'],
      confirmLabel: 'Yuborish',
    })
    if (!ok) return
    setSmsBusyId(e.id)
    try {
      await ekoApi.post('/reminders/sms', { entityId: e.id })
      toast.success('SMS yuborildi')
    } catch (err) {
      toast.error(errMsg(err))   // 409 rad etgan, 429 cheklov, 503 sozlanmagan — server matni
    } finally { setSmsBusyId(null) }
  }

  /** Ekrandagi bilan bir xil filtr, TO'LIQ ro'yxat (faqat joriy sahifa emas). */
  async function exportExcel() {
    setExporting(true)
    try {
      const res = await ekoApi.get(`/entities/export.xlsx?${buildEntityParams(queryFilters)}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'ekohisob_tashkilotlar.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(errMsg(err))
    } finally { setExporting(false) }
  }

  const columns = useMemo(() => entityColumns(), [])
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const total = list.data?.total ?? 0

  const menuItems = [
    { key: 'xlsx', label: exporting ? 'Yuklanmoqda...' : 'Excelga yuklash', icon: <Download className="w-4 h-4" />, disabled: exporting, onSelect: exportExcel },
    ...(isAdmin ? [{ key: 'import', label: "Excel'dan import", icon: <Upload className="w-4 h-4" />, onSelect: () => navigate('import') }] : []),
  ]

  return (
    <Page>
      <PageHeader
        title="Tashkilotlar"
        subtitle={list.data ? `Jami: ${total} ta` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Menu
              items={menuItems}
              trigger={p => <Button {...p} icon={<MoreHorizontal className="w-4 h-4" aria-hidden />}>Yana</Button>}
            />
            {!readOnly && (
              <Button variant="primary" icon={<Plus className="w-4 h-4" aria-hidden />} onClick={() => setShowNew(true)}>
                Yangi tashkilot
              </Button>
            )}
          </div>
        }
      />

      <EntityFilters value={filters} onChange={setFilters} users={users.data ?? []} />

      <Card flush>
        <DataTableSection
          columns={columns}
          rows={list.data?.items ?? []}
          loading={list.isLoading}
          error={list.isError ? errMsg(list.error) : null}
          onRetry={() => list.refetch()}
          hasFilters={hasFilters}
          readOnly={readOnly}
          onNew={() => setShowNew(true)}
          onClear={() => setFilters(EMPTY_FILTERS)}
          onOpen={e => setCard({ id: e.id, edit: false })}
          actions={e => entityRowActions(e, {
            readOnly, smsBusyId,
            onPay: x => setPayEntity(toBasic(x)),
            onCard: (x, edit) => setCard({ id: x.id, edit }),
            onLedger: setLedger, onTalons: setTalons, onProof: setProof,
            onLocation: setLocation, onSms: sendSms, onBlacklist: setBlacklist,
          })}
          pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: setPage }}
        />
      </Card>

      {showNew && (
        <NewEntityModal
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
          onOpenExisting={id => { setShowNew(false); setCard({ id, edit: false }) }}
        />
      )}

      {payEntity && (
        <PaymentModal entity={payEntity} onClose={() => setPayEntity(null)} onSuccess={refresh} />
      )}

      {ledger && (
        <EntityLedgerModal
          entityId={ledger.id}
          entityName={ledger.name}
          isAdmin={isAdmin}
          readOnly={readOnly}
          onClose={() => setLedger(null)}
          onAddPayment={() => { setPayEntity(toBasic(ledger)); setLedger(null) }}
        />
      )}

      {talons && <TalonModal entity={talons} readOnly={readOnly} onClose={() => setTalons(null)} />}

      {blacklist && (
        <BlacklistReasonModal entity={blacklist} onClose={() => setBlacklist(null)} onDone={() => setBlacklist(null)} />
      )}

      {card && (
        <EntityCardModal
          key={card.id}
          entityId={card.id}
          readOnly={readOnly}
          isAdmin={isAdmin}
          startEditing={card.edit}
          onClose={() => setCard(null)}
          onChanged={refresh}
          actions={{
            // Boshqa oynalar kartochka ostida qolmasligi uchun avval kartochka yopiladi
            onPay: e => { setCard(null); setPayEntity({ id: e.id, name: e.name, address: e.address ?? '', monthlyFee: e.monthlyFee, billingMode: e.billingMode }) },
            onLedger: e => { setCard(null); setLedger(e as unknown as Entity) },
            onTalons: e => { setCard(null); setTalons(e as unknown as Entity) },
            onProof: e => { setCard(null); setProof(e as unknown as Entity) },
            onSms: e => { setCard(null); sendSms(e as unknown as Entity) },
            onBlacklist: e => { setCard(null); setBlacklist(e as unknown as Entity) },
            onPickLocation: e => { setReopenCardId(e.id); setCard(null); setLocation(e as unknown as Entity) },
            onAkt: id => navigate(`/ekohisob/akt/${id}`),
          }}
        />
      )}

      {location && (
        <LocationPickerModal
          entity={location}
          onClose={() => {
            setLocation(null)
            if (reopenCardId) { setCard({ id: reopenCardId, edit: true }); setReopenCardId(null) }
          }}
          onSaved={() => {
            setLocation(null)
            if (reopenCardId) { setCard({ id: reopenCardId, edit: true }); setReopenCardId(null) }
          }}
        />
      )}

      {proof && (
        <ServiceProofModal
          entityId={proof.id}
          entityName={proof.name}
          hasLocation={Boolean(proof.lat && proof.lon)}
          onClose={() => setProof(null)}
        />
      )}
    </Page>
  )
}


/** Jadval + holatlar (skeleton / bo'sh / xato). */
function DataTableSection(props: {
  columns: Column<Entity>[]
  rows: Entity[]
  loading: boolean
  error: string | null
  onRetry: () => void
  hasFilters: boolean
  readOnly: boolean
  onNew: () => void
  onClear: () => void
  onOpen: (e: Entity) => void
  actions: (e: Entity) => React.ReactNode
  pagination: { page: number; pageSize: number; total: number; onPageChange: (p: number) => void }
}) {
  return (
    <DataTable
      aria-label="Tashkilotlar"
      columns={props.columns}
      rows={props.rows}
      rowKey={e => e.id}
      loading={props.loading}
      error={props.error}
      onRetry={props.onRetry}
      onRowClick={props.onOpen}
      rowActions={props.actions}
      pagination={props.pagination}
      empty={props.hasFilters
        ? {
            title: 'Hech narsa topilmadi',
            hint: "Filtrlarni o'zgartiring yoki tozalang.",
            icon: <Building2 className="w-6 h-6" />,
            action: <Button onClick={props.onClear}>Filtrlarni tozalash</Button>,
          }
        : {
            title: "Hali tashkilot yo'q",
            hint: "Birinchi tashkilotni qo'shing yoki Excel'dan import qiling.",
            icon: <Building2 className="w-6 h-6" />,
            action: props.readOnly ? undefined : <Button variant="primary" onClick={props.onNew}>Yangi tashkilot</Button>,
          }}
    />
  )
}
