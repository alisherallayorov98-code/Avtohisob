import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, KeyRound, MapPin, Link2, Unlink, Power, AlertTriangle, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { ekoKeys, useDistricts } from '../lib/queries'
import {
  Badge, Banner, Button, Card, DataTable, FilterBar, Page, PageHeader, RowActions, useConfirm, f,
} from '../ui'
import { EkoUserRow, ROLE_LABEL, isLockedNow, mapUser } from '../components/admin/userTypes'
import UserFormModal from '../components/admin/UserFormModal'
import UserPasswordModal from '../components/admin/UserPasswordModal'
import UserDistrictsModal from '../components/admin/UserDistrictsModal'
import BotLinkModal from '../components/admin/BotLinkModal'

const PAGE_SIZE = 50

type Dialog =
  | { kind: 'form'; user: EkoUserRow | null }
  | { kind: 'password'; user: EkoUserRow }
  | { kind: 'districts'; user: EkoUserRow }
  | { kind: 'bot'; user: EkoUserRow }

export default function AdminUsersPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const districtsQ = useDistricts()
  const districts = districtsQ.data ?? []
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const q = useQuery({
    queryKey: [...ekoKeys.users, page],
    queryFn: async () => {
      const res = await ekoApi.get(`/users?page=${page}&limit=${PAGE_SIZE}`)
      const data = res.data.data ?? []
      return {
        rows: (Array.isArray(data) ? data : []).map(mapUser),
        total: (res.data.meta?.total as number | undefined) ?? data.length,
      }
    },
    placeholderData: prev => prev,
  })
  const users = q.data?.rows ?? []

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return users
    return users.filter(u => u.fullName.toLowerCase().includes(s) || u.email.toLowerCase().includes(s))
  }, [users, search])

  const refresh = () => qc.invalidateQueries({ queryKey: ekoKeys.users })

  async function toggleActive(u: EkoUserRow) {
    const ok = await confirm({
      title: u.isActive ? 'Foydalanuvchini bloklash' : 'Foydalanuvchini faollashtirish',
      message: u.isActive
        ? `${u.fullName} tizimga kira olmaydi.`
        : `${u.fullName} yana tizimga kira oladi.`,
      consequences: u.isActive ? ['Uning barcha sessiyalari tugaydi'] : undefined,
      danger: u.isActive,
      confirmLabel: u.isActive ? 'Bloklash' : 'Faollashtirish',
    })
    if (!ok) return
    try {
      await ekoApi.put(`/users/${u.id}`, { isActive: !u.isActive })
      toast.success(u.isActive ? 'Bloklandi' : 'Faollashtirildi')
      refresh()
    } catch (e) {
      // Oxirgi faol admin bo'lsa server tushunarli xabar beradi (409)
      toast.error(errMsg(e))
    }
  }

  async function unlinkBot(u: EkoUserRow) {
    const who = u.botLink?.tgUsername ? '@' + u.botLink.tgUsername : (u.botLink?.tgFirstName || 'ulangan qurilma')
    const ok = await confirm({
      title: "Telegram bog'lanishini uzish",
      message: `${u.fullName} — "${who}" bog'lanishi uzilsinmi?`,
      consequences: ["Qayta ulanishi uchun unga yangi token berish kerak bo'ladi"],
      confirmLabel: 'Uzish',
      danger: true,
    })
    if (!ok) return
    try {
      await ekoApi.delete(`/bot/link/${u.id}`)
      toast.success("Telegram bog'lanishi uzildi")
      refresh()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const needsDistrict = (u: EkoUserRow) => u.role !== 'admin' && u.districtIds.length === 0

  return (
    <Page>
      <PageHeader
        title="Foydalanuvchilar"
        subtitle="EkoHisob inspektorlari, boshliqlari va adminlari"
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" aria-hidden />} onClick={() => setDialog({ kind: 'form', user: null })}>
            Yangi foydalanuvchi
          </Button>
        }
      />

      <Banner tone="info">
        <p className="font-medium mb-1">Xodimga kirish berishning ikki usuli</p>
        <ol className="list-decimal pl-5 space-y-1 eko-text-sm">
          <li>
            <b>AutoHisob orqali (tavsiya):</b> AutoHisob → Sozlamalar → Foydalanuvchilar → «EkoHisob foydalanuvchisi» rolini tanlang.
            Xodim avtohisob.uz ga kirsa, avtomatik EkoHisob'ga o'tadi.
          </li>
          <li>
            <b>Shu sahifada:</b> alohida EkoHisob login/parol yarating. Xodim avtohisob.uz/ekohisob/login orqali kiradi.
          </li>
        </ol>
      </Banner>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Ism yoki login bo'yicha qidirish" }}
      />

      <Card flush>
        <DataTable<EkoUserRow>
          aria-label="Foydalanuvchilar"
          rows={filtered}
          rowKey={u => u.id}
          loading={q.isLoading}
          error={q.isError && !q.data ? errMsg(q.error) : null}
          onRetry={() => q.refetch()}
          empty={{
            icon: <Users className="w-6 h-6" />,
            title: search ? 'Hech narsa topilmadi' : "Foydalanuvchilar yo'q",
            hint: search ? "Boshqa so'z bilan urinib ko'ring (qidiruv joriy sahifada ishlaydi)." : undefined,
          }}
          pagination={{ page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onPageChange: setPage }}
          columns={[
            { key: 'name', title: 'F.I.O.', mobile: 'primary', render: u => (
              <span>
                <span className="font-medium text-eko-text">{u.fullName}</span>
                <span className="block eko-text-xs text-eko-muted">{u.email}</span>
                {u.mustChangePassword && <span className="block eko-text-xs text-eko-muted">Parolni almashtirishi kutilmoqda</span>}
              </span>
            ) },
            { key: 'role', title: 'Rol', render: u => ROLE_LABEL[u.role] },
            { key: 'districts', title: 'Tumanlar', render: u => (
              <span>
                {needsDistrict(u) ? (
                  <span className="inline-flex items-center gap-1 text-eko-warn font-medium">
                    <AlertTriangle className="w-4 h-4" aria-hidden /> Tuman biriktirilmagan
                  </span>
                ) : (
                  <span>{u.role === 'admin' ? 'Barchasi' : `${u.districtIds.length} tuman`}</span>
                )}
                {(u.role === 'inspector' || u.role === 'supervisor') && (
                  <span className="block eko-text-xs text-eko-muted">
                    Telegram: {u.botLink
                      ? (u.botLink.tgUsername ? '@' + u.botLink.tgUsername : (u.botLink.tgFirstName || 'ulangan')) + ` · ${f.date(u.botLink.linkedAt)}`
                      : 'ulanmagan'}
                  </span>
                )}
              </span>
            ) },
            { key: 'status', title: 'Holat', render: u => (
              !u.isActive ? <Badge tone="inactive">Bloklangan</Badge>
                : isLockedNow(u) ? <Badge tone="draft">Vaqtincha qulflangan</Badge>
                : <Badge tone="active">Faol</Badge>
            ) },
          ]}
          rowActions={u => (
            <RowActions
              primary={{ label: 'Tahrirlash', icon: <Pencil className="w-4 h-4" aria-hidden />, onClick: () => setDialog({ kind: 'form', user: u }) }}
              items={[
                { key: 'pw', label: 'Parolni yangilash', icon: <KeyRound className="w-4 h-4" />, onSelect: () => setDialog({ kind: 'password', user: u }) },
                { key: 'dist', label: 'Tumanlarni belgilash', icon: <MapPin className="w-4 h-4" />, onSelect: () => setDialog({ kind: 'districts', user: u }) },
                { key: 'bot', label: 'Telegram botni ulash', icon: <Link2 className="w-4 h-4" />, onSelect: () => setDialog({ kind: 'bot', user: u }) },
                ...(u.botLink ? [{ key: 'unlink', label: "Telegram bog'lanishini uzish", icon: <Unlink className="w-4 h-4" />, onSelect: () => unlinkBot(u), danger: true }] : []),
                { key: 'active', label: u.isActive ? 'Bloklash' : 'Faollashtirish', icon: <Power className="w-4 h-4" />, onSelect: () => toggleActive(u), danger: u.isActive, divider: true },
              ]}
            />
          )}
        />
      </Card>

      {dialog?.kind === 'form' && <UserFormModal user={dialog.user} districts={districts} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <UserPasswordModal user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'districts' && <UserDistrictsModal user={dialog.user} districts={districts} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'bot' && <BotLinkModal user={dialog.user} onClose={() => { setDialog(null); refresh() }} />}
    </Page>
  )
}
