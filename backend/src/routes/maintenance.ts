import { Router } from 'express'
import { getMaintenance, getMaintenanceById, createMaintenance, updateMaintenance, deleteMaintenance, getVehicleMaintenance, getMaintenanceStats } from '../controllers/maintenance'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/stats', getMaintenanceStats)
router.get('/vehicle/:id', getVehicleMaintenance)
router.get('/', getMaintenance)
router.get('/:id', getMaintenanceById)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createMaintenance)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateMaintenance)
router.delete('/:id', authorize('admin', 'manager'), deleteMaintenance)
export default router
