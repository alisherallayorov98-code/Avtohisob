import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, Plus, Trash2, ToggleLeft, ToggleRight, X, Percent } from 'lucide-react'
import api from '../../lib/api'
import toast from 'react-hot-toast'
import ConfirmDialog from '../../components/ui/ConfirmDialog'

interface PromoCode {
  id: string
  code: string
  discountPercent: number
  maxUses: number | null
  usedCount: number
  expiresAt: string | null
  isActive: boolean
  description: string | null
  createdAt: string
}

export default function AdminPromoCodes() {
  const qc = useQueryClient()
  const [addModal, setAddModal] = useState(false)
  const [form, setForm] = useState({ code: '', discountPercent: '', maxUses: '', expiresAt: '', description: '' })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<PromoCode[]>({
    queryKey: ['admin-promo-codes'],
    queryFn: () => api.get('/admin/promo-codes').then(r => r.data.data),
  })

  const createMut = useMutation({
    mutationFn: () => api.post('/admin/promo-codes', { ...form, code: form.code.toUpperCase() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-promo-codes'] }); setAddModal(false); setForm({ code: '', discountPercent: '', maxUses: '', expiresAt: '', description: '' }); toast.success('Promo kod yaratildi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/admin/promo-codes/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-promo-codes'] }),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/promo-codes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-promo-codes'] }); toast.success("O'chirildi") },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xatolik'),
  })

  const codes = data || []
  const activeCount = codes.filter(c => c.isActive).length
  const totalUsed = codes.reduce((s, c) => s + c.usedCount, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Tag className="w-5 h-5 text-red-500" /> Promo Kodlar
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Chegirma kodlarini boshqaring</p>
        </div>
        <button onClick={() => setAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Yangi kod
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Jami kodlar', value: codes.length },
          { label: 'Faol kodlar', value: activeCount },
          { label: 'Jami ishlatilgan', value: totalUsed },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs">{s.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : codes.length === 0 ? (
          <div className="py-16 text-center">
            <Tag className="w-10 h-10 mx-auto mb-3 text-gray-700" />
            <p className="text-gray-500">Hali promo kodlar yo'q</p>
            <button onClick={() => setAddModal(true)} className="mt-3 text-red-500 text-sm hover:text-red-400">Birinchi kodni yarating</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Kod', 'Chegirma', 'Ishlatilgan', 'Tugash sanasi', 'Tavsif', 'Holat', 'Amallar'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {codes.map(code => {
                  const isExpired = code.expiresAt && new Date(code.expiresAt) < new Date()
                  const isFull = code.maxUses !== null && code.usedCount >= code.maxUses
                  return (
                    <tr key={code.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-white tracking-widest bg-gray-800 px-2 py-1 rounded text-sm">
                          {code.code}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-green-400 font-bold">
                          <Percent className="w-3.5 h-3.5" />
                          {code.discountPercent}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-300">
                          {code.usedCount}
                          {code.maxUses !== null && (
                            <span className="text-gray-600"> / {code.maxUses}</span>
                          )}
                          {code.maxUses === null && <span className="text-gray-600"> / ∞</span>}
                        </div>
                        {code.maxUses !== null && (
                          <div className="w-16 h-1 bg-gray-800 rounded-full mt-1">
                            <div className="h-1 bg-red-500 rounded-full" style={{ width: `${Math.min(100, (code.usedCount / code.maxUses) * 100)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {code.expiresAt ? (
                          <span className={isExpired ? 'text-red-400 text-xs' : 'text-gray-400 text-xs'}>
                            {new Date(code.expiresAt).toLocaleDateString('uz-UZ')}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">Cheksiz</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[150px] truncate">
                        {code.description || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {isExpired || isFull ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-500">
                            {isExpired ? 'Muddati o\'tgan' : 'To\'ldi'}
                          </span>
                        ) : code.isActive ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400">Faol</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-500">Nofaol</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleMut.mutate({ id: code.id, isActive: !code.isActive })}
                            className="text-gray-500 hover:text-white transition-colors" title={code.isActive ? 'O\'chirish' : 'Yoqish'}>
                            {code.isActive ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5" />}
                          </button>
                          <button onClick={() => setDeleteConfirmId(code.id)}
                            className="text-gray-600 hover:text-red-400 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h2 className="font-bold text-white">Yangi promo kod</h2>
              <button onClick={() => setAddModal(false)} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Kod *</label>
                <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="WELCOME20"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white font-mono uppercase placeholder-gray-600 focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Chegirma foizi (%) *</label>
                <input type="number" min="1" max="100" value={form.discountPercent} onChange={e => setForm(f => ({ ...f, discountPercent: e.target.value }))}
                  placeholder="20"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-red-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Maks. foydalanish</label>
                  <input type="number" min="1" value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                    placeholder="100 (bo'sh = cheksiz)"
                    className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Tugash sanasi</label>
                  <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider">Tavsif</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Yangi foydalanuvchilar uchun..."
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-red-500" />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-800">
              <button onClick={() => setAddModal(false)} className="flex-1 py-2.5 border border-gray-700 text-gray-400 rounded-lg text-sm hover:text-white transition-colors">
                Bekor qilish
              </button>
              <button onClick={() => createMut.mutate()} disabled={!form.code || !form.discountPercent || createMut.isPending}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                {createMut.isPending ? 'Yaratilmoqda...' : 'Yaratish'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Promo kodni o'chirish"
        message={`Bu promo kodni o'chirishni tasdiqlaysizmi?`}
        confirmLabel="Ha, o'chirish"
        loading={deleteMut.isPending}
        onConfirm={() => { deleteMut.mutate(deleteConfirmId!); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
