import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getInspections, getInspectionById, createInspection, updateInspection, deleteInspection } from '../controllers/techInspections'

const router = Router()
router.use(authenticate)

router.get('/', getInspections)
router.get('/:id', getInspectionById)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createInspection)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateInspection)
router.delete('/:id', authorize('admin', 'manager'), deleteInspection)

export default router
