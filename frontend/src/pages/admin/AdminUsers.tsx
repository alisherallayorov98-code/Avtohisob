import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import { Search, X, ChevronLeft, ChevronRight, Edit2, Lock, Trash2, UserCheck, UserX } from 'lucide-react'

const ROLES = ['super_admin', 'admin', 'manager', 'branch_manager', 'operator']

function roleBadge(role: string) {
  const map: Record<string, string> = {
    super_admin: 'bg-red-900 text-red-300 border-red-700',
    admin: 'bg-purple-900 text-purple-300 border-purple-700',
    manager: 'bg-blue-900 text-blue-300 border-blue-700',
    branch_manager: 'bg-teal-900 text-teal-300 border-teal-700',
    operator: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return map[role] || 'bg-gray-800 text-gray-400 border-gray-700'
}

function formatDate(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('uz-UZ')
}

export default function AdminUsers() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  // Edit modal
  const [editUser, setEditUser] = useState<any>(null)
  const [editForm, setEditForm] = useState({ fullName: '', role: '', isActive: true, branchId: '' })

  // Reset password modal
  const [resetUser, setResetUser] = useState<any>(null)
  const [newPassword, setNewPassword] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search, role, status, page],
    queryFn: () => api.get('/admin/users', { params: { search: search || undefined, role: role || undefined, status: status || undefined, page, limit: 20 } }).then(r => r.data),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditUser(null); toast.success('Yangilandi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const suspendMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/suspend`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); toast.success('Bloklandi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/activate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); toast.success('Faollashtirildi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); toast.success('O\'chirildi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const resetPassMut = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) => api.post(`/admin/users/${id}/reset-password`, { newPassword }),
    onSuccess: () => { setResetUser(null); setNewPassword(''); toast.success('Parol yangilandi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const users = data?.data || []
  const pagination = data?.pagination || {}

  function openEdit(u: any) {
    setEditUser(u)
    setEditForm({ fullName: u.fullName, role: u.role, isActive: u.isActive, branchId: u.branchId || '' })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Foydalanuvchilar</h2>
          <p className="text-gray-500 text-sm">{pagination.total ?? 0} ta foydalanuvchi</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Qidirish..."
            className="bg-gray-900 border border-gray-700 text-white pl-9 pr-4 py-2 rounded-lg text-sm w-60 focus:outline-none focus:border-red-500"
          />
        </div>
        <select
          value={role}
          onChange={e => { setRole(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-red-500"
        >
          <option value="">Barcha rollar</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-red-500"
        >
          <option value="">Barcha holat</option>
          <option value="active">Aktiv</option>
          <option value="inactive">Bloklangan</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Email', 'Ismi', 'Rol', 'Filial', 'Plan', 'Holat', 'Oxirgi kirish', 'Amallar'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-medium px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-gray-500 py-12">Ma'lumot topilmadi</td></tr>
                )}
                {users.map((u: any) => (
                  <tr key={u.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-3 text-white font-medium">{u.fullName}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${roleBadge(u.role)}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{u.branchName || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{u.planName || 'Bepul'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.isActive ? 'text-green-400' : 'text-red-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                        {u.isActive ? 'Aktiv' : 'Bloklangan'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title="Tahrirlash">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => { setResetUser(u); setNewPassword('') }} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title="Parol tiklash">
                          <Lock className="w-3.5 h-3.5" />
                        </button>
                        {u.isActive ? (
                          <button onClick={() => suspendMut.mutate(u.id)} className="p-1.5 hover:bg-gray-700 rounded text-yellow-400 hover:text-yellow-300" title="Bloklash">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => activateMut.mutate(u.id)} className="p-1.5 hover:bg-gray-700 rounded text-green-400 hover:text-green-300" title="Faollashtirish">
                            <UserCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => { if (window.confirm('Haqiqatan ham o\'chirmoqchimisiz?')) deleteMut.mutate(u.id) }}
                          className="p-1.5 hover:bg-gray-700 rounded text-red-400 hover:text-red-300"
                          title="O'chirish"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Sahifa {page} / {pagination.pages}</p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page >= pagination.pages}
              onClick={() => setPage(p => p + 1)}
              className="p-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold text-white">Foydalanuvchini tahrirlash</h3>
              <button onClick={() => setEditUser(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Ism</label>
                <input
                  value={editForm.fullName}
                  onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Rol</label>
                <select
                  value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editForm.isActive}
                  onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                  className="w-4 h-4 accent-red-600"
                />
                <label htmlFor="isActive" className="text-sm text-gray-400">Aktiv</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditUser(null)} className="flex-1 py-2 bg-gray-800 text-gray-400 rounded-lg text-sm hover:bg-gray-700">Bekor</button>
              <button
                onClick={() => updateMut.mutate({ id: editUser.id, body: editForm })}
                disabled={updateMut.isPending}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold text-white">Parolni tiklash</h3>
              <button onClick={() => setResetUser(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-400 mb-4">{resetUser.fullName} ({resetUser.email})</p>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Yangi parol (min 6 belgi)"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setResetUser(null)} className="flex-1 py-2 bg-gray-800 text-gray-400 rounded-lg text-sm hover:bg-gray-700">Bekor</button>
              <button
                onClick={() => resetPassMut.mutate({ id: resetUser.id, newPassword })}
                disabled={resetPassMut.isPending || newPassword.length < 6}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {resetPassMut.isPending ? 'Yuklanmoqda...' : 'Tiklash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
