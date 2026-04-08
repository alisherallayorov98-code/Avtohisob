import { Router } from 'express'
import { analyzeMeterImage, getMeterReading, getMeterHistory, updateMeterReading } from '../controllers/fuelMeter'
import { authenticate } from '../middleware/auth'
import { upload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.post('/analyze', upload.single('image'), analyzeMeterImage)
router.get('/history', getMeterHistory)
router.get('/:id', getMeterReading)
router.put('/:id', updateMeterReading)
export default router
