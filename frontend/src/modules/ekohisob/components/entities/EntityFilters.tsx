import { FilterBar, FilterDef } from '../../ui'
import { useDistricts, useMahallas } from '../../lib/queries'
import { EMPTY_FILTERS, EntityFilterState, UserOption } from './types'

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Chala (botdan)' },
  { value: 'active', label: 'Faol' },
  { value: 'blacklisted', label: "Qora ro'yxat" },
  { value: 'inactive', label: 'Nofaol' },
]
const DEBT_OPTIONS = [
  { value: 'current', label: 'Joriy' },
  { value: 'warning', label: '1 oy' },
  { value: 'overdue', label: '2 oy' },
  { value: 'critical', label: '3+ oy' },
]

/** Qidiruv + tuman/mahalla/holat/qarz/kim kiritgan filtrlari (FilterBar). */
const MODE_OPTIONS = [
  { value: 'monthly_fixed', label: 'Belgilangan oylik' },
  { value: 'variable', label: "O'zgaruvchan" },
  { value: 'talon', label: 'Talon' },
]

export default function EntityFilters({
  value, onChange, users, actions,
}: {
  value: EntityFilterState
  onChange: (v: EntityFilterState) => void
  users: UserOption[]
  actions?: React.ReactNode
}) {
  const districts = useDistricts()
  const mahallas = useMahallas(value.districtId || '')
  const set = (patch: Partial<EntityFilterState>) => onChange({ ...value, ...patch })

  const filters: FilterDef[] = [
    {
      key: 'district', label: 'Tuman', value: value.districtId,
      onChange: v => set({ districtId: v, mahallId: '' }),
      options: (districts.data ?? []).map(d => ({ value: d.id, label: d.name })),
    },
  ]
  if (value.districtId && (mahallas.data?.length ?? 0) > 0) {
    filters.push({
      key: 'mahalla', label: 'Mahalla', value: value.mahallId,
      onChange: v => set({ mahallId: v }),
      options: (mahallas.data ?? []).map(m => ({ value: m.id, label: m.name })),
    })
  }
  filters.push(
    { key: 'status', label: 'Holat', value: value.status, onChange: v => set({ status: v }), options: STATUS_OPTIONS },
    { key: 'debt', label: 'Qarz', value: value.debtLevel, onChange: v => set({ debtLevel: v }), options: DEBT_OPTIONS },
    { key: 'mode', label: "To'lov rejimi", value: value.billingMode, onChange: v => set({ billingMode: v }), options: MODE_OPTIONS },
  )
  if (users.length > 1) {
    filters.push({
      key: 'createdBy', label: 'Kim kiritgan', value: value.createdBy, onChange: v => set({ createdBy: v }),
      options: users.map(u => ({ value: u.id, label: u.fullName + (u.isActive ? '' : ' (nofaol)') })),
    })
  }

  return (
    <FilterBar
      search={{
        value: value.search,
        onChange: v => set({ search: v }),
        placeholder: 'Nom, STIR, kod yoki telefon',
      }}
      filters={filters}
      onClear={() => onChange(EMPTY_FILTERS)}
      actions={actions}
    />
  )
}
