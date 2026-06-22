import { Router } from 'express'
import multer from 'multer'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getOrgOilSettings, saveOrgOilSettings, getOilOverview, exportOilOverviewExcel, bulkOilSetup, recordOilChange, getKmAtDate, getVehicleMileageReport, getOilHistory, importOilSetup, downloadOilImportTemplate } from '../controllers/oilChange'

const router = Router()
router.use(authenticate)

// Ommaviy import: Excel faylni xotirada qabul qilamiz (diskka yozilmaydi)
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

router.get('/settings', getOrgOilSettings)
router.post('/settings', authorize('admin', 'super_admin', 'manager'), saveOrgOilSettings)
router.get('/overview', getOilOverview)
router.get('/overview/excel', exportOilOverviewExcel)
router.post('/bulk-setup', authorize('admin', 'super_admin', 'manager', 'branch_manager'), bulkOilSetup)
router.post('/record', authorize('admin', 'super_admin', 'manager', 'branch_manager'), recordOilChange)
router.get('/km-at-date', getKmAtDate)
router.get('/vehicle-report', getVehicleMileageReport)
router.get('/history', getOilHistory)
router.get('/import/template', downloadOilImportTemplate)
router.post('/import', authorize('admin', 'super_admin', 'manager', 'branch_manager'), importUpload.single('file'), importOilSetup)

export default router
