import { Router } from 'express'
import { requireEkoAuth, requireEkoAdmin } from '../middleware/ekoAuth'

import { login, me } from '../controllers/auth'
import {
  listUsers, createUser, updateUser, assignDistricts, resetPassword, deactivateUser,
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
  getDailyList, getMapData, getStats,
} from '../controllers/dashboard'
import {
  generateCharges, getEntityLedger, bulkSetBillingMode,
} from '../controllers/charges'
import { listTalons, createTalon, updateTalon, deleteTalon } from '../controllers/talons'
import { getReportsOverview } from '../controllers/reports'
import { getServiceProof } from '../controllers/gpsProof'
import { generateLinkToken, getBotLinkStatus } from '../controllers/botLink'
import { getReceipt, downloadInvoice } from '../controllers/receipts'

const router = Router()

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', login)
router.get('/auth/me', requireEkoAuth, me)

// ── Users (admin only) ────────────────────────────────────────────────────────
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
entitiesRouter.post('/', createEntity)
entitiesRouter.get('/:id', getEntity)
entitiesRouter.get('/:id/service-proof', getServiceProof)
entitiesRouter.get('/:id/invoice', downloadInvoice)
entitiesRouter.put('/:id', updateEntity)
entitiesRouter.put('/:id/location', updateLocation)
entitiesRouter.delete('/:id', softDeleteEntity)
router.use('/entities', requireEkoAuth, entitiesRouter)

// ── Payments ──────────────────────────────────────────────────────────────────
const paymentsRouter = Router()
paymentsRouter.get('/', listPayments)
paymentsRouter.get('/charge-status', getChargeStatus)
paymentsRouter.post('/', recordPayment)
paymentsRouter.delete('/:id', requireEkoAdmin, deletePayment)
router.use('/payments', requireEkoAuth, paymentsRouter)

// ── Talons (talon asosida — kub × narx) ──────────────────────────────────────
const talonsRouter = Router()
talonsRouter.get('/', listTalons)
talonsRouter.post('/', createTalon)
talonsRouter.patch('/:id', updateTalon)
talonsRouter.delete('/:id', deleteTalon)
router.use('/talons', requireEkoAuth, talonsRouter)

// ── Blacklist ─────────────────────────────────────────────────────────────────
const blacklistRouter = Router()
blacklistRouter.get('/', listBlacklist)
blacklistRouter.post('/', addToBlacklist)
blacklistRouter.put('/:id', updateBlacklist)
blacklistRouter.delete('/:id', requireEkoAdmin, removeFromBlacklist)
router.use('/blacklist', requireEkoAuth, blacklistRouter)

// ── Dashboard ─────────────────────────────────────────────────────────────────
const dashboardRouter = Router()
dashboardRouter.get('/daily', getDailyList)
dashboardRouter.get('/map', getMapData)
dashboardRouter.get('/stats', getStats)
router.use('/dashboard', requireEkoAuth, dashboardRouter)

// ── Reports (hisobot va analitika) ────────────────────────────────────────────
const reportsRouter = Router()
reportsRouter.get('/overview', getReportsOverview)
router.use('/reports', requireEkoAuth, reportsRouter)

// ── Receipts ──────────────────────────────────────────────────────────────────
router.get('/receipts/:id', requireEkoAuth, getReceipt)

// ── Bot linking ───────────────────────────────────────────────────────────────
router.post('/bot/link-token', requireEkoAuth, requireEkoAdmin, generateLinkToken)
router.get('/bot/link-status/:userId', requireEkoAuth, requireEkoAdmin, getBotLinkStatus)

// ── Charges (oylik hisob / qarz) ───────────────────────────────────────────────
const chargesRouter = Router()
chargesRouter.post('/generate', requireEkoAdmin, generateCharges)
chargesRouter.put('/bulk-billing-mode', requireEkoAdmin, bulkSetBillingMode)
chargesRouter.get('/entity/:id', getEntityLedger)
router.use('/charges', requireEkoAuth, chargesRouter)

export default router
