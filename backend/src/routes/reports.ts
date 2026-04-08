import { Router } from 'express'
import { getVehiclesReport, getExpensesReport, getFuelReport, getMaintenanceReport, getInventoryReport, getBranchReport, getDashboardStats, getVehicleDetailReport } from '../controllers/reports'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/dashboard', getDashboardStats)
router.get('/vehicles', getVehiclesReport)
router.get('/expenses', getExpensesReport)
router.get('/fuel', getFuelReport)
router.get('/maintenance', getMaintenanceReport)
router.get('/inventory', getInventoryReport)
router.get('/branch', getBranchReport)
router.get('/vehicle/:id', getVehicleDetailReport)
export default router
