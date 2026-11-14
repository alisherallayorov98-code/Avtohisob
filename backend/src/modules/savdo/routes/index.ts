import { Router } from 'express'
import multer from 'multer'
import { requireSavdoAuth, requireSavdoAdmin, requireSavdoPermission } from '../middleware/savdoAuth'
import { authLimiter } from '../../../middleware/rateLimiter'

import { login, me } from '../controllers/auth'
import { listWarehouses, listWarehouseOptions, createWarehouse, updateWarehouse } from '../controllers/warehouses'
import { listProducts, listProductOptions, createProduct, updateProduct, exportProductsXlsx } from '../controllers/products'
import {
  previewProductImport, confirmProductImport, downloadProductTemplateXlsx,
} from '../controllers/productImport'
import { listSuppliers, listSupplierOptions, createSupplier, updateSupplier } from '../controllers/suppliers'
import { listPurchases, createPurchase, exportPurchasesXlsx, cancelPurchase, updatePurchaseHandler } from '../controllers/purchases'
import {
  listPurchaseDocs, getPurchaseDoc, createPurchaseDocHandler, updatePurchaseDocHandler,
  cancelPurchaseDocHandler, exportPurchaseDocXlsx, printPurchaseDoc,
  saveDraftHandler, postDraftHandler, deleteDraftHandler, updateMetaHandler,
} from '../controllers/purchaseDocs'
import {
  listSpecs, getSpec, createSpecHandler, updateSpecHandler, confirmSpecHandler,
  reopenSpecHandler, cancelSpecHandler, printSpec, backfillSpecsHandler,
} from '../controllers/specs'
import {
  listOrders, getOrderHandler, createOrderHandler, updateOrderHandler, orderActionHandler, printPickList,
} from '../controllers/orders'
import { getCosting, applyCostingPrices } from '../controllers/costing'
import { listLevies, createLevy, updateLevy, setMinimumWage } from '../controllers/levies'
import {
  saveDraft, confirmDraft, removeDraft, printCountSheet, printCountAct,
} from '../controllers/inventoryDocs'
import { getPaymentTypeReport, exportPaymentTypeXlsx, getCustomerBalances } from '../controllers/reports'
import { listAudit } from '../controllers/audit'
import { numberizeQty } from '../lib/qty'
import {
  listTransfers, createTransferHandler, cancelTransferHandler, exportTransfersXlsx,
} from '../controllers/transfers'
import { listStock, exportStockXlsx } from '../controllers/stock'
import { listCustomers, listCustomerOptions, createCustomer, updateCustomer } from '../controllers/customers'
import {
  listSales, getSale, createSaleHandler, createPosSaleHandler, exportSalesXlsx, cancelSaleHandler, updateSaleHandler,
} from '../controllers/sales'
import {
  listPayments, createPayment, getCustomerDebtHandler, exportPaymentsXlsx, cancelPayment,
} from '../controllers/payments'
import {
  getCurrentSmena, listSmenas, openSmena, closeSmena, getSmenaReport, exportSmenasXlsx,
} from '../controllers/kassaSmena'
import { getDashboard } from '../controllers/dashboard'
import {
  getReport, exportReportXlsx, previewCount, confirmCount, listCounts, getCount,
} from '../controllers/inventory'
import {
  listExpenses, createExpense, updateExpense, cancelExpense, exportExpensesXlsx,
} from '../controllers/expenses'
import { listDebtorsForSms, previewSms, sendDebtorSms, listSmsLogs } from '../controllers/sms'
import { getSettings, updateSettings } from '../controllers/settings'
import { printSaleInvoice, verifySaleInvoice } from '../controllers/receiptPrint'
import {
  listUsers, createUser, updateUser, resetPassword, deactivateUser,
} from '../controllers/users'

const router = Router()

