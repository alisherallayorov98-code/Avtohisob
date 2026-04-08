import { Router } from 'express'
import { previewImport, importData, getTemplate } from '../controllers/importData'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate, authorize('admin', 'manager'))
router.post('/preview', previewImport)
router.post('/import', importData)
router.get('/template/:type', getTemplate)
export default router
