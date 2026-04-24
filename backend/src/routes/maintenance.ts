import { Router } from 'express'
import { getMaintenance, getMaintenanceById, createMaintenance, updateMaintenance, deleteMaintenance, getVehicleMaintenance, getMaintenanceStats, generateEvidenceOtp } from '../controllers/maintenance'
import { getPendingMaintenance, approveMaintenance, rejectMaintenance, uploadEvidence, getEvidence, deleteEvidence } from '../controllers/maintenanceApproval'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { uploadEvidence as multerUpload, compressAndSave, validateEvidenceFiles } from '../middleware/evidenceUpload'

const router = Router()
router.use(authenticate)

router.get('/stats', getMaintenanceStats)
router.get('/pending', authorize('admin', 'super_admin'), getPendingMaintenance)
router.get('/vehicle/:id', getVehicleMaintenance)
router.get('/', getMaintenance)
router.get('/:id', getMaintenanceById)
router.post('/', authorize('admin', 'super_admin', 'manager', 'branch_manager'), createMaintenance)
router.put('/:id', authorize('admin', 'super_admin'), updateMaintenance)
router.delete('/:id', authorize('admin', 'super_admin', 'manager', 'branch_manager'), deleteMaintenance)

// Evidence
router.post('/:id/evidence-otp', authorize('admin', 'super_admin', 'manager', 'branch_manager'), generateEvidenceOtp)
router.get('/:id/evidence', getEvidence)
router.post('/:id/evidence', authorize('admin', 'super_admin', 'manager', 'branch_manager'), multerUpload.array('photos', 3), validateEvidenceFiles, compressAndSave, uploadEvidence)
router.delete('/:id/evidence/:evidenceId', authorize('admin', 'super_admin', 'manager', 'branch_manager'), deleteEvidence)

// Approval
router.post('/:id/approve', authorize('admin', 'super_admin'), approveMaintenance)
router.post('/:id/reject', authorize('admin', 'super_admin'), rejectMaintenance)

export default router
