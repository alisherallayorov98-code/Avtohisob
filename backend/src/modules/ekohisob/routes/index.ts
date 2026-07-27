import { Router } from 'express'
import multer from 'multer'
import { requireEkoAuth, requireEkoAdmin, requireEkoCanWrite } from '../middleware/ekoAuth'
import { authLimiter } from '../../../middleware/rateLimiter'

import { login, me } from '../controllers/auth'
import {
  listUsers, createUser, updateUser, assignDistricts, resetPassword, deactivateUser,
  listUserOptions,
} from '../controllers/users'
import {
  listDistricts, createDistrict, updateDistrict, listMahallasInDistrict,
} from '../controllers/districts'
import {
  listMahallas, createMahalla, updateMahalla, deleteMahalla,
} from '../controllers/mahallas'
import {
  listEntities, createEntity, getEntity, updateEntity, updateLocation, softDeleteEntity,
} from '../controllers/entities'
import {
  listPayments, recordPayment, deletePayment, getChargeStatus,
} from '../controllers/payments'
import {
  listBlacklist, addToBlacklist, updateBlacklist, removeFromBlacklist,
} from '../controllers/blacklist'
import {
  getDailyList, getMapData, getStats, getOnboardingStatus,
} from '../controllers/dashboard'
import {
  generateCharges, getEntityLedger, bulkSetBillingMode, recalcCharges,
} from '../controllers/charges'
import { listAuditLogs, getAuditSummary } from '../controllers/audit'
import { listTalons, createTalon, updateTalon, deleteTalon } from '../controllers/talons'
import { getReportsOverview, getDistrictMahallas } from '../controllers/reports'
import { exportReportsXlsx, printReport } from '../controllers/reportsExport'
import { sendDebtReminder, getSmsStatus, listSmsLogs } from '../controllers/reminders'
import { listPlans, setPlan, deletePlan, getMyPlan } from '../controllers/plans'
import { tgWebAppAuth } from '../controllers/tgAuth'
import { getServiceProof } from '../controllers/gpsProof'
import { generateLinkToken, getBotLinkStatus, unlinkBot } from '../controllers/botLink'
import { getReceipt, downloadInvoice } from '../controllers/receipts'
import {
  previewImport, confirmImport, downloadImportTemplate, listImportBatches, undoImportBatch,
} from '../controllers/entityImport'
import { printReceipt, verifyReceipt } from '../controllers/receiptPrint'
import {
  getReconciliation, printReconciliation, downloadReconciliation,
} from '../controllers/reconciliation'
import {
  getSettings, updateSettings, previewSmsTemplate, getBlacklistSuggestions,
} from '../controllers/settings'

const router = Router()

// Excel import — fayl xotirada saqlanadi (diskka yozilmaydi), 10 MB gacha
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', authLimiter, login) // brute-force himoya: 15 daqiqada 10 urinish
router.get('/auth/me', requireEkoAuth, me)

// ── Telegram Mini App (Web App) — initData orqali avtomatik kirish ─────────────
router.post('/tg/auth', tgWebAppAuth)

// ── Users ─────────────────────────────────────────────────────────────────────
// Yengil ro'yxat (id + ism) — "kim kiritdi" filtri uchun, barcha kirganlarga.
// Qolgan /users/* marshrutlari faqat admin uchun (pastda).
router.get('/users/options', requireEkoAuth, listUserOptions)

const usersRouter = Router()
usersRouter.get('/', listUsers)
usersRouter.post('/', createUser)
usersRouter.put('/:id', updateUser)
usersRouter.put('/:id/districts', assignDistricts)
usersRouter.put('/:id/password', resetPassword)
usersRouter.delete('/:id', deactivateUser)
router.use('/users', requireEkoAuth, requireEkoAdmin, usersRouter)

// ── Districts ─────────────────────────────────────────────────────────────────
const districtsRouter = Router()
districtsRouter.get('/', listDistricts)
districtsRouter.post('/', requireEkoAdmin, createDistrict)
districtsRouter.put('/:id', requireEkoAdmin, updateDistrict)
districtsRouter.get('/:id/mahallas', listMahallasInDistrict)
router.use('/districts', requireEkoAuth, districtsRouter)

