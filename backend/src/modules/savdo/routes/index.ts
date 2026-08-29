import { Router } from 'express'
import { requireSavdoAuth, requireSavdoAdmin } from '../middleware/savdoAuth'
import { authLimiter } from '../../../middleware/rateLimiter'

import { login, me } from '../controllers/auth'
import { listWarehouses, createWarehouse, updateWarehouse } from '../controllers/warehouses'
import { listProducts, createProduct, updateProduct } from '../controllers/products'
import { listSuppliers, createSupplier, updateSupplier } from '../controllers/suppliers'
import { listPurchases, createPurchase } from '../controllers/purchases'
import { listStock } from '../controllers/stock'
import { listCustomers, createCustomer, updateCustomer } from '../controllers/customers'
import { listSales, getSale, createSaleHandler, createPosSaleHandler } from '../controllers/sales'
import { listPayments, createPayment, getCustomerDebtHandler } from '../controllers/payments'
import { getCurrentSmena, listSmenas, openSmena, closeSmena } from '../controllers/kassaSmena'
import { getDashboard } from '../controllers/dashboard'

const router = Router()

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', authLimiter, login)
router.get('/auth/me', requireSavdoAuth, me)

// ── Warehouses ────────────────────────────────────────────────────────────────
const warehousesRouter = Router()
warehousesRouter.get('/', listWarehouses)
warehousesRouter.post('/', requireSavdoAdmin, createWarehouse)
warehousesRouter.put('/:id', requireSavdoAdmin, updateWarehouse)
router.use('/warehouses', requireSavdoAuth, warehousesRouter)

// ── Products (katalog) ────────────────────────────────────────────────────────
const productsRouter = Router()
productsRouter.get('/', listProducts)
productsRouter.post('/', requireSavdoAdmin, createProduct)
productsRouter.put('/:id', requireSavdoAdmin, updateProduct)
router.use('/products', requireSavdoAuth, productsRouter)

// ── Suppliers ─────────────────────────────────────────────────────────────────
const suppliersRouter = Router()
suppliersRouter.get('/', listSuppliers)
suppliersRouter.post('/', requireSavdoAdmin, createSupplier)
suppliersRouter.put('/:id', requireSavdoAdmin, updateSupplier)
router.use('/suppliers', requireSavdoAuth, suppliersRouter)

// ── Purchases (kirim) ─────────────────────────────────────────────────────────
const purchasesRouter = Router()
purchasesRouter.get('/', listPurchases)
purchasesRouter.post('/', createPurchase)
router.use('/purchases', requireSavdoAuth, purchasesRouter)

// ── Stock (qoldiq) ────────────────────────────────────────────────────────────
router.get('/stock', requireSavdoAuth, listStock)

// ── Customers (mijozlar) ───────────────────────────────────────────────────────
const customersRouter = Router()
customersRouter.get('/', listCustomers)
customersRouter.post('/', createCustomer)
customersRouter.put('/:id', updateCustomer)
router.use('/customers', requireSavdoAuth, customersRouter)

// ── Sales (savdo/faktura) ────────────────────────────────────────────────────
const salesRouter = Router()
salesRouter.get('/', listSales)
salesRouter.get('/:id', getSale)
salesRouter.post('/', createSaleHandler)
salesRouter.post('/pos', createPosSaleHandler)
router.use('/sales', requireSavdoAuth, salesRouter)

// ── Kassa smena (POS) ─────────────────────────────────────────────────────────
const kassaSmenaRouter = Router()
kassaSmenaRouter.get('/', listSmenas)
kassaSmenaRouter.get('/current', getCurrentSmena)
kassaSmenaRouter.post('/open', openSmena)
kassaSmenaRouter.post('/:id/close', closeSmena)
router.use('/kassa-smena', requireSavdoAuth, kassaSmenaRouter)

// ── Payments (to'lov / qarz) ──────────────────────────────────────────────────
const paymentsRouter = Router()
paymentsRouter.get('/', listPayments)
paymentsRouter.post('/', createPayment)
paymentsRouter.get('/customer/:customerId/debt', getCustomerDebtHandler)
router.use('/payments', requireSavdoAuth, paymentsRouter)

// ── Dashboard / hisobot ────────────────────────────────────────────────────────
router.get('/dashboard', requireSavdoAuth, getDashboard)

export default router
