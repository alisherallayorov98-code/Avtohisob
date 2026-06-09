import { Router } from 'express'
import { listCareTasks, createCareTask, updateCareTask, deleteCareTask } from '../controllers/vehicleCareTasks'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

router.get('/', listCareTasks)
router.post('/', authorize('admin', 'super_admin', 'manager'), createCareTask)
router.put('/:id', authorize('admin', 'super_admin', 'manager'), updateCareTask)
router.delete('/:id', authorize('admin', 'super_admin', 'manager'), deleteCareTask)

export default router
