import { Router } from 'express'
import multer from 'multer'
import { previewImport, importData, getTemplate, importFromExcel, listImportBatches, undoImportBatch } from '../controllers/importData'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const router = Router()
router.use(authenticate, authorize('admin', 'manager'))
router.post('/preview', previewImport)
router.post('/import', importData)
router.get('/template/:type', getTemplate)
router.post('/parse-excel', upload.single('file'), importFromExcel)
// Import partiyalari — ro'yxat hamma admin/manager'ga, BEKOR qilish (permanent) faqat super_admin
router.get('/imports', listImportBatches)
router.post('/imports/:id/undo', authorize('super_admin'), undoImportBatch)
export default router
