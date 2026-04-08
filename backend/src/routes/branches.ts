import { Router } from 'express'
import { getBranches, getBranch, createBranch, updateBranch, getBranchStats } from '../controllers/branches'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getBranches)
router.get('/:id', getBranch)
router.get('/:id/stats', getBranchStats)
router.post('/', authorize('admin'), createBranch)
router.put('/:id', authorize('admin', 'manager'), updateBranch)
export default router
