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

import { requireFeature } from '../middleware/subscriptionGuard'

const router = Router()
router.use(authenticate)

// Overview (free)
router.get('/overview', getAnalyticsOverview)

// Health scores — Professional+
router.get('/health-scores', requireFeature('health_monitoring'), getHealthScores)
router.get('/health-scores/:vehicleId/history', requireFeature('health_monitoring'), getVehicleHealthHistory)
router.post('/health-scores/:vehicleId/recalculate', requireFeature('health_monitoring'), authorize('admin', 'manager'), recalculateHealth)

// Anomalies — Professional+
router.get('/anomalies', requireFeature('anomaly_detection'), getAnomalies)
router.patch('/anomalies/:id/resolve', requireFeature('anomaly_detection'), authorize('admin', 'manager', 'branch_manager'), resolveAnomaly)
router.post('/anomalies/detect/:vehicleId', requireFeature('anomaly_detection'), authorize('admin', 'manager'), runAnomalyDetection)

// Recommendations — Professional+
router.get('/recommendations', requireFeature('maintenance_predictions'), getRecommendations)
router.patch('/recommendations/:id/dismiss', requireFeature('maintenance_predictions'), dismissRecommendation)
router.post('/recommendations/generate', requireFeature('maintenance_predictions'), authorize('admin', 'manager'), triggerRecommendations)
router.post('/recommendations/generate/:vehicleId', requireFeature('maintenance_predictions'), authorize('admin', 'manager'), triggerRecommendations)

// Predictions — Professional+
router.get('/predictions', requireFeature('maintenance_predictions'), getAllPredictions)
router.get('/predictions/:vehicleId', requireFeature('maintenance_predictions'), getPredictions)
router.post('/predictions/:vehicleId/run', requireFeature('maintenance_predictions'), authorize('admin', 'manager'), runPrediction)
router.patch('/predictions/:id/acknowledge', requireFeature('maintenance_predictions'), acknowledgePrediction)

// Fuel analytics — Starter+
router.get('/fuel', requireFeature('fuel_analytics'), getFuelAnalytics)
router.get('/fuel/:vehicleId', requireFeature('fuel_analytics'), getVehicleFuelMetrics)

// Alerts (free — basic alerts should work for all plans)
router.get('/alerts', getAlerts)
router.patch('/alerts/:id/read', markAlertRead)

export default router
