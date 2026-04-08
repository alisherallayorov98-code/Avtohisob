import { Router } from 'express'
import { getSuppliers, getSupplier, createSupplier, updateSupplier } from '../controllers/suppliers'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getSuppliers)
router.get('/:id', getSupplier)
router.post('/', authorize('admin', 'manager'), createSupplier)
router.put('/:id', authorize('admin', 'manager'), updateSupplier)
export default router
