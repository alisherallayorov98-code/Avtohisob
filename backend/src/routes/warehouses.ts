import { Router } from 'express'
import { getWarehouses, getWarehouse, createWarehouse, updateWarehouse, deleteWarehouse } from '../controllers/warehouses'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getWarehouses)
router.get('/:id', getWarehouse)
router.post('/', authorize('admin'), createWarehouse)
router.put('/:id', authorize('admin'), updateWarehouse)
router.delete('/:id', authorize('admin'), deleteWarehouse)
export default router
