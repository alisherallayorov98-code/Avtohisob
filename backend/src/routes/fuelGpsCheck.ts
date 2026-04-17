import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getFuelGpsCheck } from '../controllers/fuelGpsCheck'

const router = Router()
router.use(authenticate)
router.get('/gps-check', authorize('admin', 'super_admin', 'manager'), getFuelGpsCheck)
export default router
