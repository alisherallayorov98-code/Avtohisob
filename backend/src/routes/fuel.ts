import { Router } from 'express'
import { getFuelRecords, getFuelRecord, createFuelRecord, updateFuelRecord, getVehicleFuelRecords, getFuelReport } from '../controllers/fuel'
import { authenticate } from '../middleware/auth'
import { upload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.get('/report', getFuelReport)
router.get('/vehicle/:id', getVehicleFuelRecords)
router.get('/', getFuelRecords)
router.get('/:id', getFuelRecord)
router.post('/', upload.single('receipt'), createFuelRecord)
router.put('/:id', updateFuelRecord)
export default router
