import { Router } from 'express'
import { listArticleCodes, getCode, generateCode, getQRCode, getCodeStats } from '../controllers/articleCodes'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', listArticleCodes)
router.get('/stats', authorize('admin', 'manager'), getCodeStats)
router.get('/:sparePartId', getCode)
router.get('/:sparePartId/qr', getQRCode)
router.post('/generate', authorize('admin', 'manager'), generateCode)
export default router
