import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import {
  getHealthScores, getVehicleHealthHistory, recalculateHealth,
  getAnomalies, resolveAnomaly, runAnomalyDetection,
  getRecommendations, dismissRecommendation, triggerRecommendations,
  getPredictions, getAllPredictions, runPrediction, acknowledgePrediction,
  getFuelAnalytics, getVehicleFuelMetrics,
  getAlerts, markAlertRead,
  getAnalyticsOverview,
} from '../controllers/analytics'

const router = Router()
router.use(authenticate)

// Overview
router.get('/overview', getAnalyticsOverview)

// Health scores
router.get('/health-scores', getHealthScores)
router.get('/health-scores/:vehicleId/history', getVehicleHealthHistory)
router.post('/health-scores/:vehicleId/recalculate', authorize('admin', 'manager'), recalculateHealth)

// Anomalies
router.get('/anomalies', getAnomalies)
router.patch('/anomalies/:id/resolve', authorize('admin', 'manager', 'branch_manager'), resolveAnomaly)
router.post('/anomalies/detect/:vehicleId', authorize('admin', 'manager'), runAnomalyDetection)

// Recommendations
router.get('/recommendations', getRecommendations)
router.patch('/recommendations/:id/dismiss', dismissRecommendation)
router.post('/recommendations/generate', authorize('admin', 'manager'), triggerRecommendations)
router.post('/recommendations/generate/:vehicleId', authorize('admin', 'manager'), triggerRecommendations)

// Predictions
router.get('/predictions', getAllPredictions)
router.get('/predictions/:vehicleId', getPredictions)
router.post('/predictions/:vehicleId/run', authorize('admin', 'manager'), runPrediction)
router.patch('/predictions/:id/acknowledge', acknowledgePrediction)

// Fuel analytics
router.get('/fuel', getFuelAnalytics)
router.get('/fuel/:vehicleId', getVehicleFuelMetrics)

// Alerts
router.get('/alerts', getAlerts)
router.patch('/alerts/:id/read', markAlertRead)

export default router
