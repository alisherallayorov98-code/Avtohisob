import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import {
  getFuelLevels,
  refreshFuelLevels,
  getFuelHistory,
  getFuelSavings,
  updateFuelSettings,
} from '../controllers/fuelMonitoring'

const router = Router()
router.use(authenticate)

// Real-time monitoring
router.get('/levels', getFuelLevels)
router.post('/refresh', refreshFuelLevels)
router.get('/savings', getFuelSavings)

// Per-vehicle
router.get('/:vehicleId/history', getFuelHistory)
router.patch('/:vehicleId/settings', updateFuelSettings)

export default router
