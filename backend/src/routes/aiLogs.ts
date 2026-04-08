import { Router } from 'express'
import { listAILogs, getAIStats } from '../controllers/aiLogs'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate, authorize('admin'))
router.get('/', listAILogs)
router.get('/stats', getAIStats)
export default router
