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
  listPayments, recordPayment, deletePayment,
} from '../controllers/payments'
import {
  listBlacklist, addToBlacklist, updateBlacklist, removeFromBlacklist,
} from '../controllers/blacklist'
import {
  getDailyList, getMapData, getStats,
} from '../controllers/dashboard'

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
entitiesRouter.put('/:id', updateEntity)
entitiesRouter.put('/:id/location', updateLocation)
entitiesRouter.delete('/:id', softDeleteEntity)
router.use('/entities', requireEkoAuth, entitiesRouter)

// ── Payments ──────────────────────────────────────────────────────────────────
const paymentsRouter = Router()
paymentsRouter.get('/', listPayments)
paymentsRouter.post('/', recordPayment)
paymentsRouter.delete('/:id', requireEkoAdmin, deletePayment)
router.use('/payments', requireEkoAuth, paymentsRouter)

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

export default router
