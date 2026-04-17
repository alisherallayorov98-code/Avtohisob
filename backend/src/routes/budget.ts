import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getBudgets, upsertBudget, getBudgetActual } from '../controllers/budget'

const router = Router()
router.use(authenticate)
router.get('/', getBudgets)
router.post('/', authorize('admin', 'super_admin', 'manager'), upsertBudget)
router.get('/actual', getBudgetActual)
export default router
