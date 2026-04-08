import { Router } from 'express'
import { getMaintenance, getMaintenanceById, createMaintenance, updateMaintenance, deleteMaintenance, getVehicleMaintenance, getMaintenanceStats } from '../controllers/maintenance'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/stats', getMaintenanceStats)
router.get('/vehicle/:id', getVehicleMaintenance)
router.get('/', getMaintenance)
router.get('/:id', getMaintenanceById)
router.post('/', createMaintenance)
router.put('/:id', updateMaintenance)
router.delete('/:id', deleteMaintenance)
export default router
