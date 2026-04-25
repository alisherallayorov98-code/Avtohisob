import { Router } from 'express'
import { authenticate } from '../../../middleware/auth'
import { getRegions, createRegion, updateRegion, deleteRegion } from '../controllers/regions'
import { getDistricts, createDistrict, updateDistrict, deleteDistrict } from '../controllers/districts'
import { getMfys, createMfy, updateMfy, deleteMfy } from '../controllers/mfys'
import { getStreets, createStreet, updateStreet, deleteStreet } from '../controllers/streets'
import { getLandfills, createLandfill, updateLandfill, deleteLandfill } from '../controllers/landfills'

const router = Router()
router.use(authenticate)

router.get('/regions', getRegions)
router.post('/regions', createRegion)
router.put('/regions/:id', updateRegion)
router.delete('/regions/:id', deleteRegion)

router.get('/districts', getDistricts)
router.post('/districts', createDistrict)
router.put('/districts/:id', updateDistrict)
router.delete('/districts/:id', deleteDistrict)

router.get('/mfys', getMfys)
router.post('/mfys', createMfy)
router.put('/mfys/:id', updateMfy)
router.delete('/mfys/:id', deleteMfy)

router.get('/streets', getStreets)
router.post('/streets', createStreet)
router.put('/streets/:id', updateStreet)
router.delete('/streets/:id', deleteStreet)

router.get('/landfills', getLandfills)
router.post('/landfills', createLandfill)
router.put('/landfills/:id', updateLandfill)
router.delete('/landfills/:id', deleteLandfill)

export default router
