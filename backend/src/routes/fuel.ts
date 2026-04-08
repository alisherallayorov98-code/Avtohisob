import { Router } from 'express'
import { getFuelRecords, getFuelRecord, createFuelRecord, updateFuelRecord, deleteFuelRecord, getVehicleFuelRecords, getFuelReport, getFuelRecord_stats } from '../controllers/fuel'
import { authenticate } from '../middleware/auth'
import { upload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.get('/report', getFuelReport)
router.get('/stats', getFuelRecord_stats)
router.get('/vehicle/:id', getVehicleFuelRecords)
router.get('/', getFuelRecords)
router.get('/:id', getFuelRecord)
router.post('/', upload.single('receipt'), createFuelRecord)
router.put('/:id', updateFuelRecord)
router.delete('/:id', deleteFuelRecord)
export default router