// ── Mahallas ──────────────────────────────────────────────────────────────────
const mahallasRouter = Router()
mahallasRouter.get('/', listMahallas)
mahallasRouter.post('/', requireEkoAdmin, createMahalla)
mahallasRouter.put('/:id', requireEkoAdmin, updateMahalla)
mahallasRouter.delete('/:id', requireEkoAdmin, deleteMahalla)
router.use('/mahallas', requireEkoAuth, mahallasRouter)

// ── Legal Entities ────────────────────────────────────────────────────────────
const entitiesRouter = Router()
entitiesRouter.get('/', listEntities)
// ── Excel import (admin only) — ':id' marshrutlaridan OLDIN turishi shart,
//    aks holda "import" tashkilot id sifatida qabul qilinadi.
entitiesRouter.get('/import/template', requireEkoAdmin, downloadImportTemplate)
entitiesRouter.get('/import/batches', requireEkoAdmin, listImportBatches)
entitiesRouter.post('/import/batches/:id/undo', requireEkoAdmin, undoImportBatch)
entitiesRouter.post('/import/preview', requireEkoAdmin, importUpload.single('file'), previewImport)
entitiesRouter.post('/import/confirm', requireEkoAdmin, importUpload.single('file'), confirmImport)
entitiesRouter.post('/', requireEkoCanWrite, createEntity)
entitiesRouter.get('/:id', getEntity)
entitiesRouter.get('/:id/service-proof', getServiceProof)
entitiesRouter.get('/:id/invoice', downloadInvoice)
// Akt sverka (solishtirma dalolatnoma) — JSON, chop etiladigan hujjat, Excel
entitiesRouter.get('/:id/reconciliation', getReconciliation)
entitiesRouter.get('/:id/reconciliation/print', printReconciliation)
entitiesRouter.get('/:id/reconciliation.xlsx', downloadReconciliation)
entitiesRouter.put('/:id', requireEkoCanWrite, updateEntity)
entitiesRouter.put('/:id/location', requireEkoCanWrite, updateLocation)
entitiesRouter.delete('/:id', requireEkoCanWrite, softDeleteEntity)
router.use('/entities', requireEkoAuth, entitiesRouter)

// ── Payments ──────────────────────────────────────────────────────────────────
const paymentsRouter = Router()
paymentsRouter.get('/', listPayments)
paymentsRouter.get('/charge-status', getChargeStatus)
paymentsRouter.post('/', requireEkoCanWrite, recordPayment)
paymentsRouter.delete('/:id', requireEkoAdmin, deletePayment)
router.use('/payments', requireEkoAuth, paymentsRouter)

// ── Talons (talon asosida — kub × narx) ──────────────────────────────────────
const talonsRouter = Router()
talonsRouter.get('/', listTalons)
talonsRouter.post('/', requireEkoCanWrite, createTalon)
talonsRouter.patch('/:id', requireEkoCanWrite, updateTalon)
talonsRouter.delete('/:id', requireEkoCanWrite, deleteTalon)
router.use('/talons', requireEkoAuth, talonsRouter)

// ── Blacklist ─────────────────────────────────────────────────────────────────
const blacklistRouter = Router()
blacklistRouter.get('/', listBlacklist)
blacklistRouter.post('/', requireEkoCanWrite, addToBlacklist)
blacklistRouter.put('/:id', requireEkoCanWrite, updateBlacklist)
blacklistRouter.delete('/:id', requireEkoAdmin, removeFromBlacklist)
router.use('/blacklist', requireEkoAuth, blacklistRouter)

// ── Dashboard ─────────────────────────────────────────────────────────────────
const dashboardRouter = Router()
dashboardRouter.get('/daily', getDailyList)
dashboardRouter.get('/map', getMapData)
dashboardRouter.get('/stats', getStats)
dashboardRouter.get('/onboarding', getOnboardingStatus)
router.use('/dashboard', requireEkoAuth, dashboardRouter)

