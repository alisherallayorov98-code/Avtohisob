import { Router } from 'express'
import { getVehiclesForTracking, getVehicleTracking, getSlotGpsKm, saveVehicleTracking } from '../controllers/tireTracking'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/vehicles', getVehiclesForTracking)
router.get('/vehicles/:vehicleId', getVehicleTracking)
router.get('/vehicles/:vehicleId/gps-km', getSlotGpsKm)
router.put('/vehicles/:vehicleId', saveVehicleTracking)
export default router
