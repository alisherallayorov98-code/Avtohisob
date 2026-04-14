import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Users, Package, Tag, ClipboardList, Bot, Search, Shield, CheckCircle, XCircle, Smartphone, Mail, ShieldCheck, Ban, UserCheck, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { USER_ROLES } from '../lib/utils'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'

type Tab = 'users' | 'suppliers' | 'categories' | 'audit' | 'ai-logs' | 'security' | 'roles'

interface Supplier { id: string; name: string; contactPerson?: string; phone: string; email?: string; isActive: boolean }
interface SupplierForm { name: string; contactPerson: string; phone: string; email: string; address: string; paymentTerms: string }
interface UserForm { fullName: string; email: string; password: string; role: string; branchId: string }
interface EditUserForm { fullName: string; role: string; branchId: string; isActive: string; newPassword: string }

export default function Settings() {
  const qc = useQueryClient()
  const { isAdmin, isManager } = useAuthStore()
  // Onboarding checklist: mark settings as visited
  useEffect(() => { localStorage.setItem('settings_visited', 'true') }, [])
  const [tab, setTab] = useState<Tab>('users')
  const [userPage, setUserPage] = useState(1)
  const [supplierPage, setSupplierPage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  const [aiLogPage, setAiLogPage] = useState(1)
  const [auditSearch, setAuditSearch] = useState('')
  const [aiLogSearch, setAiLogSearch] = useState('')
  const [supplierModal, setSupplierModal] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [supplierDetail, setSupplierDetail] = useState<any>(null)
  const [deleteSupplierConfirm, setDeleteSupplierConfirm] = useState<Supplier | null>(null)
  const [paymentModal, setPaymentModal] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ amount: '', type: 'invoice', paymentDate: new Date().toISOString().slice(0, 10), note: '' })
  const [userModal, setUserModal] = useState(false)
  const [editUserModal, setEditUserModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [categoryModal, setCategoryModal] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [deleteUserConfirm, setDeleteUserConfirm] = useState<any>(null)

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['users', userPage],
    queryFn: () => api.get('/expenses/users', { params: { page: userPage, limit: 20 } }).then(r => r.data),
    enabled: tab === 'users',
  })

  const { data: suppliersData, isLoading: suppliersLoading } = useQuery({
    queryKey: ['suppliers', supplierPage],
    queryFn: () => api.get('/suppliers', { params: { page: supplierPage, limit: 20 } }).then(r => r.data),
    enabled: tab === 'suppliers',
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get('/expenses/categories').then(r => r.data.data),
    enabled: tab === 'categories',
  })

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit-logs', auditPage, auditSearch],
    queryFn: () => api.get('/audit-logs', { params: { page: auditPage, limit: 20 } }).then(r => r.data),
    enabled: tab === 'audit' && isAdmin(),
  })

  const { data: aiStats } = useQuery({
    queryKey: ['ai-stats'],
    queryFn: () => api.get('/ai-logs/stats').then(r => r.data.data),
    enabled: tab === 'ai-logs' && isAdmin(),
  })

  const { data: aiLogData, isLoading: aiLogLoading } = useQuery({
    queryKey: ['ai-logs', aiLogPage, aiLogSearch],
    queryFn: () => api.get('/ai-logs', { params: { page: aiLogPage, limit: 20 } }).then(r => r.data),
    enabled: tab === 'ai-logs' && isAdmin(),
  })

  // Security tab state
  const { user, fetchMe } = useAuthStore()
  const [twoFAQR, setTwoFAQR] = useState<string | null>(null)
  const [twoFASecret, setTwoFASecret] = useState<string | null>(null)
  const [totpInput, setTotpInput] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [disableTotpInput, setDisableTotpInput] = useState('')

  const setup2FAMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/setup'),
    onSuccess: (r) => { setTwoFAQR(r.data.data.qrCode); setTwoFASecret(r.data.data.secret) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const verify2FAMutation = useMutation({
    mutationFn: (totpCode: string) => api.post('/auth/2fa/verify', { totpCode }),
    onSuccess: () => {
      toast.success('2FA yoqildi!')
      setTwoFAQR(null); setTwoFASecret(null); setTotpInput('')
      fetchMe()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'TOTP kod noto\'g\'ri'),
  })

  const disable2FAMutation = useMutation({
    mutationFn: () => api.delete('/auth/2fa/disable', { data: { password: disablePassword, totpCode: disableTotpInput } }),
    onSuccess: () => {
      toast.success('2FA o\'chirildi')
      setDisablePassword(''); setDisableTotpInput('')
      fetchMe()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const sendVerificationMutation = useMutation({
    mutationFn: () => api.post('/auth/send-verification'),
    onSuccess: () => toast.success('Tasdiqlash xati yuborildi (SMTP sozlangan bo\'lsa)'),
    onError: (e: any) => toast.error(e.response?.data?.error || 'SMTP sozlanmagan'),
  })

  const { register: regUser, handleSubmit: handleUser, reset: resetUser, watch: watchUser, formState: { errors: userErrors } } = useForm<UserForm>()
  const { register: regEditUser, handleSubmit: handleEditUser, reset: resetEditUser, setValue: setEditVal, watch: watchEditUser, formState: { errors: editUserErrors } } = useForm<EditUserForm>()
  const { register: regSupplier, handleSubmit: handleSupplier, reset: resetSupplier, setValue: setSupVal, formState: { errors: supErrors } } = useForm<SupplierForm>()

  const addUserMutation = useMutation({
    mutationFn: (body: UserForm) => api.post('/auth/register', body),
    onSuccess: () => { toast.success("Foydalanuvchi qo'shildi"); qc.invalidateQueries({ queryKey: ['users'] }); setUserModal(false); resetUser() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const blockUserMutation = useMutation({
    mutationFn: (u: any) => u.isActive
      ? api.post(`/expenses/users/${u.id}/block`)
      : api.post(`/expenses/users/${u.id}/unblock`),
    onSuccess: (_r, u) => {
      toast.success(u.isActive ? `${u.fullName} bloklandi` : `${u.fullName} faollashtirildi`)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/users/${id}`),
    onSuccess: () => {
      toast.success("Foydalanuvchi o'chirildi")
      qc.invalidateQueries({ queryKey: ['users'] })
      setDeleteUserConfirm(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const editUserMutation = useMutation({
    mutationFn: (body: EditUserForm) => api.put(`/expenses/users/${selectedUser.id}`, {
      fullName: body.fullName,
      role: body.role,
      branchId: body.branchId || null,
      isActive: body.isActive === 'true',
      ...(body.newPassword ? { newPassword: body.newPassword } : {}),
    }),
    onSuccess: () => {
      toast.success('Yangilandi')
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditUserModal(false); setSelectedUser(null); resetEditUser()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openEditUser = (u: any) => {
    setSelectedUser(u)
    setEditVal('fullName', u.fullName)
    setEditVal('role', u.role)
    setEditVal('branchId', u.branch?.id || '')
    setEditVal('isActive', u.isActive ? 'true' : 'false')
    setEditUserModal(true)
  }

  const saveSupplierMutation = useMutation({
    mutationFn: (body: SupplierForm) => selectedSupplier ? api.put(`/suppliers/${selectedSupplier.id}`, body) : api.post('/suppliers', body),
    onSuccess: () => {
      toast.success(selectedSupplier ? 'Yangilandi' : "Qo'shildi")
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setSupplierModal(false); resetSupplier(); setSelectedSupplier(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteSupplierMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => {
      toast.success("Yetkazuvchi o'chirildi")
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setDeleteSupplierConfirm(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const { data: supplierDetailData, isLoading: supplierDetailLoading, refetch: refetchDetail } = useQuery({
    queryKey: ['supplier-detail', supplierDetail?.id],
    queryFn: () => api.get(`/suppliers/${supplierDetail!.id}/detail`).then(r => r.data.data),
    enabled: !!supplierDetail?.id,
  })

  const addPaymentMutation = useMutation({
    mutationFn: () => api.post(`/suppliers/${supplierDetail!.id}/payments`, paymentForm),
    onSuccess: () => {
      toast.success("Yozuv qo'shildi")
      refetchDetail()
      setPaymentModal(false)
      setPaymentForm({ amount: '', type: 'invoice', paymentDate: new Date().toISOString().slice(0, 10), note: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deletePaymentMutation = useMutation({
    mutationFn: (paymentId: string) => api.delete(`/suppliers/${supplierDetail!.id}/payments/${paymentId}`),
    onSuccess: () => { toast.success("O'chirildi"); refetchDetail() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const addCategoryMutation = useMutation({
    mutationFn: (name: string) => api.post('/expenses/categories', { name }),
    onSuccess: () => { toast.success("Kategoriya qo'shildi"); qc.invalidateQueries({ queryKey: ['expense-categories'] }); setCategoryModal(false); setNewCategory('') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const branches = (branchesData || []).map((b: any) => ({ value: b.id, label: b.name }))
  const roleOptions = Object.entries(USER_ROLES).map(([k, v]) => ({ value: k, label: v }))

  const { user: currentUser } = useAuthStore()

  const userColumns = [
    { key: 'fullName', title: 'Ism', render: (u: any) => (
      <div>
        <span className="font-medium text-gray-900 dark:text-white">{u.fullName}</span>
        {!u.isActive && <span className="ml-2 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Bloklangan</span>}
      </div>
    )},
    { key: 'email', title: 'Email', render: (u: any) => <span className="text-sm text-gray-600 dark:text-gray-300">{u.email}</span> },
    { key: 'role', title: 'Rol', render: (u: any) => <Badge variant="default">{USER_ROLES[u.role] || u.role}</Badge> },
    { key: 'branch', title: 'Filial', render: (u: any) => u.branch?.name || <span className="text-gray-400 text-sm">Barcha</span> },
    { key: 'isActive', title: 'Holat', render: (u: any) => <Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Faol' : 'Bloklangan'}</Badge> },
    { key: 'actions', title: '', render: (u: any) => isAdmin() && u.id !== currentUser?.id && (
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEditUser(u)} />
        <button
          title={u.isActive ? 'Bloklash' : 'Faollashtirish'}
          onClick={() => blockUserMutation.mutate(u)}
          disabled={blockUserMutation.isPending}
          className={`p-1.5 rounded-lg transition-colors ${u.isActive
            ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
            : 'text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'}`}
        >
          {u.isActive ? <Ban className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
        </button>
        <button
          title="O'chirish"
          onClick={() => setDeleteUserConfirm(u)}
          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    )},
  ]

  const supplierColumns = [
    { key: 'name', title: 'Nomi', render: (s: Supplier) => (
      <button className="font-medium text-blue-600 dark:text-blue-400 hover:underline text-left" onClick={() => setSupplierDetail(s)}>
        {s.name}
      </button>
    )},
    { key: 'contactPerson', title: 'Kontakt', render: (s: Supplier) => s.contactPerson || '-' },
    { key: 'phone', title: 'Telefon' },
    { key: 'email', title: 'Email', render: (s: Supplier) => s.email || '-' },
    { key: 'isActive', title: 'Holat', render: (s: Supplier) => <Badge variant={s.isActive ? 'success' : 'danger'}>{s.isActive ? 'Faol' : 'Nofaol'}</Badge> },
    {
      key: 'actions', title: '', render: (s: Supplier) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => {
            setSelectedSupplier(s)
            setSupVal('name', s.name); setSupVal('contactPerson', s.contactPerson || '')
            setSupVal('phone', s.phone); setSupVal('email', s.email || '')
            setSupplierModal(true)
          }} />
          {isAdmin() && (
            <button onClick={() => setDeleteSupplierConfirm(s)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )
    },
  ]

  const auditColumns = [
    { key: 'createdAt', title: 'Vaqt', render: (r: any) => <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString('uz-UZ')}</span> },
    { key: 'user', title: 'Foydalanuvchi', render: (r: any) => <span className="font-medium text-sm">{r.user?.fullName || '-'}</span> },
    { key: 'action', title: 'Amal', render: (r: any) => {
      const colors: Record<string, string> = { CREATE: 'bg-green-100 text-green-700', UPDATE: 'bg-blue-100 text-blue-700', DELETE: 'bg-red-100 text-red-700' }
      return <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[r.action] || 'bg-gray-100 text-gray-700'}`}>{r.action}</span>
    }},
    { key: 'entityType', title: 'Tur', render: (r: any) => <span className="text-xs text-gray-600">{r.entityType}</span> },
    { key: 'entityId', title: 'ID', render: (r: any) => <span className="font-mono text-xs text-gray-400 truncate max-w-[80px] block">{r.entityId}</span> },
    { key: 'ipAddress', title: 'IP', render: (r: any) => <span className="text-xs text-gray-400">{r.ipAddress || '-'}</span> },
  ]

  const aiLogColumns = [
    { key: 'createdAt', title: 'Vaqt', render: (r: any) => <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString('uz-UZ')}</span> },
    { key: 'model', title: 'Model', render: (r: any) => <span className="font-mono text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{r.model}</span> },
    { key: 'entityType', title: 'Tur', render: (r: any) => <span className="text-xs text-gray-600">{r.entityType}</span> },
    { key: 'tokens', title: 'Tokenlar', render: (r: any) => <span className="text-sm">{(r.promptTokens || 0) + (r.completionTokens || 0)}</span> },
    { key: 'latencyMs', title: 'Latentlik', render: (r: any) => <span className="text-sm">{r.latencyMs ? `${r.latencyMs}ms` : '-'}</span> },
    { key: 'success', title: 'Holat', render: (r: any) => <Badge variant={r.success ? 'success' : 'danger'}>{r.success ? 'OK' : 'Xato'}</Badge> },
  ]

  const tabDefs: { key: Tab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: 'users',      label: 'Foydalanuvchilar', icon: <Users className="w-4 h-4" /> },
    { key: 'roles',      label: 'Rollar',            icon: <ShieldCheck className="w-4 h-4" /> },
    { key: 'suppliers',  label: "Yetkazuvchilar",    icon: <Package className="w-4 h-4" /> },
    { key: 'categories', label: 'Kategoriyalar',     icon: <Tag className="w-4 h-4" /> },
    { key: 'security',   label: 'Xavfsizlik',        icon: <Shield className="w-4 h-4" /> },
    { key: 'audit',      label: 'Audit log',         icon: <ClipboardList className="w-4 h-4" />, adminOnly: true },
    { key: 'ai-logs',    label: 'AI Loglar',         icon: <Bot className="w-4 h-4" />, adminOnly: true },
  ]

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sozlamalar</h1></div>

      <div className="flex gap-2 flex-wrap">
        {tabDefs.filter(t => !t.adminOnly || isAdmin()).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteUserConfirm}
        title="Foydalanuvchini o'chirish"
        message={`"${deleteUserConfirm?.fullName}" foydalanuvchisini o'chirishni tasdiqlaysizmi? Bu amalni qaytarib bo'lmaydi.`}
        confirmLabel="Ha, o'chirish"
        danger
        loading={deleteUserMutation.isPending}
        onConfirm={() => deleteUserMutation.mutate(deleteUserConfirm!.id)}
        onCancel={() => setDeleteUserConfirm(null)}
      />

      {tab === 'users' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">Foydalanuvchilar</h3>
            {isAdmin() && (
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { resetUser(); setUserModal(true) }}>Qo'shish</Button>
            )}
          </div>
          <Table columns={userColumns} data={usersData?.data || []} loading={usersLoading} />
          <Pagination page={userPage} totalPages={usersData?.meta?.totalPages || 1} total={usersData?.meta?.total || 0} limit={20} onPageChange={setUserPage} />
        </div>
      )}

      <ConfirmDialog
        open={!!deleteSupplierConfirm}
        title="Yetkazuvchini o'chirish"
        message={`"${deleteSupplierConfirm?.name}" yetkazuvchisini o'chirishni tasdiqlaysizmi?`}
        confirmLabel="Ha, o'chirish"
        danger
        loading={deleteSupplierMutation.isPending}
        onConfirm={() => deleteSupplierMutation.mutate(deleteSupplierConfirm!.id)}
        onCancel={() => setDeleteSupplierConfirm(null)}
      />

      {/* Supplier detail modal */}
      <Modal
        open={!!supplierDetail}
        onClose={() => setSupplierDetail(null)}
        title={supplierDetail?.name || ''}
        size="lg"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={() => setSupplierDetail(null)}>Yopish</Button>
            {isManager() && <Button icon={<Plus className="w-4 h-4" />} onClick={() => setPaymentModal(true)}>Yozuv qo'shish</Button>}
          </div>
        }
      >
        {supplierDetailLoading ? (
          <div className="py-8 text-center text-gray-400">Yuklanmoqda...</div>
        ) : supplierDetailData ? (() => {
          const d = supplierDetailData
          const balance = Number(d.balance)
          return (
            <div className="space-y-4">
              {/* Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {d.phone && <div><span className="text-gray-500">Telefon:</span> <span className="font-medium">{d.phone}</span></div>}
                {d.email && <div><span className="text-gray-500">Email:</span> <span className="font-medium">{d.email}</span></div>}
                {d.contactPerson && <div><span className="text-gray-500">Kontakt:</span> <span className="font-medium">{d.contactPerson}</span></div>}
                {d.address && <div><span className="text-gray-500">Manzil:</span> <span className="font-medium">{d.address}</span></div>}
              </div>

              {/* Balance cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                  <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">Jami xarid</p>
                  <p className="font-bold text-blue-800 dark:text-blue-200">{Number(d.invoiceTotal).toLocaleString()} so'm</p>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                  <p className="text-xs text-green-600 dark:text-green-400 mb-1">Jami to'lov</p>
                  <p className="font-bold text-green-800 dark:text-green-200">{Number(d.paymentTotal).toLocaleString()} so'm</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${balance > 0 ? 'bg-red-50 dark:bg-red-900/20' : balance < 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
                  <p className={`text-xs mb-1 ${balance > 0 ? 'text-red-600' : balance < 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {balance > 0 ? 'Biz qarz' : balance < 0 ? 'Ular qarz' : 'Hisob-kitob teng'}
                  </p>
                  <p className={`font-bold ${balance > 0 ? 'text-red-800 dark:text-red-200' : balance < 0 ? 'text-amber-800 dark:text-amber-200' : 'text-gray-600'}`}>
                    {Math.abs(balance).toLocaleString()} so'm
                  </p>
                </div>
              </div>

              {/* Payment history */}
              <div>
                <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-2 text-sm">To'lov tarixi</h4>
                {d.payments.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-4">Hali yozuvlar yo'q</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700/50">
                          <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Sana</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Tur</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Summa</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Izoh</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Kim</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {d.payments.map((p: any) => (
                          <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{new Date(p.paymentDate).toLocaleDateString('uz-UZ')}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.type === 'invoice' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                                {p.type === 'invoice' ? 'Xarid (qarz)' : "To'lov"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{Number(p.amount).toLocaleString()} so'm</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{p.note || '—'}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{p.createdBy?.fullName || '—'}</td>
                            <td className="px-3 py-2">
                              {isAdmin() && (
                                <button onClick={() => deletePaymentMutation.mutate(p.id)} className="text-red-400 hover:text-red-600">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )
        })() : null}
      </Modal>

      {/* Add payment modal */}
      <Modal
        open={paymentModal}
        onClose={() => setPaymentModal(false)}
        title="Yozuv qo'shish"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPaymentModal(false)}>Bekor qilish</Button>
            <Button loading={addPaymentMutation.isPending} onClick={() => addPaymentMutation.mutate()}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tur *</label>
            <select value={paymentForm.type} onChange={e => setPaymentForm(p => ({ ...p, type: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="invoice">Xarid (biz qarz bo'ldik)</option>
              <option value="payment">To'lov (biz to'ladik)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Summa *</label>
            <input type="number" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))}
              placeholder="0" className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sana *</label>
            <input type="date" value={paymentForm.paymentDate} onChange={e => setPaymentForm(p => ({ ...p, paymentDate: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <input value={paymentForm.note} onChange={e => setPaymentForm(p => ({ ...p, note: e.target.value }))}
              placeholder="Ixtiyoriy..." className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </Modal>

      {tab === 'suppliers' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">Yetkazuvchilar</h3>
            {isManager() && (
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { resetSupplier(); setSelectedSupplier(null); setSupplierModal(true) }}>Qo'shish</Button>
            )}
          </div>
          <Table columns={supplierColumns} data={suppliersData?.data || []} loading={suppliersLoading} />
          <Pagination page={supplierPage} totalPages={suppliersData?.meta?.totalPages || 1} total={suppliersData?.meta?.total || 0} limit={20} onPageChange={setSupplierPage} />
        </div>
      )}

      {tab === 'categories' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">Xarajat Kategoriyalari</h3>
            {isManager() && (
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setCategoryModal(true)}>Qo'shish</Button>
            )}
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {(categoriesData || []).length === 0
              ? <p className="text-gray-400 text-sm py-4">Kategoriyalar yo'q</p>
              : (categoriesData || []).map((c: any) => (
                <div key={c.id} className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200">{c.name}</div>
              ))
            }
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="space-y-4">
          {/* Role descriptions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              {
                role: 'admin', label: 'Admin', color: 'blue',
                desc: "Barcha bo'limlarga to'liq kirish. Foydalanuvchi qo'shish, o'chirish, filiallarni boshqarish.",
              },
              {
                role: 'manager', label: 'Menejer', color: 'purple',
                desc: "Barcha operatsion bo'limlarga kirish: transport, yoqilg'i, ombor, analitika. Faqat Filiallar va Billing yo'q.",
              },
              {
                role: 'branch_manager', label: 'Filial boshqaruvchisi', color: 'green',
                desc: "O'z filialining transport, yoqilg'i, ombor bo'limlarini boshqaradi. Analitika va AI tahlilga kirish yo'q.",
              },
              {
                role: 'operator', label: 'Operator', color: 'yellow',
                desc: "Faqat yo'l varaqlari yaratish, yoqilg'i qo'shish va avtomashina holatini ko'rish.",
              },
            ].map(r => (
              <div key={r.role} className={`rounded-xl border p-4 bg-${r.color}-50 dark:bg-${r.color}-900/10 border-${r.color}-200 dark:border-${r.color}-800`}>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold mb-2 bg-${r.color}-100 dark:bg-${r.color}-900/30 text-${r.color}-700 dark:text-${r.color}-300`}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {r.label}
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>

          {/* Permission matrix */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">Ruxsatnomalar jadvali</h3>
              <p className="text-xs text-gray-500 mt-0.5">✅ To'liq kirish &nbsp; ⚠️ Cheklangan &nbsp; ❌ Kirish yo'q</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 min-w-[180px]">Bo'lim</th>
                    <th className="text-center px-4 py-2.5 font-medium text-blue-600">Admin</th>
                    <th className="text-center px-4 py-2.5 font-medium text-purple-600">Menejer</th>
                    <th className="text-center px-4 py-2.5 font-medium text-green-600">Fil. bosh.</th>
                    <th className="text-center px-4 py-2.5 font-medium text-yellow-600">Operator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[
                    { label: 'Boshqaruv paneli',      adm:'✅', mgr:'✅', brm:'✅', opr:'✅' },
                    { label: 'Analitika',              adm:'✅', mgr:'✅', brm:'❌', opr:'❌' },
                    { label: 'Hisobotlar',             adm:'✅', mgr:'✅', brm:'❌', opr:'❌' },
                    { label: '—', adm:'', mgr:'', brm:'', opr:'', header: true },
                    { label: 'Avtomashinalari',        adm:'✅', mgr:'✅', brm:'✅', opr:'✅ (ko\'rish)' },
                    { label: "Yo'l varaqlari",         adm:'✅', mgr:'✅', brm:'✅', opr:'✅' },
                    { label: 'Texnika holati',         adm:'✅', mgr:'✅', brm:'✅', opr:'✅ (ko\'rish)' },
                    { label: "Ta'mirlash",             adm:'✅', mgr:'✅', brm:'✅', opr:'❌' },
                    { label: 'Bashoratlar',            adm:'✅', mgr:'✅', brm:'✅', opr:'❌' },
                    { label: 'Shinalar',               adm:'✅', mgr:'✅', brm:'✅', opr:'❌' },
                    { label: 'Kafolatlar',             adm:'✅', mgr:'✅', brm:'✅', opr:'❌' },
                    { label: '—', adm:'', mgr:'', brm:'', opr:'', header: true },
                    { label: "Yoqilg'i",               adm:'✅', mgr:'✅', brm:'✅', opr:'✅' },
                    { label: "Yoqilg'i tahlili",       adm:'✅', mgr:'✅', brm:'❌', opr:'❌' },
                    { label: 'Vedomost Import',        adm:'✅', mgr:'✅', brm:'✅', opr:'❌' },
                    { label: '—', adm:'', mgr:'', brm:'', opr:'', header: true },
                    { label: 'Ehtiyot qismlar',        adm:'✅', mgr:'✅', brm:'✅', opr:'❌' },
                    { label: 'Yetkazuvchilar',         adm:'✅', mgr:'✅', brm:'❌', opr:'❌' },
                    { label: 'Ombor (Sklad)',           adm:'✅ Barchasi', mgr:'✅ Barchasi', brm:'⚠️ Faqat o\'z skladi', opr:'❌' },
                    { label: "O'tkazmalar",            adm:'✅', mgr:'✅', brm:'⚠️ O\'z skladidan', opr:'❌' },
                    { label: '—', adm:'', mgr:'', brm:'', opr:'', header: true },
                    { label: 'Anomaliyalar',           adm:'✅', mgr:'✅', brm:'❌', opr:'❌' },
                    { label: 'Tavsiyalar',             adm:'✅', mgr:'✅', brm:'❌', opr:'❌' },
                    { label: '—', adm:'', mgr:'', brm:'', opr:'', header: true },
                    { label: 'Filiallar',              adm:'✅', mgr:'❌', brm:'❌', opr:'❌' },
                    { label: 'Sozlamalar',             adm:'✅', mgr:'⚠️ (cheklangan)', brm:'❌', opr:'❌' },
                    { label: 'Billing',                adm:'✅', mgr:'❌', brm:'❌', opr:'❌' },
                    { label: 'Import',                 adm:'✅', mgr:'❌', brm:'❌', opr:'❌' },
                    { label: '—', adm:'', mgr:'', brm:'', opr:'', header: true },
                    { label: "Qo'llab-quvvatlash",    adm:'✅', mgr:'✅', brm:'✅', opr:'✅' },
                  ].map((row, i) => row.header
                    ? (
                      <tr key={i} className="bg-gray-50/50 dark:bg-gray-700/20">
                        <td colSpan={5} className="px-4 py-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                          {row.label === '—' ? '' : row.label}
                        </td>
                      </tr>
                    ) : (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{row.label}</td>
                        <td className="px-4 py-2 text-center">{row.adm}</td>
                        <td className="px-4 py-2 text-center">{row.mgr}</td>
                        <td className="px-4 py-2 text-center">{row.brm}</td>
                        <td className="px-4 py-2 text-center">{row.opr}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'audit' && isAdmin() && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
              <h3 className="font-semibold text-gray-800 dark:text-white">Audit Jurnali</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input placeholder="Tur yoki amal bo'yicha..." className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={auditSearch} onChange={e => { setAuditSearch(e.target.value); setAuditPage(1) }} />
              </div>
            </div>
            <Table columns={auditColumns} data={auditData?.data || []} loading={auditLoading} />
            <Pagination page={auditPage} totalPages={auditData?.meta?.totalPages || 1} total={auditData?.meta?.total || 0} limit={20} onPageChange={setAuditPage} />
          </div>
        </div>
      )}

      {tab === 'ai-logs' && isAdmin() && (
        <div className="space-y-4">
          {/* Stats row */}
          {aiStats && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Jami so'rovlar", value: aiStats.total || 0 },
                { label: 'Muvaffaqiyatli', value: (aiStats.total || 0) - (aiStats.failed || 0) },
                { label: 'Xatolar', value: aiStats.failed || 0, danger: true },
                { label: 'Muvaffaqiyat %', value: `${aiStats.successRate || '100'}%` },
                { label: "O'rtacha latentlik", value: `${aiStats.avgLatencyMs || 0}ms` },
              ].map(card => (
                <div key={card.label} className={`rounded-xl border p-3 ${card.danger ? 'bg-red-50 dark:bg-red-900/20 border-red-200' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${card.danger && Number(card.value) > 0 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{card.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
              <h3 className="font-semibold text-gray-800 dark:text-white">AI Tahlil Loglari</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input placeholder="Model yoki tur bo'yicha..." className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={aiLogSearch} onChange={e => { setAiLogSearch(e.target.value); setAiLogPage(1) }} />
              </div>
            </div>
            <Table columns={aiLogColumns} data={aiLogData?.data || []} loading={aiLogLoading} />
            <Pagination page={aiLogPage} totalPages={aiLogData?.meta?.totalPages || 1} total={aiLogData?.meta?.total || 0} limit={20} onPageChange={setAiLogPage} />
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-4 max-w-xl">
          {/* Email Verification */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex-shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">Email tasdiqlash</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Email manzilingizni tasdiqlang</p>
                <div className="flex items-center gap-2 mt-2">
                  {user?.emailVerified ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-600 dark:text-green-400 font-medium">Tasdiqlangan</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-600 dark:text-red-400">Tasdiqlanmagan</span>
                    </>
                  )}
                </div>
                {!user?.emailVerified && (
                  <Button size="sm" className="mt-3" loading={sendVerificationMutation.isPending}
                    onClick={() => sendVerificationMutation.mutate()}>
                    Tasdiqlash xatini yuborish
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Two-Factor Authentication */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 flex-shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">Ikki bosqichli autentifikatsiya (2FA)</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Google Authenticator yoki boshqa TOTP ilovasi orqali
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {user?.twoFactorEnabled ? (
                    <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-sm text-green-600 dark:text-green-400 font-medium">Yoqilgan</span></>
                  ) : (
                    <><XCircle className="w-4 h-4 text-gray-400" /><span className="text-sm text-gray-500">O'chirilgan</span></>
                  )}
                </div>

                {!user?.twoFactorEnabled && !twoFAQR && (
                  <Button size="sm" className="mt-3" loading={setup2FAMutation.isPending}
                    onClick={() => setup2FAMutation.mutate()}>
                    2FA ni yoqish
                  </Button>
                )}

                {twoFAQR && (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      QR kodni autentifikator ilovangiz orqali skanerlang:
                    </p>
                    <img src={twoFAQR} alt="2FA QR" className="w-40 h-40 rounded-lg border border-gray-200" />
                    {twoFASecret && (
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500 mb-1">Yoki maxfiy kalitni qo'lda kiriting:</p>
                        <code className="text-xs font-mono text-gray-900 dark:text-white break-all">{twoFASecret}</code>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text" inputMode="numeric" maxLength={6}
                        value={totpInput} onChange={e => setTotpInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="6 raqamli kod"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono tracking-widest"
                      />
                      <Button size="sm" loading={verify2FAMutation.isPending}
                        disabled={totpInput.length !== 6}
                        onClick={() => verify2FAMutation.mutate(totpInput)}>
                        Tasdiqlash
                      </Button>
                    </div>
                  </div>
                )}

                {user?.twoFactorEnabled && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm text-gray-500">2FA ni o'chirish uchun parol va TOTP kodni kiriting:</p>
                    <input type="password" placeholder="Joriy parol" value={disablePassword}
                      onChange={e => setDisablePassword(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="flex gap-2">
                      <input type="text" inputMode="numeric" maxLength={6} placeholder="TOTP kod"
                        value={disableTotpInput} onChange={e => setDisableTotpInput(e.target.value.replace(/\D/g, ''))}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono tracking-widest" />
                      <Button size="sm" variant="danger" loading={disable2FAMutation.isPending}
                        disabled={!disablePassword || disableTotpInput.length !== 6}
                        onClick={() => disable2FAMutation.mutate()}>
                        O'chirish
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Modal */}
      <Modal open={userModal} onClose={() => { setUserModal(false); resetUser() }} title="Yangi foydalanuvchi" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setUserModal(false); resetUser() }}>Bekor qilish</Button>
            <Button loading={addUserMutation.isPending} onClick={handleUser(d => addUserMutation.mutate(d))}>Qo'shish</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Ism Familiya *" error={userErrors.fullName?.message} {...regUser('fullName', { required: 'Talab qilinadi' })} />
          <Input label="Email yoki telefon *" placeholder="+998901234567 yoki email@..." error={userErrors.email?.message} {...regUser('email', { required: 'Talab qilinadi' })} />
          <Input label="Parol *" type="password" error={userErrors.password?.message} {...regUser('password', { required: 'Talab qilinadi', minLength: { value: 8, message: 'Min 8 ta belgi' } })} />
          <div>
            <Select label="Rol *" options={roleOptions} placeholder="Tanlang" error={userErrors.role?.message} {...regUser('role', { required: 'Talab qilinadi' })} />
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1"><span className="font-semibold text-blue-600">Admin</span> — to'liq kirish</span>
              <span className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1"><span className="font-semibold text-purple-600">Menejer</span> — operatsion bo'limlar</span>
              <span className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1"><span className="font-semibold text-green-600">Fil. bosh.</span> — o'z filiali</span>
              <span className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1"><span className="font-semibold text-yellow-600">Operator</span> — minimal</span>
            </div>
          </div>
          <div>
            <Select label="Filial" options={[{ value: '', label: '— Tanlang (ixtiyoriy) —' }, ...branches]} {...regUser('branchId')} />
            {(() => {
              const selBranchId = watchUser('branchId')
              const selBranch = branchesData?.find((b: any) => b.id === selBranchId)
              if (selBranchId && selBranch) return (
                <p className="text-[11px] mt-1 text-blue-600">Sklad: {selBranch?.warehouse?.name ?? <span className="text-amber-500">Biriktirilmagan</span>}</p>
              )
              return <p className="text-[11px] text-gray-400 mt-1">Filial boshqaruvchisi va operator uchun filial belgilash tavsiya qilinadi.</p>
            })()}
          </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal open={editUserModal} onClose={() => { setEditUserModal(false); setSelectedUser(null); resetEditUser() }}
        title="Foydalanuvchini tahrirlash" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditUserModal(false)}>Bekor qilish</Button>
            <Button loading={editUserMutation.isPending} onClick={handleEditUser(d => editUserMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Ism Familiya *" error={editUserErrors.fullName?.message}
            {...regEditUser('fullName', { required: 'Talab qilinadi' })} />
          <div>
            <Select label="Rol *" options={roleOptions} placeholder="Tanlang"
              error={editUserErrors.role?.message}
              {...regEditUser('role', { required: 'Talab qilinadi' })} />
            <p className="text-[11px] text-gray-400 mt-1">
              Rollar haqida batafsil: Sozlamalar → Rollar tabida
            </p>
          </div>
          <div>
            <Select label="Filial"
              options={[{ value: '', label: '— Tanlang (ixtiyoriy) —' }, ...branches]}
              {...regEditUser('branchId')} />
            {(() => {
              const selBranchId = watchEditUser('branchId')
              const selBranch = branchesData?.find((b: any) => b.id === selBranchId)
              if (!selBranchId) return null
              return (
                <p className="text-[11px] mt-1 text-blue-600">
                  Sklad: {selBranch?.warehouse?.name ?? <span className="text-amber-500">Biriktirilmagan</span>}
                </p>
              )
            })()}
          </div>
          <Select label="Holat"
            options={[{ value: 'true', label: 'Faol' }, { value: 'false', label: 'Nofaol' }]}
            {...regEditUser('isActive')} />
          <div>
            <Input label="Yangi parol (ixtiyoriy)" type="password" placeholder="O'zgartirish uchun kiriting"
              {...regEditUser('newPassword', { minLength: { value: 8, message: 'Min 8 ta belgi' } })}
              error={editUserErrors.newPassword?.message} />
            <p className="text-[11px] text-gray-400 mt-1">Bo'sh qoldirilsa parol o'zgarmaydi</p>
          </div>
        </div>
      </Modal>

      {/* Supplier Modal */}
      <Modal open={supplierModal} onClose={() => { setSupplierModal(false); setSelectedSupplier(null) }}
        title={selectedSupplier ? "Ta'minotchi tahrirlash" : "Ta'minotchi qo'shish"} size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setSupplierModal(false)}>Bekor qilish</Button>
            <Button loading={saveSupplierMutation.isPending} onClick={handleSupplier(d => saveSupplierMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Nomi *" error={supErrors.name?.message} {...regSupplier('name', { required: 'Talab qilinadi' })} />
          <Input label="Kontakt shaxs" {...regSupplier('contactPerson')} />
          <Input label="Telefon *" error={supErrors.phone?.message} {...regSupplier('phone', { required: 'Talab qilinadi' })} />
          <Input label="Email" type="email" {...regSupplier('email')} />
          <Input label="Manzil" {...regSupplier('address')} />
          <Input label="To'lov shartlari" {...regSupplier('paymentTerms')} />
        </div>
      </Modal>

      {/* Category Modal */}
      <Modal open={categoryModal} onClose={() => setCategoryModal(false)} title="Kategoriya qo'shish" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCategoryModal(false)}>Bekor qilish</Button>
            <Button loading={addCategoryMutation.isPending} onClick={() => newCategory && addCategoryMutation.mutate(newCategory)}>Qo'shish</Button>
          </>
        }
      >
        <Input label="Kategoriya nomi *" value={newCategory} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCategory(e.target.value)} placeholder="Masalan: Ta'mirlash" />
      </Modal>
    </div>
  )
}