// ── Reports (hisobot va analitika) ────────────────────────────────────────────
const reportsRouter = Router()
reportsRouter.get('/overview', getReportsOverview)
reportsRouter.get('/export.xlsx', exportReportsXlsx)
reportsRouter.get('/print', printReport)
// Mahalla kesimi — tuman qatoriga bosilganda talab bo'yicha yuklanadi
reportsRouter.get('/district/:id/mahallas', getDistrictMahallas)
router.use('/reports', requireEkoAuth, reportsRouter)

// ── Reminders (SMS eslatma — qarzdorga) ───────────────────────────────────────
const remindersRouter = Router()
remindersRouter.get('/status', getSmsStatus)
remindersRouter.get('/logs', listSmsLogs)
remindersRouter.post('/sms', requireEkoCanWrite, sendDebtReminder) // boshliq (nazoratchi) yubora olmaydi
router.use('/reminders', requireEkoAuth, remindersRouter)

// ── Plans (kunlik topshiriq — supervisor/admin inspektorga beradi) ────────────
const plansRouter = Router()
plansRouter.get('/my', getMyPlan)        // inspektor o'z plani
plansRouter.get('/', listPlans)          // supervisor/admin
plansRouter.post('/', setPlan)           // supervisor/admin (rol controllerda tekshiriladi)
plansRouter.delete('/:id', deletePlan)
router.use('/plans', requireEkoAuth, plansRouter)

// ── Receipts ──────────────────────────────────────────────────────────────────
// Tekshirish OCHIQ (QR kod shu yerga olib keladi) — ':id' dan OLDIN turishi shart.
// Shaxsiy ma'lumot bermaydi: faqat haqiqiylik, summa, davr; nom maskalanadi.
router.get('/receipts/verify/:number', verifyReceipt)
router.get('/receipts/:id', requireEkoAuth, getReceipt)
router.get('/receipts/:id/print', requireEkoAuth, printReceipt)

// ── Sozlamalar (avto-SMS, eskalatsiya) — faqat admin ──────────────────────────
// smsMonthlyLimit PUT'da QABUL QILINMAYDI: korxona o'z limitini oshira olmaydi.
const settingsRouter = Router()
settingsRouter.get('/', getSettings)
settingsRouter.put('/', updateSettings)
settingsRouter.post('/sms-preview', previewSmsTemplate)
settingsRouter.get('/blacklist-suggestions', getBlacklistSuggestions)
router.use('/settings', requireEkoAuth, requireEkoAdmin, settingsRouter)

// ── Bot linking ───────────────────────────────────────────────────────────────
router.post('/bot/link-token', requireEkoAuth, requireEkoAdmin, generateLinkToken)
router.get('/bot/link-status/:userId', requireEkoAuth, requireEkoAdmin, getBotLinkStatus)
router.delete('/bot/link/:userId', requireEkoAuth, requireEkoAdmin, unlinkBot)

// ── Charges (oylik hisob / qarz) ───────────────────────────────────────────────
const chargesRouter = Router()
chargesRouter.post('/generate', requireEkoAdmin, generateCharges)
// Bir martalik moslash: eski to'lov o'chirishlaridan qolgan noto'g'ri paidAmount'ni
// haqiqiy to'lovlardan qayta hisoblaydi. Admin + confirmPhrase talab qiladi.
chargesRouter.post('/recalc', requireEkoAdmin, recalcCharges)
chargesRouter.put('/bulk-billing-mode', requireEkoAdmin, bulkSetBillingMode)
chargesRouter.get('/entity/:id', getEntityLedger)
router.use('/charges', requireEkoAuth, chargesRouter)

// ── Audit jurnali (kim, qachon, nimani o'zgartirdi) — faqat admin ─────────────
const auditRouter = Router()
auditRouter.get('/', listAuditLogs)
auditRouter.get('/summary', getAuditSummary)
router.use('/audit', requireEkoAuth, requireEkoAdmin, auditRouter)

export default router