// Miqdorlar DB'da Decimal(14,3) — javobda oddiy son sifatida beriladi (frontend Number() qilmasin)
router.use((_req, res, next) => {
  const orig = res.json.bind(res)
  res.json = (body: any) => orig(numberizeQty(body))
  next()
})

// Excel yuklash (inventarizatsiya, mahsulot importi) — fayl xotirada, 10 MB gacha
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', authLimiter, login)
router.get('/auth/me', requireSavdoAuth, me)

// ── OCHIQ: hisob-faktura haqiqiyligini tekshirish ─────────────────────────────
// QR kod shu yerga olib keladi — autentifikatsiyasiz. Shaxsiy ma'lumot bermaydi
// (xaridor nomi maskalangan, mahsulot/tannarx qaytmaydi). '/sales' guruhidan
// OLDIN turishi shart, aks holda requireSavdoAuth ushlab qoladi.
router.get('/sales/verify/:number', verifySaleInvoice)

// ── Warehouses ────────────────────────────────────────────────────────────────
const warehousesRouter = Router()
warehousesRouter.get('/options', requireSavdoPermission('warehouses.view'), listWarehouseOptions)
warehousesRouter.get('/', requireSavdoPermission('warehouses.view'), listWarehouses)
warehousesRouter.post('/', requireSavdoAdmin, createWarehouse)
warehousesRouter.put('/:id', requireSavdoAdmin, updateWarehouse)
router.use('/warehouses', requireSavdoAuth, warehousesRouter)

// ── Products (katalog) ────────────────────────────────────────────────────────
const productsRouter = Router()
productsRouter.get('/options', requireSavdoPermission('products.view'), listProductOptions)
productsRouter.get('/export.xlsx', requireSavdoPermission('products.view'), exportProductsXlsx)
// Ommaviy import — faqat admin (butun katalogni bir so'rovda o'zgartiradi)
productsRouter.get('/import/template.xlsx', requireSavdoAdmin, downloadProductTemplateXlsx)
productsRouter.post('/import/preview', requireSavdoAdmin, xlsxUpload.single('file'), previewProductImport)
productsRouter.post('/import/confirm', requireSavdoAdmin, confirmProductImport)
productsRouter.get('/', requireSavdoPermission('products.view'), listProducts)
productsRouter.post('/', requireSavdoPermission('products.manage'), createProduct)
productsRouter.put('/:id', requireSavdoPermission('products.manage'), updateProduct)
router.use('/products', requireSavdoAuth, productsRouter)

// ── Suppliers ─────────────────────────────────────────────────────────────────
const suppliersRouter = Router()
suppliersRouter.get('/options', requireSavdoPermission('suppliers.view'), listSupplierOptions)
suppliersRouter.get('/', requireSavdoPermission('suppliers.view'), listSuppliers)
suppliersRouter.post('/', requireSavdoPermission('suppliers.manage'), createSupplier)
suppliersRouter.put('/:id', requireSavdoPermission('suppliers.manage'), updateSupplier)
router.use('/suppliers', requireSavdoAuth, suppliersRouter)

// ── Purchases (kirim) ─────────────────────────────────────────────────────────
const purchasesRouter = Router()
purchasesRouter.get('/export.xlsx', requireSavdoPermission('purchases.view'), exportPurchasesXlsx)
purchasesRouter.get('/', requireSavdoPermission('purchases.view'), listPurchases)
purchasesRouter.post('/', requireSavdoPermission('purchases.create'), createPurchase)
purchasesRouter.put('/:id', requireSavdoAdmin, updatePurchaseHandler)
purchasesRouter.post('/:id/cancel', requireSavdoAdmin, cancelPurchase)
router.use('/purchases', requireSavdoAuth, purchasesRouter)

