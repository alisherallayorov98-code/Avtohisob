import { Router } from 'express'
import { getSpareParts, getSparePart, createSparePart, updateSparePart, deleteSparePart, getLowStock, generateAllArticleCodes, getNextPartCode } from '../controllers/spareParts'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { upload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.get('/low-stock', getLowStock)
router.get('/next-code', getNextPartCode)
router.get('/', getSpareParts)
router.get('/:id', getSparePart)
router.post('/', authorize('admin', 'manager'), upload.single('image'), createSparePart)
router.post('/generate-all-codes', authorize('admin'), generateAllArticleCodes)
router.put('/:id', authorize('admin', 'manager'), upload.single('image'), updateSparePart)
router.delete('/:id', authorize('admin', 'manager'), deleteSparePart)
export default router
