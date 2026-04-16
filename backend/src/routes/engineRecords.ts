import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getEngineRecords, createEngineRecord, updateEngineRecord, deleteEngineRecord } from '../controllers/engineRecords'

const router = Router()
router.use(authenticate)

router.get('/', getEngineRecords)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createEngineRecord)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateEngineRecord)
router.delete('/:id', authorize('admin', 'manager'), deleteEngineRecord)

export default router
