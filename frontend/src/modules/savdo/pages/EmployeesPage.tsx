import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, Loader2, ToggleLeft, ToggleRight, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface Employee {
  id: string
  email: string
  fullName: string
  role: 'admin' | 'manager' | 'cashier' | 'staff'
  isActive: boolean
}

const ROLE_LABELS: Record<Employee['role'], string> = {
  admin: 'Admin', manager: 'Menejer', cashier: 'Kassir', staff: 'Xodim',
}

const EMPTY = { email: '', fullName: '', password: '', role: 'staff' as Employee['role'] }

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const fetchEmployees = useCallback(() => {
    setLoading(true)
    savdoApi.get('/users')
      .then(res => setEmployees(res.data.data ?? []))
      .catch(() => toast.error('Xodimlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email.trim() || !form.fullName.trim()) { toast.error('Login va ism talab qilinadi'); return }
    if (form.password.length < 6) { toast.error('Parol kamida 6 ta belgidan iborat bo\'lishi kerak'); return }
    setSaving(true)
    try {
      await savdoApi.post('/users', {
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        password: form.password,
        role: form.role,
      })
      toast.success('Xodim qo\'shildi — endi u /savdo/login orqali o\'z login/paroli bilan kira oladi')
      setForm(EMPTY); setShowForm(false)
      fetchEmployees()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(emp: Employee) {
    try {
      await savdoApi.put(`/users/${emp.id}`, { isActive: !emp.isActive })
      fetchEmployees()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    }
  }

  async function handleResetPassword(emp: Employee) {
    const newPassword = window.prompt(`${emp.fullName} uchun yangi parol (kamida 6 belgi):`)
    if (!newPassword) return
    if (newPassword.length < 6) { toast.error('Parol kamida 6 ta belgidan iborat bo\'lishi kerak'); return }
    try {
      await savdoApi.put(`/users/${emp.id}/password`, { newPassword })
      toast.success('Parol yangilandi')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Xodimlar</h1>
          <p className="text-sm text-gray-500">Har bir xodim o'z login/paroli bilan /savdo/login orqali kiradi — AutoHisob hisobisiz</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Xodim qo'shish
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Login (email yoki telefon)</label>
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">F.I.Sh.</label>
            <input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Parol</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Employee['role'] }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="staff">Xodim</option>
              <option value="cashier">Kassir</option>
              <option value="manager">Menejer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="col-span-full">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : employees.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali xodim qo'shilmagan
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">F.I.Sh.</th>
                <th className="text-left px-4 py-2.5 font-medium">Login</th>
                <th className="text-left px-4 py-2.5 font-medium">Rol</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                <th className="text-right px-4 py-2.5 font-medium">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{emp.fullName}</td>
                  <td className="px-4 py-2.5 text-gray-500">{emp.email}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{ROLE_LABELS[emp.role]}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => toggleActive(emp)} className="flex items-center gap-1.5 text-xs">
                      {emp.isActive ? (
                        <><ToggleRight className="w-4 h-4 text-green-600" /> <span className="text-green-700">Faol</span></>
                      ) : (
                        <><ToggleLeft className="w-4 h-4 text-gray-400" /> <span className="text-gray-400">Nofaol</span></>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleResetPassword(emp)} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-amber-700">
                      <KeyRound className="w-3.5 h-3.5" /> Parolni tiklash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
