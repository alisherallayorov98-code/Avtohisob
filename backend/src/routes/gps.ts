import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getGpsStatus, connectGps, triggerGpsSync, disconnectGps, getUnitsMapping, setVehicleGpsUnit } from '../controllers/gps'

const router = Router()
router.use(authenticate)

router.get('/status', getGpsStatus)
router.post('/connect', authorize('admin', 'manager'), connectGps)
router.post('/sync', authorize('admin', 'manager'), triggerGpsSync)
router.delete('/disconnect', authorize('admin', 'manager'), disconnectGps)
router.get('/units-mapping', authorize('admin', 'manager'), getUnitsMapping)
router.post('/set-unit-mapping', authorize('admin', 'manager'), setVehicleGpsUnit)

export default router
