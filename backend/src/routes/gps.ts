import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getGpsStatus, connectGps, triggerGpsSync, disconnectGps } from '../controllers/gps'

const router = Router()
router.use(authenticate)

router.get('/status', getGpsStatus)
router.post('/connect', connectGps)
router.post('/sync', triggerGpsSync)
router.delete('/disconnect', disconnectGps)

export default router