// ── Kirim hujjatlari (import: ko'p qator, valyuta, xarajatlar) ───────────────
const purchaseDocsRouter = Router()
purchaseDocsRouter.get('/', requireSavdoPermission('purchases.view'), listPurchaseDocs)
purchaseDocsRouter.get('/:id', requireSavdoPermission('purchases.view'), getPurchaseDoc)
purchaseDocsRouter.get('/:id/print', requireSavdoPermission('purchases.view'), printPurchaseDoc)
purchaseDocsRouter.get('/:id/export.xlsx', requireSavdoPermission('purchases.view'), exportPurchaseDocXlsx)
purchaseDocsRouter.post('/', requireSavdoPermission('purchases.create'), createPurchaseDocHandler)
// Qoralama: yarmida to'xtab, keyin davom ettirish va kirim qilish (ombor faqat "post"da o'zgaradi)
purchaseDocsRouter.post('/draft', requireSavdoPermission('purchases.create'), saveDraftHandler)
purchaseDocsRouter.post('/:id/post', requireSavdoPermission('purchases.create'), postDraftHandler)
purchaseDocsRouter.delete('/:id/draft', requireSavdoPermission('purchases.create'), deleteDraftHandler)
// Kirim qilingan hujjat ma'lumotini tuzatish (tovar sotilgan bo'lsa ham) — faqat admin
purchaseDocsRouter.put('/:id/meta', requireSavdoAdmin, updateMetaHandler)
purchaseDocsRouter.put('/:id', requireSavdoAdmin, updatePurchaseDocHandler)
purchaseDocsRouter.post('/:id/cancel', requireSavdoAdmin, cancelPurchaseDocHandler)
router.use('/purchase-docs', requireSavdoAuth, purchaseDocsRouter)

// ── Spetsifikatsiya (yuridik shaxslarga sotish) ───────────────────────────────
const specsRouter = Router()
specsRouter.get('/', requireSavdoPermission('sales.view'), listSpecs)
specsRouter.post('/backfill', requireSavdoAdmin, backfillSpecsHandler)
specsRouter.get('/:id', requireSavdoPermission('sales.view'), getSpec)
specsRouter.get('/:id/print', requireSavdoPermission('sales.view'), printSpec)
specsRouter.post('/', requireSavdoPermission('sales.create'), createSpecHandler)
specsRouter.put('/:id', requireSavdoPermission('sales.create'), updateSpecHandler)
specsRouter.post('/:id/confirm', requireSavdoPermission('sales.create'), confirmSpecHandler)
specsRouter.post('/:id/cancel', requireSavdoPermission('sales.create'), cancelSpecHandler)
specsRouter.post('/:id/reopen', requireSavdoAdmin, reopenSpecHandler)
router.use('/specs', requireSavdoAuth, specsRouter)

// ── Zakaz (buyurtma) → yig'ish → sotuv ───────────────────────────────────────
const ordersRouter = Router()
ordersRouter.get('/', requireSavdoPermission('sales.view'), listOrders)
ordersRouter.get('/:id', requireSavdoPermission('sales.view'), getOrderHandler)
ordersRouter.get('/:id/print', requireSavdoPermission('sales.view'), printPickList)
ordersRouter.post('/', requireSavdoPermission('sales.create'), createOrderHandler)
ordersRouter.put('/:id', requireSavdoPermission('sales.create'), updateOrderHandler)
ordersRouter.post('/:id/:action', requireSavdoPermission('sales.create'), orderActionHandler)
router.use('/orders', requireSavdoAuth, ordersRouter)

// ── Yig'im turlari (utilizatsiya) va eng kam oylik ish haqi ──────────────────
const leviesRouter = Router()
leviesRouter.get('/', requireSavdoPermission('purchases.view'), listLevies)
leviesRouter.put('/min-wage', requireSavdoAdmin, setMinimumWage)
leviesRouter.post('/', requireSavdoAdmin, createLevy)
leviesRouter.put('/:id', requireSavdoAdmin, updateLevy)
router.use('/levies', requireSavdoAuth, leviesRouter)

// ── Audit jurnali (faqat admin ko'radi) ───────────────────────────────────────
router.get('/audit', requireSavdoAuth, requireSavdoAdmin, listAudit)

