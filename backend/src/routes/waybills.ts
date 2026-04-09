import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import {
  listWaybills, getWaybill, createWaybill, updateWaybill,
  activateWaybill, completeWaybill, cancelWaybill, deleteWaybill,
} from '../controllers/waybills'

const router = Router()
router.use(authenticate)

router.get('/',     listWaybills)
router.get('/:id',  getWaybill)
router.post('/',    authorize('admin', 'super_admin', 'manager'), createWaybill)
router.patch('/:id', authorize('admin', 'super_admin', 'manager'), updateWaybill)
router.post('/:id/activate', authorize('admin', 'super_admin', 'manager'), activateWaybill)
router.post('/:id/complete', authorize('admin', 'super_admin', 'manager'), completeWaybill)
router.post('/:id/cancel',   authorize('admin', 'super_admin', 'manager'), cancelWaybill)
router.delete('/:id', authorize('admin', 'super_admin'), deleteWaybill)

export default router
