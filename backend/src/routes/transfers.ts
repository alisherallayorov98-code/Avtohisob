import { Router } from 'express'
import { getTransfers, getTransferStats, getTransfer, createTransfer, approveTransfer, shipTransfer, receiveTransfer, createBulkTransfer, distributeTransfer } from '../controllers/transfers'
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
export default router