// ── Tannarx va narx kalkulyatori ──────────────────────────────────────────────
const costingRouter = Router()
costingRouter.get('/', requireSavdoPermission('cost.view'), getCosting)
costingRouter.post('/apply', requireSavdoPermission('products.manage'), applyCostingPrices)
router.use('/costing', requireSavdoAuth, costingRouter)

// ── Transfers (omborlararo ko'chirish) ────────────────────────────────────────
const transfersRouter = Router()
transfersRouter.get('/export.xlsx', requireSavdoPermission('transfers.view'), exportTransfersXlsx)
transfersRouter.get('/', requireSavdoPermission('transfers.view'), listTransfers)
transfersRouter.post('/', requireSavdoPermission('transfers.create'), createTransferHandler)
transfersRouter.post('/:id/cancel', requireSavdoAdmin, cancelTransferHandler)
router.use('/transfers', requireSavdoAuth, transfersRouter)

// ── Stock (qoldiq) ────────────────────────────────────────────────────────────
const stockRouter = Router()
stockRouter.get('/export.xlsx', requireSavdoPermission('stock.view'), exportStockXlsx)
stockRouter.get('/', requireSavdoPermission('stock.view'), listStock)
router.use('/stock', requireSavdoAuth, stockRouter)

// ── Customers (mijozlar) ───────────────────────────────────────────────────────
const customersRouter = Router()
customersRouter.get('/options', requireSavdoPermission('customers.view'), listCustomerOptions)
customersRouter.get('/', requireSavdoPermission('customers.view'), listCustomers)
customersRouter.post('/', requireSavdoPermission('customers.manage'), createCustomer)
customersRouter.put('/:id', requireSavdoPermission('customers.manage'), updateCustomer)
router.use('/customers', requireSavdoAuth, customersRouter)

// ── Sales (savdo/faktura) ────────────────────────────────────────────────────
const salesRouter = Router()
// ':id' dan OLDIN — aks holda "export.xlsx" sotuv id sifatida qabul qilinadi
salesRouter.get('/export.xlsx', requireSavdoPermission('sales.view'), exportSalesXlsx)
salesRouter.get('/', requireSavdoPermission('sales.view'), listSales)
salesRouter.get('/:id', requireSavdoPermission('sales.view'), getSale)
salesRouter.get('/:id/print', requireSavdoPermission('sales.view'), printSaleInvoice)
salesRouter.post('/', requireSavdoPermission('sales.create'), createSaleHandler)
salesRouter.post('/pos', requireSavdoPermission('sales.create'), createPosSaleHandler)
salesRouter.put('/:id', requireSavdoAdmin, updateSaleHandler)
salesRouter.post('/:id/cancel', requireSavdoAdmin, cancelSaleHandler)
router.use('/sales', requireSavdoAuth, salesRouter)

// ── Kassa smena (POS) ─────────────────────────────────────────────────────────
const kassaSmenaRouter = Router()
// 'export.xlsx' va 'current' ':id' dan OLDIN
kassaSmenaRouter.get('/export.xlsx', requireSavdoPermission('kassa.history'), exportSmenasXlsx)
kassaSmenaRouter.get('/current', requireSavdoPermission('kassa.use'), getCurrentSmena)
kassaSmenaRouter.get('/', requireSavdoPermission('kassa.history'), listSmenas)
kassaSmenaRouter.get('/:id', requireSavdoPermission('kassa.history'), getSmenaReport)
kassaSmenaRouter.post('/open', requireSavdoPermission('kassa.use'), openSmena)
kassaSmenaRouter.post('/:id/close', requireSavdoPermission('kassa.use'), closeSmena)
router.use('/kassa-smena', requireSavdoAuth, kassaSmenaRouter)

