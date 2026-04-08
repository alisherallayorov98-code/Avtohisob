import { Router } from 'express'
import { getInventory, getBranchInventory, addStock, updateInventory, getLowStock } from '../controllers/inventory'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/low-stock', getLowStock)
router.get('/branch/:id', getBranchInventory)
router.get('/', getInventory)
router.post('/add', authorize('admin', 'manager', 'branch_manager'), addStock)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), updateInventory)
export default router
