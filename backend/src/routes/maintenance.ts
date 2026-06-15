import { Router } from 'express'
import { getMaintenance, getMaintenanceById, createMaintenance, updateMaintenance, deleteMaintenance, getVehicleMaintenance, getMaintenanceStats, getWorkerNames, generateEvidenceOtp, getDuplicateAlerts } from '../controllers/maintenance'
import { getPendingMaintenance, approveMaintenance, rejectMaintenance, withdrawMaintenance, resubmitMaintenance, uploadEvidence, getEvidence, deleteEvidence } from '../controllers/maintenanceApproval'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { uploadEvidence as multerUpload, compressAndSave, validateEvidenceFiles } from '../middleware/evidenceUpload'

const router = Router()
router.use(authenticate)

router.get('/stats', getMaintenanceStats)
router.get('/workers', getWorkerNames)
router.get('/duplicate-alerts', authorize('admin', 'super_admin', 'manager'), getDuplicateAlerts)
router.get('/pending', authorize('admin', 'super_admin'), getPendingMaintenance)
router.get('/vehicle/:id', getVehicleMaintenance)
router.get('/', getMaintenance)
router.get('/:id', getMaintenanceById)
router.post('/', authorize('admin', 'super_admin', 'manager', 'branch_manager'), createMaintenance)
router.put('/:id', authorize('admin', 'super_admin', 'manager', 'branch_manager'), updateMaintenance)
router.delete('/:id', authorize('admin', 'super_admin', 'manager', 'branch_manager'), deleteMaintenance)

// Evidence
router.post('/:id/evidence-otp', authorize('admin', 'super_admin', 'manager', 'branch_manager'), generateEvidenceOtp)
router.get('/:id/evidence', getEvidence)
router.post('/:id/evidence', authorize('admin', 'super_admin', 'manager', 'branch_manager'), multerUpload.array('photos', 3), validateEvidenceFiles, compressAndSave, uploadEvidence)
router.delete('/:id/evidence/:evidenceId', authorize('admin', 'super_admin', 'manager', 'branch_manager'), deleteEvidence)

// Approval
router.post('/:id/approve', authorize('admin', 'super_admin'), approveMaintenance)
router.post('/:id/reject', authorize('admin', 'super_admin'), rejectMaintenance)
// Self-service: xodim o'z kutilayotgan yozuvini o'zi qaytarib oladi / tuzatib qayta yuboradi
router.post('/:id/withdraw', authorize('admin', 'super_admin', 'manager', 'branch_manager'), withdrawMaintenance)
router.post('/:id/resubmit', authorize('admin', 'super_admin', 'manager', 'branch_manager'), resubmitMaintenance)

export default router