// ── Payments (to'lov / qarz) ──────────────────────────────────────────────────
const paymentsRouter = Router()
paymentsRouter.get('/export.xlsx', requireSavdoPermission('payments.view'), exportPaymentsXlsx)
paymentsRouter.get('/', requireSavdoPermission('payments.view'), listPayments)
paymentsRouter.post('/', requireSavdoPermission('payments.create'), createPayment)
paymentsRouter.get('/customer/:customerId/debt', requireSavdoPermission('payments.view'), getCustomerDebtHandler)
paymentsRouter.delete('/:id', requireSavdoAdmin, cancelPayment)
router.use('/payments', requireSavdoAuth, paymentsRouter)

// ── Hisobotlar: naqd / perechisleniya / qarz alohida; mijozlar qarz-avans qoldig'i ──
const reportsRouter = Router()
reportsRouter.get('/payment-types', requireSavdoPermission('payments.view'), getPaymentTypeReport)
reportsRouter.get('/payment-types/export.xlsx', requireSavdoPermission('payments.view'), exportPaymentTypeXlsx)
reportsRouter.get('/customer-balances', requireSavdoPermission('payments.viewAll'), getCustomerBalances)
router.use('/reports', requireSavdoAuth, reportsRouter)

// ── Xarajatlar (sof foyda uchun) ──────────────────────────────────────────────
const expensesRouter = Router()
expensesRouter.get('/export.xlsx', requireSavdoPermission('expenses.view'), exportExpensesXlsx)
expensesRouter.get('/', requireSavdoPermission('expenses.view'), listExpenses)
expensesRouter.post('/', requireSavdoPermission('expenses.manage'), createExpense)
expensesRouter.put('/:id', requireSavdoPermission('expenses.manage'), updateExpense)
expensesRouter.post('/:id/cancel', requireSavdoAdmin, cancelExpense)
router.use('/expenses', requireSavdoAuth, expensesRouter)

// ── Qarzdorlarga SMS eslatma — faqat admin ────────────────────────────────────
const smsRouter = Router()
smsRouter.get('/debtors', listDebtorsForSms)
smsRouter.get('/logs', listSmsLogs)
smsRouter.post('/preview', previewSms)
smsRouter.post('/send', sendDebtorSms)
router.use('/sms', requireSavdoAuth, requireSavdoAdmin, smsRouter)

// ── Dashboard / hisobot ────────────────────────────────────────────────────────
router.get('/dashboard', requireSavdoAuth, requireSavdoPermission('dashboard.view'), getDashboard)

// ── Inventarizatsiya ──────────────────────────────────────────────────────────
const inventoryRouter = Router()
inventoryRouter.get('/report', requireSavdoPermission('inventory.view'), getReport)
inventoryRouter.get('/report/export.xlsx', requireSavdoPermission('inventory.view'), exportReportXlsx)
inventoryRouter.post('/count/preview', requireSavdoPermission('inventory.confirm'), xlsxUpload.single('file'), previewCount)
inventoryRouter.post('/count/confirm', requireSavdoPermission('inventory.confirm'), confirmCount)
inventoryRouter.get('/sheet', requireSavdoPermission('inventory.view'), printCountSheet)
inventoryRouter.post('/draft', requireSavdoPermission('inventory.confirm'), saveDraft)
inventoryRouter.post('/draft/:id/confirm', requireSavdoPermission('inventory.confirm'), confirmDraft)
inventoryRouter.delete('/draft/:id', requireSavdoPermission('inventory.confirm'), removeDraft)
inventoryRouter.get('/counts/:id/print', requireSavdoPermission('inventory.view'), printCountAct)
inventoryRouter.get('/counts', requireSavdoPermission('inventory.view'), listCounts)
inventoryRouter.get('/counts/:id', requireSavdoPermission('inventory.view'), getCount)
router.use('/inventory', requireSavdoAuth, inventoryRouter)

// ── Sozlamalar (hisob-faktura rekvizitlari, SMS) — faqat admin ────────────────
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
