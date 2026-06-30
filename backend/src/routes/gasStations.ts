import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { listGasStations, createGasStation, updateGasStation, deleteGasStation } from '../controllers/gasStations'

const router = Router()
router.use(authenticate)

router.get('/', listGasStations)
router.post('/', authorize('admin', 'manager'), createGasStation)
router.put('/:id', authorize('admin', 'manager'), updateGasStation)
router.delete('/:id', authorize('admin', 'manager'), deleteGasStation)

export default router
