import { Router } from 'express'
import { getSpareParts, getSparePart, createSparePart, updateSparePart, deleteSparePart, reactivateSparePart, hardDeleteSparePart, bulkDeleteSpareParts, getLowStock, generateAllArticleCodes, getNextPartCode, suggestPartCode, getSparePartHistory } from '../controllers/spareParts'
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
// Tiklash — korxona egasi (admin) + platforma (super_admin). Har mijoz o'zini tiklaydi.
router.post('/:id/reactivate', authorize('admin', 'super_admin'), reactivateSparePart)
// Butunlay o'chirish (qaytarib bo'lmaydi) — FAQAT super_admin
router.delete('/:id/hard', authorize('super_admin'), hardDeleteSparePart)
// O'chirish = NOFAOL qilish (tiklanadi). FAQAT admin (korxona rahbari) — manager/filial emas.
router.post('/bulk-delete', authorize('admin', 'super_admin'), bulkDeleteSpareParts)
router.delete('/:id', authorize('admin', 'super_admin'), deleteSparePart)
export default router
