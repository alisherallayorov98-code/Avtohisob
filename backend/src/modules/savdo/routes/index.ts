import { Router } from 'express'
import multer from 'multer'
import { requireSavdoAuth, requireSavdoAdmin } from '../middleware/savdoAuth'
import { authLimiter } from '../../../middleware/rateLimiter'

import { login, me } from '../controllers/auth'
import { listWarehouses, listWarehouseOptions, createWarehouse, updateWarehouse } from '../controllers/warehouses'
import { listProducts, listProductOptions, createProduct, updateProduct, exportProductsXlsx } from '../controllers/products'
import { listSuppliers, listSupplierOptions, createSupplier, updateSupplier } from '../controllers/suppliers'
import { listPurchases, createPurchase, exportPurchasesXlsx } from '../controllers/purchases'
import { listStock, exportStockXlsx } from '../controllers/stock'
import { listCustomers, listCustomerOptions, createCustomer, updateCustomer } from '../controllers/customers'
import { listSales, getSale, createSaleHandler, createPosSaleHandler, exportSalesXlsx } from '../controllers/sales'
import { listPayments, createPayment, getCustomerDebtHandler, exportPaymentsXlsx } from '../controllers/payments'
import { getCurrentSmena, listSmenas, openSmena, closeSmena } from '../controllers/kassaSmena'
import { getDashboard } from '../controllers/dashboard'
import {
  getReport, exportReportXlsx, previewCount, confirmCount, listCounts, getCount,
} from '../controllers/inventory'
import { getSettings, updateSettings } from '../controllers/settings'
import { printSaleInvoice } from '../controllers/receiptPrint'
import {
  listUsers, createUser, updateUser, resetPassword, deactivateUser,
} from '../controllers/users'

const router = Router()

// Inventarizatsiya Excel yuklash — fayl xotirada saqlanadi, 10 MB gacha
const inventoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', authLimiter, login)
router.get('/auth/me', requireSavdoAuth, me)

// ── Warehouses ────────────────────────────────────────────────────────────────
const warehousesRouter = Router()
warehousesRouter.get('/options', listWarehouseOptions)
warehousesRouter.get('/', listWarehouses)
warehousesRouter.post('/', requireSavdoAdmin, createWarehouse)
warehousesRouter.put('/:id', requireSavdoAdmin, updateWarehouse)
router.use('/warehouses', requireSavdoAuth, warehousesRouter)

// ── Products (katalog) ────────────────────────────────────────────────────────
const productsRouter = Router()
productsRouter.get('/options', listProductOptions)
productsRouter.get('/export.xlsx', exportProductsXlsx)
productsRouter.get('/', listProducts)
productsRouter.post('/', requireSavdoAdmin, createProduct)
productsRouter.put('/:id', requireSavdoAdmin, updateProduct)
router.use('/products', requireSavdoAuth, productsRouter)

// ── Suppliers ─────────────────────────────────────────────────────────────────
const suppliersRouter = Router()
suppliersRouter.get('/options', listSupplierOptions)
suppliersRouter.get('/', listSuppliers)
suppliersRouter.post('/', requireSavdoAdmin, createSupplier)
suppliersRouter.put('/:id', requireSavdoAdmin, updateSupplier)
router.use('/suppliers', requireSavdoAuth, suppliersRouter)

// ── Purchases (kirim) ─────────────────────────────────────────────────────────
const purchasesRouter = Router()
purchasesRouter.get('/export.xlsx', exportPurchasesXlsx)
purchasesRouter.get('/', listPurchases)
purchasesRouter.post('/', createPurchase)
router.use('/purchases', requireSavdoAuth, purchasesRouter)

// ── Stock (qoldiq) ────────────────────────────────────────────────────────────
const stockRouter = Router()
stockRouter.get('/export.xlsx', exportStockXlsx)
stockRouter.get('/', listStock)
router.use('/stock', requireSavdoAuth, stockRouter)

// ── Customers (mijozlar) ───────────────────────────────────────────────────────
const customersRouter = Router()
customersRouter.get('/options', listCustomerOptions)
customersRouter.get('/', listCustomers)
customersRouter.post('/', createCustomer)
customersRouter.put('/:id', updateCustomer)
router.use('/customers', requireSavdoAuth, customersRouter)

// ── Sales (savdo/faktura) ────────────────────────────────────────────────────
const salesRouter = Router()
// ':id' dan OLDIN — aks holda "export.xlsx" sotuv id sifatida qabul qilinadi
salesRouter.get('/export.xlsx', exportSalesXlsx)
salesRouter.get('/', listSales)
salesRouter.get('/:id', getSale)
salesRouter.get('/:id/print', printSaleInvoice)
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
paymentsRouter.get('/export.xlsx', exportPaymentsXlsx)
paymentsRouter.get('/', listPayments)
paymentsRouter.post('/', createPayment)
paymentsRouter.get('/customer/:customerId/debt', getCustomerDebtHandler)
router.use('/payments', requireSavdoAuth, paymentsRouter)

// ── Dashboard / hisobot ────────────────────────────────────────────────────────
router.get('/dashboard', requireSavdoAuth, getDashboard)

// ── Inventarizatsiya ──────────────────────────────────────────────────────────
const inventoryRouter = Router()
inventoryRouter.get('/report', getReport)
inventoryRouter.get('/report/export.xlsx', exportReportXlsx)
inventoryRouter.post('/count/preview', inventoryUpload.single('file'), previewCount)
inventoryRouter.post('/count/confirm', confirmCount)
inventoryRouter.get('/counts', listCounts)
inventoryRouter.get('/counts/:id', getCount)
router.use('/inventory', requireSavdoAuth, inventoryRouter)

// ── Sozlamalar (hisob-faktura rekvizitlari) — faqat admin ─────────────────────
const settingsRouter = Router()
settingsRouter.get('/', getSettings)
settingsRouter.put('/', updateSettings)
router.use('/settings', requireSavdoAuth, requireSavdoAdmin, settingsRouter)

// ── Xodimlar (Savdo'ning o'z mustaqil login/paroli) — faqat admin ────────────
const usersRouter = Router()
usersRouter.get('/', listUsers)
usersRouter.post('/', createUser)
usersRouter.put('/:id', updateUser)
usersRouter.put('/:id/password', resetPassword)
usersRouter.delete('/:id', deactivateUser)
router.use('/users', requireSavdoAuth, requireSavdoAdmin, usersRouter)

export default router
