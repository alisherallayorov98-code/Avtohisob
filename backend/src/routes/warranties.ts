import { Router } from 'express'
import { listWarranties, createWarranty, updateWarranty, deleteWarranty, getWarrantyStats, refreshWarrantyStatuses } from '../controllers/warranties'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

router.get('/stats', getWarrantyStats)
router.get('/', listWarranties)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createWarranty)
router.patch('/:id', authorize('admin', 'manager'), updateWarranty)
router.delete('/:id', authorize('admin', 'manager'), deleteWarranty)
router.post('/refresh-statuses', authorize('admin'), refreshWarrantyStatuses)

export default router
