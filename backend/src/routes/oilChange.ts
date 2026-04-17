import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getOrgOilSettings, saveOrgOilSettings, getOilOverview, bulkOilSetup, recordOilChange, getKmAtDate, getVehicleMileageReport } from '../controllers/oilChange'

const router = Router()
router.use(authenticate)

router.get('/settings', getOrgOilSettings)
router.post('/settings', authorize('admin', 'super_admin', 'manager'), saveOrgOilSettings)
router.get('/overview', getOilOverview)
router.post('/bulk-setup', authorize('admin', 'super_admin', 'manager', 'branch_manager'), bulkOilSetup)
router.post('/record', authorize('admin', 'super_admin', 'manager', 'branch_manager'), recordOilChange)
router.get('/km-at-date', getKmAtDate)
router.get('/vehicle-report', getVehicleMileageReport)

export default router
