import { Router } from 'express'
import { exportVehicles, exportVehicleCosts, exportFuelRecords, exportFuelDaily, exportMaintenance, exportInventory, exportFullReport, exportVehicleReport, export1CReport, exportExpenses, exportBranches, exportSpareParts, exportTransfers, exportTires, exportWarranties, exportSuppliers, exportEngineMonitor, exportMasters } from '../controllers/exports'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { requireFeature } from '../middleware/subscriptionGuard'

const router = Router()
router.use(authenticate, authorize('admin', 'manager', 'branch_manager'), requireFeature('excel_export'))
router.get('/vehicles', exportVehicles)
router.get('/vehicle-costs', exportVehicleCosts)
router.get('/fuel-records', exportFuelRecords)
router.get('/fuel-daily', exportFuelDaily)
router.get('/maintenance', exportMaintenance)
router.get('/inventory', exportInventory)
router.get('/expenses', exportExpenses)
router.get('/branches', exportBranches)
router.get('/spare-parts', exportSpareParts)
router.get('/transfers', exportTransfers)
router.get('/tires', exportTires)
router.get('/warranties', exportWarranties)
router.get('/full-report', exportFullReport)
router.get('/vehicle-report/:id', exportVehicleReport)
router.get('/1c-report', export1CReport)
router.get('/suppliers', exportSuppliers)
router.get('/masters', exportMasters)
router.get('/engine-monitor', exportEngineMonitor)
export default router
