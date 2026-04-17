import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getGpsStatus, connectGps, triggerGpsSync, disconnectGps, getUnitsMapping, setVehicleGpsUnit } from '../controllers/gps'

const router = Router()
router.use(authenticate)

router.get('/status', getGpsStatus)
router.post('/connect', connectGps)
router.post('/sync', triggerGpsSync)
router.delete('/disconnect', disconnectGps)
router.get('/units-mapping', authorize('admin', 'manager'), getUnitsMapping)
router.post('/set-unit-mapping', authorize('admin', 'manager'), setVehicleGpsUnit)

export default router
