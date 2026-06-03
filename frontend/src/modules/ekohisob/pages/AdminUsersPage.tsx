import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, KeyRound, MapPin, Loader2, X, Users, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

interface EkoInspector {
  id: string
  fullName: string
  email: string
  role: 'admin' | 'inspector'
  isActive: boolean
  districtIds: string[]
}

interface District {
  id: string
  name: string
}

interface NewUserForm {
  fullName: string
  email: string
  password: string
  role: 'admin' | 'inspector'
  districtIds: string[]
}

const EMPTY_FORM: NewUserForm = {
  fullName: '',
  email: '',
  password: '',
  role: 'inspector',
  districtIds: [],
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<EkoInspector[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewUserForm>(EMPTY_FORM)
  const [formLoading, setFormLoading] = useState(false)
  const [editingUser, setEditingUser] = useState<EkoInspector | null>(null)
  const [assignDistrictUser, setAssignDistrictUser] = useState<EkoInspector | null>(null)
  const [assignedIds, setAssignedIds] = useState<string[]>([])

  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  const fetchUsers = useCallback(() => {
    setLoading(true)
    ekoApi.get('/admin/users')
      .then(res => {
        const data = res.data.data ?? res.data
        setUsers(Array.isArray(data) ? data : [])
      })
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.fullName.trim() || !form.email.trim() || !form.password) {
      toast.error("Majburiy maydonlarni to'ldiring")
      return
    }
    setFormLoading(true)
    try {
      await ekoApi.post('/admin/users', form)
      toast.success("Foydalanuvchi qo'shildi")
      setShowModal(false)
      setForm(EMPTY_FORM)
      fetchUsers()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Xato yuz berdi'
      toast.error(msg)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleToggleActive(user: EkoInspector) {
    try {
      await ekoApi.patch(`/admin/users/${user.id}`, { isActive: !user.isActive })
      toast.success(user.isActive ? "Bloklandi" : "Faollashtirildi")
      fetchUsers()
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  async function handleResetPassword(user: EkoInspector) {
    const newPassword = window.prompt(`"${user.fullName}" uchun yangi parol kiriting:`)
    if (newPassword === null) return
    if (!newPassword.trim() || newPassword.length < 6) {
      toast.error("Parol kamida 6 ta belgidan iborat bo'lishi kerak")
      return
    }
    try {
      await ekoApi.patch(`/admin/users/${user.id}/reset-password`, { password: newPassword.trim() })
      toast.success('Parol yangilandi')
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  async function handleSaveDistricts() {
    if (!assignDistrictUser) return
    try {
      await ekoApi.patch(`/admin/users/${assignDistrictUser.id}`, { districtIds: assignedIds })
      toast.success('Tumanlar yangilandi')
      setAssignDistrictUser(null)
      fetchUsers()
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  function toggleDistrict(id: string) {
    setAssignedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Foydalanuvchilar</h1>
          <p className="text-sm text-gray-500 mt-0.5">EkoHisob inspektorlari va adminlari</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yangi foydalanuvchi
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Foydalanuvchilar topilmadi</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">F.I.O.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rol</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Tumanlar</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Holat</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{user.fullName}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {user.role === 'admin' ? 'Admin' : 'Inspektor'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm text-gray-600">{user.districtIds.length} tuman</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={`flex items-center gap-1.5 text-xs font-medium ${user.isActive ? 'text-green-600' : 'text-gray-400'}`}
                      >
                        {user.isActive ? (
                          <ToggleRight className="w-5 h-5" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                        {user.isActive ? 'Faol' : 'Bloklangan'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingUser(user)}
                          title="Tahrirlash"
                          className="p-1.5 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors text-gray-400"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleResetPassword(user)}
                          title="Parolni yangilash"
                          className="p-1.5 hover:bg-orange-50 hover:text-orange-600 rounded-lg transition-colors text-gray-400"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setAssignDistrictUser(user)
                            setAssignedIds(user.districtIds)
                          }}
                          title="Tumanlarni belgilash"
                          className="p-1.5 hover:bg-green-50 hover:text-green-600 rounded-lg transition-colors text-gray-400"
                        >
                          <MapPin className="w-4 h-4" />
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

      {/* Create user modal */}
      {(showModal || editingUser) && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => { setShowModal(false); setEditingUser(null) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">
                {editingUser ? 'Foydalanuvchini tahrirlash' : "Yangi foydalanuvchi qo'shish"}
              </h3>
              <button
                onClick={() => { setShowModal(false); setEditingUser(null) }}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">F.I.O. <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={form.fullName}
                  onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                  placeholder="Ismingiz Familiyangiz"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email <span className="text-red-500">*</span></label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@misol.uz"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Parol <span className="text-red-500">*</span></label>
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Kamida 6 ta belgi"
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'inspector' }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="inspector">Inspektor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingUser(null) }}
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

      {/* District assignment modal */}
      {assignDistrictUser && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setAssignDistrictUser(null)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-800">Tumanlarni belgilash</h3>
                <p className="text-xs text-gray-500 mt-0.5">{assignDistrictUser.fullName}</p>
              </div>
              <button onClick={() => setAssignDistrictUser(null)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-2 max-h-72 overflow-y-auto">
              {districts.map(d => (
                <label key={d.id} className="flex items-center gap-3 cursor-pointer py-1.5 hover:text-green-700">
                  <input
                    type="checkbox"
                    checked={assignedIds.includes(d.id)}
                    onChange={() => toggleDistrict(d.id)}
                    className="w-4 h-4 rounded text-green-600"
                  />
                  <span className="text-sm text-gray-700">{d.name}</span>
                </label>
              ))}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setAssignDistrictUser(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleSaveDistricts}
                className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
