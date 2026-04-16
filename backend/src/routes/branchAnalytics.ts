import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getBranchCostComparison } from '../controllers/branchAnalytics'

const router = Router()
router.use(authenticate)

router.get('/cost-comparison', getBranchCostComparison)

export default router
