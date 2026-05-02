import { Router } from 'express'
import { getSpareParts, getSparePart, createSparePart, updateSparePart, deleteSparePart, getLowStock, generateAllArticleCodes, getNextPartCode, suggestPartCode, getSparePartHistory } from '../controllers/spareParts'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { upload, validateUpload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.get('/low-stock', getLowStock)
router.get('/next-code', getNextPartCode)
router.get('/suggest-code', suggestPartCode)
router.get('/', getSpareParts)
router.get('/:id', getSparePart)
// Ehtiyot qism harakat tarixi (kirim, ishlatish, transfer, qaytarish — barcha manbalardan)
router.get('/:id/history', getSparePartHistory)
router.post('/', authorize('admin', 'manager'), upload.single('image'), validateUpload, createSparePart)
router.post('/generate-all-codes', authorize('admin'), generateAllArticleCodes)
router.put('/:id', authorize('admin', 'manager'), upload.single('image'), validateUpload, updateSparePart)
router.delete('/:id', authorize('admin', 'manager'), deleteSparePart)
export default router
