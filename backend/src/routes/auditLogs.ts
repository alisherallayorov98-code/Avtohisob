import { Router } from 'express'
import { getAuditLogs } from '../controllers/auditLogs'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.get('/', authenticate, authorize('admin'), getAuditLogs)
export default router
