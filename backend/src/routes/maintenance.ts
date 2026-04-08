import { Router } from 'express'
import { getMaintenance, getMaintenanceById, createMaintenance, updateMaintenance, getVehicleMaintenance } from '../controllers/maintenance'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/vehicle/:id', getVehicleMaintenance)
router.get('/', getMaintenance)
router.get('/:id', getMaintenanceById)
router.post('/', createMaintenance)
router.put('/:id', updateMaintenance)
export default router
