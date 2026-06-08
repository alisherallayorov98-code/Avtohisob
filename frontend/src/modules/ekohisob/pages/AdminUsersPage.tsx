import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, KeyRound, MapPin, Loader2, X, Users, ToggleLeft, ToggleRight, Link, Unlink, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

interface BotLinkInfo {
  chatId: string
  tgUsername: string | null
  tgFirstName: string | null
  linkedAt: string
}

interface EkoInspector {
  id: string
  fullName: string
  email: string
  role: 'admin' | 'inspector' | 'supervisor'
  isActive: boolean
  districtIds: string[]
  botLink: BotLinkInfo | null
}

interface District {
  id: string
  name: string
}

interface NewUserForm {
  fullName: string
  email: string
  password: string
  role: 'admin' | 'inspector' | 'supervisor'
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
  const [editFullName, setEditFullName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [assignDistrictUser, setAssignDistrictUser] = useState<EkoInspector | null>(null)
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [botToken, setBotToken] = useState<{ token: string; userName: string; deepLink?: string | null } | null>(null)
  const [botTokenLoading, setBotTokenLoading] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  const fetchUsers = useCallback(() => {
    setLoading(true)
    ekoApi.get('/users')
      .then(res => {
        const data = res.data.data ?? res.data
        const list: EkoInspector[] = (Array.isArray(data) ? data : []).map((u: any) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          // Backend `districts: [{ district: {id,name} }]` → districtIds
          districtIds: Array.isArray(u.districts)
            ? u.districts.map((d: any) => d.district?.id ?? d.districtId).filter(Boolean)
            : (u.districtIds ?? []),
          botLink: u.botLink ?? null,
        }))
        setUsers(list)
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
      const res = await ekoApi.post('/users', {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
      })
      // Yangi foydalanuvchiga tanlangan tumanlarni biriktiramiz (agar bo'lsa)
      const created = res.data.data ?? res.data
      if (created?.id && form.districtIds.length > 0) {
        await ekoApi.put(`/users/${created.id}/districts`, { districtIds: form.districtIds })
      }
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

  async function handleEditSave() {
    if (!editingUser || !editFullName.trim() || !editEmail.trim()) return
    setEditSaving(true)
    try {
      await ekoApi.put(`/users/${editingUser.id}`, { fullName: editFullName.trim(), email: editEmail.trim() })
      toast.success('Yangilandi')
      setEditingUser(null)
      fetchUsers()
    } catch { toast.error('Xato yuz berdi') }
    finally { setEditSaving(false) }
  }

  async function handleToggleActive(user: EkoInspector) {
    try {
      await ekoApi.put(`/users/${user.id}`, { isActive: !user.isActive })
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
      await ekoApi.put(`/users/${user.id}/password`, { newPassword: newPassword.trim() })
      toast.success('Parol yangilandi')
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  async function handleSaveDistricts() {
    if (!assignDistrictUser) return
    try {
      await ekoApi.put(`/users/${assignDistrictUser.id}/districts`, { districtIds: assignedIds })
      toast.success('Tumanlar yangilandi')
      setAssignDistrictUser(null)
      fetchUsers()
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  async function handleGenerateBotToken(user: EkoInspector) {
    setBotTokenLoading(user.id)
    try {
      const res = await ekoApi.post('/bot/link-token', { userId: user.id })
      const d = res.data.data ?? res.data
      setBotToken({ token: d.token, userName: d.userName, deepLink: d.deepLink })
    } catch {
      toast.error('Token yaratishda xato')
    } finally {
      setBotTokenLoading(null)
    }
  }

  async function handleUnlinkBot(user: EkoInspector) {
    const who = user.botLink?.tgUsername
      ? '@' + user.botLink.tgUsername
      : (user.botLink?.tgFirstName || 'ulangan qurilma')
    if (!window.confirm(`${user.fullName} — "${who}" Telegram bog'lanishini uzasizmi?\n\nInspektor qayta ulanishi uchun unga yangi token berishingiz kerak bo'ladi.`)) return
    try {
      await ekoApi.delete(`/bot/link/${user.id}`)
      toast.success('Telegram bog\'lanishi uzildi')
      fetchUsers()
    } catch {
      toast.error('Uzishda xato')
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

      {/* Tushuntirish banneri */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">💡 Xodimga kirish berishning ikki usuli:</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>
            <b>AutoHisob orqali (tavsiya):</b> AutoHisob → Sozlamalar → Foydalanuvchilar →
            {' '}<span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">EkoHisob foydalanuvchisi</span> roli tanlang.
            Xodim <b>avtohisob.uz</b> ga kirsa — avtomatik EkoHisob ga o'tadi.
          </li>
          <li>
            <b>Bu sahifada:</b> Alohida EkoHisob login/parol yarating. Xodim <b>avtohisob.uz/ekohisob/login</b> ga kiradi.
          </li>
        </ol>
      </div>

      {/* Qidiruv */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Ism yoki email bo'yicha qidirish..."
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white shadow-sm"
      />

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
                {users.filter(u =>
                  !search.trim() ||
                  u.fullName.toLowerCase().includes(search.toLowerCase()) ||
                  u.email.toLowerCase().includes(search.toLowerCase())
                ).map(user => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{user.fullName}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : user.role === 'supervisor'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {user.role === 'admin' ? 'Admin' : user.role === 'supervisor' ? 'Boshliq' : 'Inspektor'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm text-gray-600">{user.districtIds.length} tuman</span>
                      {(user.role === 'inspector' || user.role === 'supervisor') && (
                        <div className="mt-0.5">
                          {user.botLink ? (
                            <span className="text-xs text-green-600" title={`Ulangan: ${new Date(user.botLink.linkedAt).toLocaleDateString('uz-UZ')}`}>
                              📱 {user.botLink.tgUsername ? '@' + user.botLink.tgUsername : (user.botLink.tgFirstName || 'ulangan')}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">📱 ulanmagan</span>
                          )}
                        </div>
                      )}
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
                          onClick={() => { setEditingUser(user); setEditFullName(user.fullName); setEditEmail(user.email) }}
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
                        <button
                          onClick={() => handleGenerateBotToken(user)}
                          disabled={botTokenLoading === user.id}
                          title="Telegram bot token yaratish"
                          className="p-1.5 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors text-gray-400 disabled:opacity-50"
                        >
                          {botTokenLoading === user.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Link className="w-4 h-4" />}
                        </button>
                        {user.botLink && (
                          <button
                            onClick={() => handleUnlinkBot(user)}
                            title="Telegram bog'lanishini uzish (notanish qurilma bo'lsa)"
                            className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400"
                          >
                            <Unlink className="w-4 h-4" />
                          </button>
                        )}
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Login — email yoki telefon <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@misol.uz yoki 901234567"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">Xodim shu login bilan tizimga kiradi</p>
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
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'inspector' | 'supervisor' }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="inspector">Inspektor — to'lov yig'adi</option>
                  <option value="supervisor">Boshliq — faqat kuzatadi (o'z tumani)</option>
                  <option value="admin">Admin — to'liq nazorat</option>
                </select>
                {form.role === 'supervisor' && (
                  <p className="text-xs text-amber-600 mt-1">
                    👁 Boshliq o'z tumanidagi inspektorlar faoliyatini kuzatadi, lekin to'lov/o'zgartirish qila olmaydi. Tuman biriktiring.
                  </p>
                )}
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

      {/* Bot token modal */}
      {botToken && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setBotToken(null)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-800">Bot ulash tokeni</h3>
                <p className="text-xs text-gray-500 mt-0.5">{botToken.userName}</p>
              </div>
              <button onClick={() => setBotToken(null)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {botToken.deepLink ? (
                <>
                  <p className="text-sm text-gray-600">
                    Quyidagi havolani xodimga yuboring. U bosib <b>"Start"</b> tugmasini bossa —
                    bot avtomatik ulanadi (token qo'lda kiritish shart emas).
                  </p>
                  <a
                    href={botToken.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
                  >
                    📱 Telegram'da ochish va ulash
                  </a>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(botToken.deepLink!)
                      toast.success('Havola nusxalandi!')
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    Havoladan nusxa olish
                  </button>
                  <p className="text-xs text-gray-400 text-center">Havola 24 soat amal qiladi · bir marta ishlatiladi</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
                    ⚠️ Bot hozir ulanmagan (token sozlanmagan). Token bilan qo'lda ulash:
                  </p>
                  <div className="bg-gray-50 rounded-lg p-3 font-mono text-center">
                    <p className="text-xs text-gray-500 mb-1">Botga /start TOKEN yuboring</p>
                    <p className="text-lg font-bold text-indigo-700 tracking-widest">{botToken.token}</p>
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(`/start ${botToken.token}`); toast.success('Nusxa olindi!') }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Copy className="w-4 h-4" /> /start {botToken.token}
                  </button>
                </>
              )}
            </div>
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

      {/* FullName tahrirlash modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Foydalanuvchini tahrirlash</h3>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Ism Familiya</label>
              <input
                type="text"
                value={editFullName}
                onChange={e => setEditFullName(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Login (email yoki telefon)</label>
              <input
                type="text"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="email@misol.uz yoki 901234567"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">Inspektor shu login bilan kiradi. Xato bo'lsa shu yerda tuzating.</p>
            </div>
            <p className="text-xs text-gray-400">Parolni "🔑" tugmasi orqali, rolni qayta yaratishda o'zgartiring.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingUser(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Bekor</button>
              <button
                onClick={handleEditSave}
                disabled={editSaving || !editFullName.trim() || !editEmail.trim()}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
