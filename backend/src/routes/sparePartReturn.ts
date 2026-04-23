import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { uploadEvidence as multerUpload, compressAndSave } from '../middleware/evidenceUpload'
import {
  createReturn,
  getPendingReturns,
  approveReturn,
  rejectReturn,
  uploadReturnEvidence,
  getMyReturns,
  getReturnableItems,
} from '../controllers/sparePartReturn'

const router = Router()
router.use(authenticate)

router.get('/', getMyReturns)
router.get('/pending', authorize('admin', 'super_admin'), getPendingReturns)
router.get('/returnable/:maintenanceId', getReturnableItems)
router.post('/', authorize('admin', 'super_admin', 'manager', 'branch_manager'), createReturn)
router.post('/:id/evidence', multerUpload.array('photos', 5), compressAndSave, uploadReturnEvidence)
router.post('/:id/approve', authorize('admin', 'super_admin'), approveReturn)
router.post('/:id/reject', authorize('admin', 'super_admin'), rejectReturn)

export default router
