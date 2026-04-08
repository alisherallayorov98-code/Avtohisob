import { Router } from 'express'
import { listTires, getTire, createTire, updateTire, retireTire, replaceTire, addTireMaintenance, getTireStats } from '../controllers/tires'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

router.get('/stats', getTireStats)
router.get('/', listTires)
router.get('/:id', getTire)
router.post('/', authorize('admin', 'manager', 'branch_manager'), createTire)
router.patch('/:id', authorize('admin', 'manager', 'branch_manager'), updateTire)
router.post('/:id/retire', authorize('admin', 'manager'), retireTire)
router.post('/:id/replace', authorize('admin', 'manager'), replaceTire)
router.post('/:tireId/maintenance', authorize('admin', 'manager', 'branch_manager'), addTireMaintenance)

export default router
