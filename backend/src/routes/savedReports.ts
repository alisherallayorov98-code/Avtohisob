import { Router } from 'express'
import { listSavedReports, getSavedReport, saveReport, deleteSavedReport } from '../controllers/savedReports'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/', listSavedReports)
router.get('/:id', getSavedReport)
router.post('/', saveReport)
router.delete('/:id', deleteSavedReport)
export default router
