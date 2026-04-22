import { Router } from 'express'
import { getVehiclesForTracking, getVehicleTracking, saveVehicleTracking } from '../controllers/tireTracking'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/vehicles', getVehiclesForTracking)
router.get('/vehicles/:vehicleId', getVehicleTracking)
router.put('/vehicles/:vehicleId', saveVehicleTracking)
export default router
