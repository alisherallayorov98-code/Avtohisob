import { Router } from 'express'
import { listStats, getOneStats, triggerRecalculate, getRanking, getOverview } from '../controllers/sparePartStats'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', listStats)
router.get('/ranking', getRanking)
router.get('/overview', getOverview)
router.get('/:sparePartId', getOneStats)
router.post('/recalculate', authorize('admin'), triggerRecalculate)
export default router
