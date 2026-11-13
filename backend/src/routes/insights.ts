import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import {
  getInsightsHandler, dismissInsightHandler, listDismissalsHandler, restoreDismissalHandler,
} from '../controllers/insights'

// Tahlil (robot yordamchi) — FAQAT admin
const router = Router()
router.use(authenticate)
router.use(authorize('admin', 'super_admin'))

router.get('/', getInsightsHandler)
router.get('/dismissals', listDismissalsHandler)
router.post('/dismiss', dismissInsightHandler)
router.delete('/dismissals/:id', restoreDismissalHandler)

export default router
