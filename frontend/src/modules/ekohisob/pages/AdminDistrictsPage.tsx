import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Loader2, MapPin, Home } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

interface District {
  id: string
  name: string
}

interface Mahalla {
  id: string
  name: string
  districtId: string
}

export default function AdminDistrictsPage() {
  const [districts, setDistricts] = useState<District[]>([])
  const [mahallas, setMahallas] = useState<Mahalla[]>([])
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mahallasLoading, setMahallasLoading] = useState(false)
  const [newDistrictName, setNewDistrictName] = useState('')
  const [newMahallaName, setNewMahallaName] = useState('')
  const [addingDistrict, setAddingDistrict] = useState(false)
  const [addingMahalla, setAddingMahalla] = useState(false)
  const [editingDistrictId, setEditingDistrictId] = useState<string | null>(null)
  const [editingDistrictName, setEditingDistrictName] = useState('')
  const [editingMahallaId, setEditingMahallaId] = useState<string | null>(null)
  const [editingMahallaName, setEditingMahallaName] = useState('')

  const fetchDistricts = useCallback(() => {
    setLoading(true)
    ekoApi.get('/districts')
      .then(res => {
        const data = res.data.data ?? res.data
        setDistricts(Array.isArray(data) ? data : [])
      })
      .catch(() => setDistricts([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchDistricts() }, [fetchDistricts])

  useEffect(() => {
    if (!selectedDistrictId) { setMahallas([]); return }
    setMahallasLoading(true)
    ekoApi.get(`/mahallas?districtId=${selectedDistrictId}`)
      .then(res => {
        const data = res.data.data ?? res.data
        setMahallas(Array.isArray(data) ? data : [])
      })
      .catch(() => setMahallas([]))
      .finally(() => setMahallasLoading(false))
  }, [selectedDistrictId])

  async function handleAddDistrict(e: React.FormEvent) {
    e.preventDefault()
    if (!newDistrictName.trim()) return
    setAddingDistrict(true)
    try {
      await ekoApi.post('/districts', { name: newDistrictName.trim() })
      toast.success("Tuman qo'shildi")
      setNewDistrictName('')
      fetchDistricts()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Xato yuz berdi'
      toast.error(msg)
    } finally {
      setAddingDistrict(false)
    }
  }

  async function handleAddMahalla(e: React.FormEvent) {
    e.preventDefault()
    if (!newMahallaName.trim() || !selectedDistrictId) return
    setAddingMahalla(true)
    try {
      await ekoApi.post('/mahallas', { name: newMahallaName.trim(), districtId: selectedDistrictId })
      toast.success("Mahalla qo'shildi")
      setNewMahallaName('')
      // Refresh mahallas
      const res = await ekoApi.get(`/mahallas?districtId=${selectedDistrictId}`)
      const data = res.data.data ?? res.data
      setMahallas(Array.isArray(data) ? data : [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Xato yuz berdi'
      toast.error(msg)
    } finally {
      setAddingMahalla(false)
    }
  }

  async function saveEditDistrict(id: string) {
    const name = editingDistrictName.trim()
    if (!name) return
    try {
      await ekoApi.patch(`/districts/${id}`, { name })
      toast.success('Nomi yangilandi')
      setEditingDistrictId(null)
      fetchDistricts()
    } catch { toast.error('Xato yuz berdi') }
  }

  async function handleDeleteDistrict(district: District) {
    if (!window.confirm(`"${district.name}" tumanini o'chirasizmi? Barcha mahallalar ham o'chadi!`)) return
    try {
      await ekoApi.delete(`/districts/${district.id}`)
      toast.success("O'chirildi")
      if (selectedDistrictId === district.id) setSelectedDistrictId(null)
      fetchDistricts()
    } catch {
      toast.error("O'chirib bo'lmadi")
    }
  }

  async function saveEditMahalla(id: string) {
    const name = editingMahallaName.trim()
    if (!name) return
    try {
      await ekoApi.patch(`/mahallas/${id}`, { name })
      toast.success('Nomi yangilandi')
      setEditingMahallaId(null)
      const res = await ekoApi.get(`/mahallas?districtId=${selectedDistrictId}`)
      const data = res.data.data ?? res.data
      setMahallas(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Xato yuz berdi')
    }
  }

  async function handleDeleteMahalla(mahalla: Mahalla) {
    if (!window.confirm(`"${mahalla.name}" mahallasini o'chirasizmi?`)) return
    try {
      await ekoApi.delete(`/mahallas/${mahalla.id}`)
      toast.success("O'chirildi")
      setMahallas(prev => prev.filter(m => m.id !== mahalla.id))
    } catch {
      toast.error("O'chirib bo'lmadi")
    }
  }

  const selectedDistrict = districts.find(d => d.id === selectedDistrictId)

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <h1 className="text-lg font-bold text-gray-900 mb-5">Tumanlar va mahallalar</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Districts column */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-green-600" />
              <h2 className="font-semibold text-gray-800">Tumanlar</h2>
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{districts.length}</span>
            </div>
          </div>

          {/* Add district form */}
          <form onSubmit={handleAddDistrict} className="flex gap-2 px-4 py-3 border-b border-gray-50">
            <input
              type="text"
              value={newDistrictName}
              onChange={e => setNewDistrictName(e.target.value)}
              placeholder="Tuman nomi..."
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              type="submit"
              disabled={addingDistrict || !newDistrictName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {addingDistrict ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Qo'shish
            </button>
          </form>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : districts.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">
              Tumanlar yo'q
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {districts.map(district => (
                <div key={district.id} className={`border-l-2 transition-colors ${selectedDistrictId === district.id ? 'border-green-500 bg-green-50' : 'border-transparent hover:bg-gray-50'}`}>
                  {editingDistrictId === district.id ? (
                    <div className="flex items-center gap-2 px-3 py-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={editingDistrictName}
                        onChange={e => setEditingDistrictName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEditDistrict(district.id); if (e.key === 'Escape') setEditingDistrictId(null) }}
                        className="flex-1 px-2 py-1 text-sm border border-green-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-500"
                      />
                      <button onClick={() => saveEditDistrict(district.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded-lg">✓</button>
                      <button onClick={() => setEditingDistrictId(null)} className="px-2 py-1 text-xs border border-gray-200 rounded-lg">✕</button>
                    </div>
                  ) : (
                    <div
                      onClick={() => setSelectedDistrictId(district.id === selectedDistrictId ? null : district.id)}
                      className="flex items-center justify-between px-5 py-3 cursor-pointer group"
                    >
                      <span className="text-sm font-medium text-gray-800">{district.name}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); setEditingDistrictId(district.id); setEditingDistrictName(district.name) }}
                          className="p-1.5 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors text-gray-400">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDeleteDistrict(district) }}
                          className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mahallas column */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-green-600" />
              <h2 className="font-semibold text-gray-800">
                {selectedDistrict ? `${selectedDistrict.name} mahallalari` : 'Mahallalar'}
              </h2>
              {selectedDistrict && (
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{mahallas.length}</span>
              )}
            </div>
          </div>

          {!selectedDistrictId ? (
            <div className="py-12 text-center">
              <MapPin className="w-10 h-10 text-gray-200 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Mahallalarni ko'rish uchun tuman tanlang</p>
            </div>
          ) : (
            <>
              {/* Add mahalla form */}
              <form onSubmit={handleAddMahalla} className="flex gap-2 px-4 py-3 border-b border-gray-50">
                <input
                  type="text"
                  value={newMahallaName}
                  onChange={e => setNewMahallaName(e.target.value)}
                  placeholder="Mahalla nomi..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="submit"
                  disabled={addingMahalla || !newMahallaName.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {addingMahalla ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Qo'shish
                </button>
              </form>

              {mahallasLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : mahallas.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">
                  Bu tumanda mahallalar yo'q
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {mahallas.map(mahalla => (
                    <div key={mahalla.id} className="hover:bg-gray-50 transition-colors">
                      {editingMahallaId === mahalla.id ? (
                        <div className="flex items-center gap-2 px-3 py-2">
                          <input
                            autoFocus
                            value={editingMahallaName}
                            onChange={e => setEditingMahallaName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEditMahalla(mahalla.id); if (e.key === 'Escape') setEditingMahallaId(null) }}
                            className="flex-1 px-2 py-1 text-sm border border-green-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                          <button onClick={() => saveEditMahalla(mahalla.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded-lg">✓</button>
                          <button onClick={() => setEditingMahallaId(null)} className="px-2 py-1 text-xs border border-gray-200 rounded-lg">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between px-5 py-3 group">
                          <span className="text-sm text-gray-800">{mahalla.name}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingMahallaId(mahalla.id); setEditingMahallaName(mahalla.name) }}
                              className="p-1.5 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors text-gray-400">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteMahalla(mahalla)}
                              className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
