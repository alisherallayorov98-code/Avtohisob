import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import {
  getInsightsHandler, dismissInsightHandler, listDismissalsHandler, restoreDismissalHandler, askHandler, dossierHandler,
  assigneesHandler, assignHandler, unassignHandler, getSettingsHandler, saveSettingsHandler, exportHandler,
} from '../controllers/insights'

// Tahlil (robot yordamchi) — FAQAT admin
const router = Router()
router.use(authenticate)
router.use(authorize('admin', 'super_admin'))

router.get('/', getInsightsHandler)
router.get('/export', exportHandler)
router.post('/ask', askHandler)
router.get('/vehicle/:id', dossierHandler)
router.get('/dismissals', listDismissalsHandler)
router.post('/dismiss', dismissInsightHandler)
router.delete('/dismissals/:id', restoreDismissalHandler)
router.get('/assignees', assigneesHandler)
router.post('/assign', assignHandler)
router.delete('/assign/:id', unassignHandler)
router.get('/settings', getSettingsHandler)
router.put('/settings', saveSettingsHandler)

export default router
