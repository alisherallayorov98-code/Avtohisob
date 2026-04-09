import { Router } from 'express'
import {
  listTires, getTire, createTire, updateTire,
  installTire, removeTire, verifyReturn, writeOffTire,
  retireTire, replaceTire,
  addTireMaintenance, getTireStats,
  listDeductions, settleDeduction, getTireEvents,
} from '../controllers/tires'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

router.get('/stats', getTireStats)
router.get('/deductions', listDeductions)
router.patch('/deductions/:id/settle', authorize('admin', 'manager'), settleDeduction)
router.post('/verify-return', verifyReturn)

router.get('/', listTires)
router.get('/:id', getTire)
router.get('/:id/events', getTireEvents)

router.post('/', authorize('admin', 'manager', 'branch_manager'), createTire)
router.patch('/:id', authorize('admin', 'manager', 'branch_manager'), updateTire)

router.post('/:id/install', authorize('admin', 'manager', 'branch_manager'), installTire)
router.post('/:id/remove', authorize('admin', 'manager', 'branch_manager'), removeTire)
router.post('/:id/write-off', authorize('admin', 'manager'), writeOffTire)

router.post('/:id/retire', authorize('admin', 'manager'), retireTire)
router.post('/:id/replace', authorize('admin', 'manager'), replaceTire)
router.post('/:tireId/maintenance', authorize('admin', 'manager', 'branch_manager'), addTireMaintenance)

export default router
