import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getEngineRecords, createEngineRecord, updateEngineRecord, deleteEngineRecord, detectOilRecords, getEngineDashboard, getOilHistory, markOilChangeFromHistory, getEngineCandidates, dismissEngineCandidate } from '../controllers/engineRecords'

const router = Router()
router.use(authenticate)

router.get('/dashboard', getEngineDashboard)
router.get('/candidates', getEngineCandidates)
router.post('/candidates/:maintenanceId/dismiss', authorize('admin', 'super_admin', 'manager', 'branch_manager'), dismissEngineCandidate)
router.get('/oil-history', getOilHistory)
router.post('/mark-oil-change', authorize('admin', 'manager', 'branch_manager'), markOilChangeFromHistory)
router.post('/detect-oil', authorize('admin', 'manager', 'branch_manager'), detectOilRecords)
router.get('/', getEngineRecords)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createEngineRecord)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateEngineRecord)
router.delete('/:id', authorize('admin', 'manager'), deleteEngineRecord)

export default router
