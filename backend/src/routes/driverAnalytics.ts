import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getDriverStats } from '../controllers/driverAnalytics'

const router = Router()
router.use(authenticate)
router.get('/', authorize('admin', 'super_admin', 'manager'), getDriverStats)
export default router
