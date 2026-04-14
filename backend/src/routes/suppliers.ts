import { Router } from 'express'
import { getSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, getSupplierDetail, createSupplierPayment, deleteSupplierPayment } from '../controllers/suppliers'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/', getSuppliers)
router.get('/:id/detail', getSupplierDetail)
router.get('/:id', getSupplier)
router.post('/', authorize('admin', 'manager'), createSupplier)
router.put('/:id', authorize('admin', 'manager'), updateSupplier)
router.delete('/:id', authorize('admin', 'manager'), deleteSupplier)
router.post('/:id/payments', authorize('admin', 'manager'), createSupplierPayment)
router.delete('/:id/payments/:paymentId', authorize('admin', 'manager'), deleteSupplierPayment)
export default router
