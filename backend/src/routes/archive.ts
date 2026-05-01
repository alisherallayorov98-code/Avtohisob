import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getArchive, restoreArchive, permanentDeleteArchive } from '../controllers/archive'

const router = Router()
router.use(authenticate)

// Faqat admin/manager arxivni ko'ra va boshqara oladi
router.get('/', authorize('admin', 'manager', 'super_admin'), getArchive)
router.post('/:id/restore', authorize('admin', 'manager', 'super_admin'), restoreArchive)
router.delete('/:id', authorize('admin', 'super_admin'), permanentDeleteArchive)

export default router
