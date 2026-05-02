import { Router } from 'express'
import { getTransfers, getTransferStats, getTransfer, createTransfer, approveTransfer, shipTransfer, receiveTransfer, createBulkTransfer, distributeTransfer, cancelTransfer, rejectTransfer } from '../controllers/transfers'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/stats', getTransferStats)
router.get('/', getTransfers)
router.get('/:id', getTransfer)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createTransfer)
router.post('/bulk', authorize('admin', 'manager', 'branch_manager'), createBulkTransfer)
router.post('/distribute', authorize('admin', 'manager'), distributeTransfer)
router.put('/:id/approve', authorize('admin', 'manager'), approveTransfer)
router.put('/:id/ship', authorize('admin', 'manager', 'branch_manager'), shipTransfer)
router.put('/:id/receive', authorize('admin', 'manager', 'branch_manager'), receiveTransfer)
// Bekor qilish (pending/approved) — inventory'ga ta'sir yo'q
router.put('/:id/cancel', authorize('admin', 'manager', 'branch_manager'), cancelTransfer)
// Rad etish (shipped → inventar yuboruvchiga qaytariladi)
router.put('/:id/reject', authorize('admin', 'manager', 'branch_manager'), rejectTransfer)
export default router
