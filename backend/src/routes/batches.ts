import { Router } from 'express'
import { getBatches, getBatch, getBatchQr, createBatch, shipBatch, receiveBatch } from '../controllers/batches'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getBatches)
router.get('/:id', getBatch)
router.get('/:id/qr', getBatchQr)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createBatch)
router.put('/:id/ship', authorize('admin', 'manager', 'branch_manager'), shipBatch)
router.put('/:id/receive', authorize('admin', 'manager', 'branch_manager'), receiveBatch)
export default router
