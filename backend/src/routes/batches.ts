import { Router } from 'express'
import { getBatches, getBatch, getBatchQr, createBatch, shipBatch, receiveBatch, cancelBatch, rejectBatch } from '../controllers/batches'
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
// Bekor qilish (pending) — yuboruvchi/qabul qiluvchi
router.put('/:id/cancel', authorize('admin', 'manager', 'branch_manager'), cancelBatch)
// Rad etish (shipped → inventar yuboruvchiga qaytariladi)
router.put('/:id/reject', authorize('admin', 'manager', 'branch_manager'), rejectBatch)
export default router
