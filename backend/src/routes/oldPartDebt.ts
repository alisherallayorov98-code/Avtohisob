import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { uploadEvidence as multerUpload, compressAndSave, validateEvidenceFiles } from '../middleware/evidenceUpload'
import {
  getMyDebts,
  listDebts,
  submitDebt,
  uploadDebtEvidence,
  approveDebt,
  rejectDebt,
} from '../controllers/oldPartDebt'

const router = Router()
router.use(authenticate)

router.get('/my', getMyDebts)
router.get('/', authorize('admin', 'super_admin', 'manager', 'branch_manager'), listDebts)
router.post('/:id/submit', submitDebt)
router.post('/:id/evidence', multerUpload.array('photos', 5), validateEvidenceFiles, compressAndSave, uploadDebtEvidence)
router.post('/:id/approve', authorize('admin', 'super_admin'), approveDebt)
router.post('/:id/reject', authorize('admin', 'super_admin'), rejectDebt)

export default router
