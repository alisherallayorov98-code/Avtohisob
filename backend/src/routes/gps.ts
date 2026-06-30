import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getGpsStatus, connectGps, triggerGpsSync, disconnectGps, getUnitsMapping, setVehicleGpsUnit, autoMatchUnits, backfillDailyKm, getBackfillStatus } from '../controllers/gps'

const router = Router()
router.use(authenticate)

router.get('/status', getGpsStatus)
router.post('/connect', authorize('admin', 'manager'), connectGps)
router.post('/sync', authorize('admin', 'manager'), triggerGpsSync)
router.delete('/disconnect', authorize('admin', 'manager'), disconnectGps)
router.get('/units-mapping', authorize('admin', 'manager'), getUnitsMapping)
router.post('/set-unit-mapping', authorize('admin', 'manager'), setVehicleGpsUnit)
router.post('/auto-match', authorize('admin', 'manager'), autoMatchUnits)
router.post('/backfill-daily-km', authorize('admin', 'manager'), backfillDailyKm)
router.get('/backfill-status', authorize('admin', 'manager'), getBackfillStatus)

export default router
