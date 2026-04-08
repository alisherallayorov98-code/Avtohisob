import { Router } from 'express'
import { exportVehicles, exportFuelRecords, exportMaintenance, exportInventory, exportFullReport, exportVehicleReport, export1CReport, exportExpenses, exportBranches } from '../controllers/exports'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate, authorize('admin', 'manager', 'branch_manager'))
router.get('/vehicles', exportVehicles)
router.get('/fuel-records', exportFuelRecords)
router.get('/maintenance', exportMaintenance)
router.get('/inventory', exportInventory)
router.get('/expenses', exportExpenses)
router.get('/branches', exportBranches)
router.get('/full-report', exportFullReport)
router.get('/vehicle-report/:id', exportVehicleReport)
router.get('/1c-report', export1CReport)
export default router
