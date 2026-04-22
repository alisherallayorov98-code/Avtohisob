import { Router } from 'express'
import { getRequests, getRequest, createRequest, respondToRequest } from '../controllers/requests'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getRequests)
router.get('/:id', getRequest)
router.post('/', authorize('admin', 'manager', 'branch_manager', 'operator'), createRequest)
router.put('/:id/respond', authorize('admin', 'manager'), respondToRequest)
export default router
