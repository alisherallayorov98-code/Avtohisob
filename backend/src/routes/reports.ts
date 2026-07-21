import { Router } from 'express'
import { getVehiclesReport, getExpensesReport, getFuelReport, getFuelDailyReport, getMaintenanceReport, getInventoryReport, getBranchReport, getDashboardStats, getVehicleDetailReport, getMonthlyTrend, getCostPerKm, getDriverStats, getFleetStatus, getSummaryReport } from '../controllers/reports'
import { getPartsAct } from '../controllers/dalolatnoma'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/fleet-status', getFleetStatus)
router.get('/dashboard', getDashboardStats)
router.get('/monthly-trend', getMonthlyTrend)
router.get('/cost-per-km', getCostPerKm)
router.get('/driver-stats', getDriverStats)
router.get('/vehicles', getVehiclesReport)
router.get('/expenses', getExpensesReport)
router.get('/fuel', getFuelReport)
router.get('/fuel-daily', getFuelDailyReport)
router.get('/maintenance', getMaintenanceReport)
router.get('/inventory', getInventoryReport)
router.get('/branch', getBranchReport)
router.get('/vehicle/:id', getVehicleDetailReport)
router.get('/summary', getSummaryReport)
router.get('/dalolatnoma', getPartsAct)
export default router
