import { Router } from 'express'
import { analyzeMeterImage, getMeterReading, getMeterHistory, updateMeterReading } from '../controllers/fuelMeter'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { upload } from '../middleware/upload'
import { requireFeature } from '../middleware/subscriptionGuard'

const router = Router()
router.use(authenticate)
router.post('/analyze', requireFeature('ai_analysis'), upload.single('image'), analyzeMeterImage)
router.get('/history', getMeterHistory)
router.get('/:id', getMeterReading)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateMeterReading)
export default router
