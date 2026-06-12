import { Router } from 'express'
import { getFuelRecords, getFuelRecord, createFuelRecord, updateFuelRecord, deleteFuelRecord, getVehicleFuelRecords, getFuelReport, getFuelRecord_stats, getFuelNormAnalysis, getFuelTankBalance, backfillFuelCosts } from '../controllers/fuel'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { upload, validateUpload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.get('/report', getFuelReport)
router.get('/stats', getFuelRecord_stats)
router.get('/norm-analysis', getFuelNormAnalysis)
router.get('/tank-balance', getFuelTankBalance)
router.get('/vehicle/:id', getVehicleFuelRecords)
router.get('/', getFuelRecords)
router.get('/:id', getFuelRecord)
router.post('/backfill-costs', authorize('admin', 'manager'), backfillFuelCosts)
router.post('/', upload.single('receipt'), validateUpload, authorize('admin', 'manager', 'branch_manager'), createFuelRecord)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateFuelRecord)
router.delete('/:id', authorize('admin', 'manager'), deleteFuelRecord)
export default router
