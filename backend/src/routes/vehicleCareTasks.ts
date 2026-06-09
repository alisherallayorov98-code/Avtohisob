import { Router } from 'express'
import {
  listCareTasks, createCareTask, updateCareTask, deleteCareTask,
  generateCareDriverToken, listVehiclesCareDrivers, unlinkCareDriver,
  getCareMonitor,
} from '../controllers/vehicleCareTasks'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

const CARE_ROLES = ['admin', 'super_admin', 'manager'] as const

// Haydovchi bog'lanishi (/:id dan oldin — chalkashmaslik uchun)
router.get('/drivers', listVehiclesCareDrivers)
router.get('/monitor', getCareMonitor)
router.post('/driver-token', authorize(...CARE_ROLES), generateCareDriverToken)
router.delete('/driver/:vehicleId', authorize(...CARE_ROLES), unlinkCareDriver)

router.get('/', listCareTasks)
router.post('/', authorize(...CARE_ROLES), createCareTask)
router.put('/:id', authorize(...CARE_ROLES), updateCareTask)
router.delete('/:id', authorize(...CARE_ROLES), deleteCareTask)

export default router
