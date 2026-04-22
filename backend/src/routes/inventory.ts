import { Router } from 'express'
import { getInventory, getInventoryStats, getBranchInventory, addStock, updateInventory, getLowStock, adjustInventory, deleteInventory, moveWarehouseInventory } from '../controllers/inventory'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/stats', getInventoryStats)
router.get('/low-stock', getLowStock)
router.get('/branch/:id', getBranchInventory)
router.get('/', getInventory)
router.post('/move-warehouse', authorize('admin', 'manager'), moveWarehouseInventory)
router.post('/add', authorize('admin', 'manager', 'branch_manager'), addStock)
router.post('/:id/adjust', authorize('admin'), adjustInventory)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateInventory)
router.delete('/:id', authorize('admin'), deleteInventory)
export default router
