import { Router } from 'express'
import {
  listCareTasks, createCareTask, updateCareTask, deleteCareTask,
  generateCareDriverToken, listVehiclesCareDrivers, unlinkCareDriver,
  getCareMonitor, rejectCareSubmission, skipCareSubmission,
} from '../controllers/vehicleCareTasks'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

// Vazifa turlarini (siyosat) faqat tashkilot darajasidagilar belgilaydi
const CARE_ROLES = ['admin', 'super_admin', 'manager'] as const
// Nazorat, bot biriktirish, isbotni tasdiq/rad — filial muhandisi ham (o'z filiali doirasida)
const CARE_BRANCH_ROLES = ['admin', 'super_admin', 'manager', 'branch_manager'] as const

// Haydovchi bog'lanishi (/:id dan oldin — chalkashmaslik uchun)
router.get('/drivers', authorize(...CARE_BRANCH_ROLES), listVehiclesCareDrivers)
router.get('/monitor', authorize(...CARE_BRANCH_ROLES), getCareMonitor)
router.post('/submission/:id/reject', authorize(...CARE_BRANCH_ROLES), rejectCareSubmission)
router.post('/submission/:id/skip', authorize(...CARE_BRANCH_ROLES), skipCareSubmission)
router.post('/driver-token', authorize(...CARE_BRANCH_ROLES), generateCareDriverToken)
router.delete('/driver/:vehicleId', authorize(...CARE_BRANCH_ROLES), unlinkCareDriver)

router.get('/', listCareTasks)
router.post('/', authorize(...CARE_ROLES), createCareTask)
router.put('/:id', authorize(...CARE_ROLES), updateCareTask)
router.delete('/:id', authorize(...CARE_ROLES), deleteCareTask)

export default router
