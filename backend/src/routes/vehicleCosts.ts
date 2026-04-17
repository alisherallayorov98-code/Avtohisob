import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getVehicleCosts, getVehicleCostDetail } from '../controllers/vehicleCosts'

const router = Router()
router.use(authenticate)
router.get('/', authorize('admin', 'super_admin', 'manager'), getVehicleCosts)
router.get('/:id', authorize('admin', 'super_admin', 'manager', 'branch_manager'), getVehicleCostDetail)
export default router
