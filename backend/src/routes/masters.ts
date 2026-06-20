import { Router } from 'express'
import {
  getMasters, getMasterDetail, createMaster, updateMaster, deleteMaster,
  createMasterPayment, deleteMasterPayment, syncFromMaintenance,
} from '../controllers/masters'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getMasters)
router.get('/:id/detail', getMasterDetail)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createMaster)
router.post('/sync', authorize('admin', 'manager', 'branch_manager'), syncFromMaintenance)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateMaster)
router.delete('/:id', authorize('admin', 'manager'), deleteMaster)
router.post('/:id/payments', authorize('admin', 'manager', 'branch_manager'), createMasterPayment)
router.delete('/:id/payments/:paymentId', authorize('admin', 'manager'), deleteMasterPayment)
export default router
