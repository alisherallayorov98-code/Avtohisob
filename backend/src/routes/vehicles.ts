import { Router } from 'express'
import { getVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle, getVehicleHistory, getVehicleExpenses, transferVehicle, getVehicleGpsHistory, getVehicleStats } from '../controllers/vehicles'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { checkLimit } from '../middleware/subscriptionGuard'

const router = Router()
router.use(authenticate)
router.get('/', getVehicles)
router.get('/stats', getVehicleStats)
router.get('/:id', getVehicle)
router.get('/:id/history', getVehicleHistory)
router.get('/:id/expenses', getVehicleExpenses)
router.get('/:id/gps-history', getVehicleGpsHistory)
router.post('/', authorize('admin', 'manager', 'branch_manager'), checkLimit('vehicles'), createVehicle)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateVehicle)
router.post('/:id/transfer', authorize('admin', 'manager'), transferVehicle)
router.delete('/:id', authorize('admin', 'manager'), deleteVehicle)
export default router
