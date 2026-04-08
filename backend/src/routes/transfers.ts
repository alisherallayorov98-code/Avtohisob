import { Router } from 'express'
import { getTransfers, getTransferStats, getTransfer, createTransfer, approveTransfer, shipTransfer, receiveTransfer } from '../controllers/transfers'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/stats', getTransferStats)
router.get('/', getTransfers)
router.get('/:id', getTransfer)
router.post('/', createTransfer)
router.put('/:id/approve', authorize('admin', 'manager'), approveTransfer)
router.put('/:id/ship', shipTransfer)
router.put('/:id/receive', receiveTransfer)
export default router
