import { Router } from 'express'
import { getFuelPrices, getCurrentFuelPrices, createFuelPrice, deleteFuelPrice } from '../controllers/fuelPrices'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/current', getCurrentFuelPrices)
router.get('/', getFuelPrices)
router.post('/', authorize('admin', 'manager'), createFuelPrice)
router.delete('/:id', authorize('admin'), deleteFuelPrice)
export default router
