import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getFleetRiskDashboard, getVehicleRiskDetail } from '../controllers/fleetRisk'

const router = Router()
router.use(authenticate)

router.get('/', getFleetRiskDashboard)
router.get('/:id', getVehicleRiskDetail)

export default router
