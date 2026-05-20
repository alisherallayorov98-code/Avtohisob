import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getEngineRecords, createEngineRecord, updateEngineRecord, deleteEngineRecord, detectOilRecords, getEngineDashboard } from '../controllers/engineRecords'

const router = Router()
router.use(authenticate)

router.get('/dashboard', getEngineDashboard)
router.post('/detect-oil', authorize('admin', 'manager', 'branch_manager'), detectOilRecords)
router.get('/', getEngineRecords)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createEngineRecord)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateEngineRecord)
router.delete('/:id', authorize('admin', 'manager'), deleteEngineRecord)

export default router
