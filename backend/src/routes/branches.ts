import { Router } from 'express'
import { getBranches, getBranch, createBranch, updateBranch, deleteBranch, getBranchStats } from '../controllers/branches'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { checkLimit } from '../middleware/subscriptionGuard'

const router = Router()
router.use(authenticate)
router.get('/', getBranches)
router.get('/:id', getBranch)
router.get('/:id/stats', getBranchStats)
router.post('/', authorize('admin'), checkLimit('branches'), createBranch)
router.put('/:id', authorize('admin', 'manager'), updateBranch)
router.delete('/:id', authorize('admin'), deleteBranch)
export default router
