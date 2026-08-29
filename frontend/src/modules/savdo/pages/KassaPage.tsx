import { useState, useEffect, useCallback } from 'react'
import { Loader2, ShoppingCart, Trash2, Lock, Unlock, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import SearchSelect from '../ui/SearchSelect'
import QuickAddCustomer from '../ui/QuickAddCustomer'

interface Option { id: string; name: string }
interface Product extends Option { sku: string; retailPrice: string; wholesalePrice: string; unit: string }
interface Customer extends Option { phone: string | null; priceTier: 'retail' | 'wholesale' }
interface Smena {
  id: string
  openingBalance: string
  status: 'open' | 'closed'
  openedAt: string
}
interface CartLine { productId: string; name: string; unitPrice: number; quantity: number }

export default function KassaPage() {
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [smena, setSmena] = useState<Smena | null | undefined>(undefined)
  const [openingBalance, setOpeningBalance] = useState('')
  const [closingBalance, setClosingBalance] = useState('')
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<any>(null)

  useEffect(() => {
    savdoApi.get('/warehouses/options').then(res => {
      const list = res.data.data ?? []
      setWarehouses(list)
      if (list.length > 0) setWarehouseId(list[0].id)
    }).catch(() => {})
    savdoApi.get('/products/options').then(res => setProducts(res.data.data ?? [])).catch(() => {})
    savdoApi.get('/customers/options').then(res => setCustomers(res.data.data ?? [])).catch(() => {})
  }, [])

  const fetchSmena = useCallback(() => {
    if (!warehouseId) return
    savdoApi.get('/kassa-smena/current', { params: { warehouseId } })
      .then(res => setSmena(res.data.data))
      .catch(() => toast.error('Smenani yuklab bo\'lmadi'))
  }, [warehouseId])

  useEffect(() => { fetchSmena() }, [fetchSmena])

  // Tanlangan mijozning narx toifasi (optom/chakana) — savat va checkout
  // shu bilan hisoblanadi, backend'ning resolveUnitPrice bilan bir xil bo'lishi
  // uchun (aks holda kassir ekranda ko'rgan summa serverga yozilgan summadan farq qilardi).
  const priceForProduct = useCallback((product: Product): number => {
    const customer = customers.find(c => c.id === customerId)
    return customer?.priceTier === 'wholesale' ? Number(product.wholesalePrice) : Number(product.retailPrice)
  }, [customers, customerId])

  // Mijoz o'zgarganda savatdagi mavjud qatorlar narxi ham qayta hisoblanadi
  useEffect(() => {
    setCart(c => c.map(line => {
      const product = products.find(p => p.id === line.productId)
      return product ? { ...line, unitPrice: priceForProduct(product) } : line
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  function handleCustomerCreated(customer: Customer) {
    setCustomers(cs => [...cs, customer])
    setCustomerId(customer.id)
    setShowQuickAddCustomer(false)
  }

  async function handleOpenSmena(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await savdoApi.post('/kassa-smena/open', { warehouseId, openingBalance: Number(openingBalance) || 0 })
      toast.success('Smena ochildi')
      setOpeningBalance('')
      fetchSmena()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setLoading(false)
    }
  }

  async function handleCloseSmena(e: React.FormEvent) {
    e.preventDefault()
    if (!smena) return
    if (!closingBalance) { toast.error('Yopilish balansini kiriting'); return }
    setLoading(true)
    try {
      const res = await savdoApi.post(`/kassa-smena/${smena.id}/close`, { closingBalance: Number(closingBalance) })
      const d = res.data.data
      toast.success(`Smena yopildi. Kutilgan: ${Number(d.expectedBalance).toLocaleString()}, farq: ${Number(d.discrepancy).toLocaleString()}`)
      setClosingBalance(''); setShowCloseForm(false); setCart([])
      fetchSmena()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setLoading(false)
    }
  }

  function addToCart(productId: string) {
    const product = products.find(p => p.id === productId)
    if (!product) return
    setCart(c => {
      const existing = c.find(l => l.productId === product.id)
      if (existing) {
        return c.map(l => l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l)
      }
      return [...c, { productId: product.id, name: product.name, unitPrice: priceForProduct(product), quantity: 1 }]
    })
    setSelectedProductId('')
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) { setCart(c => c.filter(l => l.productId !== productId)); return }
    setCart(c => c.map(l => l.productId === productId ? { ...l, quantity: qty } : l))
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)

  async function handleCheckout() {
    if (cart.length === 0) return
    setLoading(true)
    try {
      const res = await savdoApi.post('/sales/pos', {
        warehouseId,
        customerId: customerId || null,
        lines: cart.map(l => ({ productId: l.productId, quantity: l.quantity })),
      })
      toast.success(res.data.message || 'Sotuv yakunlandi')
      setLastReceipt(res.data.data)
      setCart([]); setCustomerId('')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setLoading(false)
    }
  }

  async function handlePrintReceipt() {
    if (!lastReceipt?.id) return
    try {
      const res = await savdoApi.get(`/sales/${lastReceipt.id}/print`, { responseType: 'text' })
      const win = window.open('', '_blank')
      if (win) { win.document.open(); win.document.write(res.data); win.document.close() }
    } catch {
      toast.error('Chekni ochib bo\'lmadi')
    }
  }

  if (smena === undefined) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Kassa</h1>
          <p className="text-sm text-gray-500">Tezkor sotish — smena ochilgach faollashadi</p>
        </div>
        {warehouses.length > 1 && (
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {!smena ? (
        <form onSubmit={handleOpenSmena} className="max-w-sm p-5 bg-white border border-gray-200 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-gray-700 mb-1">
            <Unlock className="w-4 h-4" /> <span className="font-medium text-sm">Smenani ochish</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ochilish balansi (naqd)</label>
            <input type="number" min="0" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          </div>
          <button type="submit" disabled={loading || !warehouseId} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Smenani ochish'}
          </button>
        </form>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            <span>Smena ochiq — {new Date(smena.openedAt).toLocaleString('uz-UZ')} · Ochilish: {Number(smena.openingBalance).toLocaleString()}</span>
            <button onClick={() => setShowCloseForm(v => !v)} className="flex items-center gap-1.5 text-red-700 hover:text-red-800 font-medium">
              <Lock className="w-4 h-4" /> Smenani yopish
            </button>
          </div>

          {showCloseForm && (
            <form onSubmit={handleCloseSmena} className="mb-5 p-4 bg-white border border-gray-200 rounded-xl flex items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Yopilish balansi (naqd, qo'lda sanalgan)</label>
                <input type="number" min="0" value={closingBalance} onChange={e => setClosingBalance(e.target.value)} className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <button type="submit" disabled={loading} className="px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                Yopish va hisoblash
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex gap-2 mb-4">
                <SearchSelect
                  className="flex-1"
                  options={products.map(p => ({ id: p.id, label: p.name, sublabel: `${p.sku} · ${priceForProduct(p).toLocaleString()}` }))}
                  value={selectedProductId}
                  onChange={id => { setSelectedProductId(id); addToCart(id) }}
                  placeholder="Mahsulot tanlang yoki qidiring..."
                />
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-400">
                  <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  Savat bo'sh — mahsulot tanlang
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map(l => (
                    <div key={l.productId} className="flex items-center gap-3 p-2 border border-gray-100 rounded-lg">
                      <span className="flex-1 text-sm font-medium text-gray-800">{l.name}</span>
                      <input
                        type="number" min="1" value={l.quantity}
                        onChange={e => updateQty(l.productId, Number(e.target.value))}
                        className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                      />
                      <span className="w-24 text-right savdo-num text-sm">{(l.unitPrice * l.quantity).toLocaleString()}</span>
                      <button onClick={() => updateQty(l.productId, 0)} className="text-gray-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
              <label className="block text-xs font-medium text-gray-600 mb-1">Mijoz (ixtiyoriy)</label>
              <SearchSelect
                options={customers.map(c => ({ id: c.id, label: c.name, sublabel: c.phone || undefined }))}
                value={customerId}
                onChange={setCustomerId}
                placeholder="Ko'chadan mijoz"
                extraAction={{ label: 'Yangi mijoz qo\'shish', onClick: () => setShowQuickAddCustomer(true) }}
              />
              {showQuickAddCustomer && (
                <QuickAddCustomer onCreated={handleCustomerCreated} onCancel={() => setShowQuickAddCustomer(false)} />
              )}

              <div className="flex items-center justify-between text-sm my-4">
                <span className="text-gray-500">Jami</span>
                <span className="text-xl font-semibold text-gray-800 savdo-num">{cartTotal.toLocaleString()}</span>
              </div>

              <button
                onClick={handleCheckout}
                disabled={cart.length === 0 || loading}
                className="w-full py-2.5 bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Sotuvni yakunlash (naqd)'}
              </button>

              {lastReceipt && (
                <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
                  <div className="flex items-center justify-between">
                    <span>Oxirgi chek: {lastReceipt.documentNumber}</span>
                    <button onClick={handlePrintReceipt} className="flex items-center gap-1 text-amber-700 hover:text-amber-800">
                      <Printer className="w-3.5 h-3.5" /> Chop etish
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
