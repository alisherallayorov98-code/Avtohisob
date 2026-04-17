import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getTelegramSettings, saveTelegramSettings, testTelegram } from '../controllers/telegramSettings'

const router = Router()
router.use(authenticate)
router.get('/settings', getTelegramSettings)
router.post('/settings', authorize('admin', 'super_admin', 'manager'), saveTelegramSettings)
router.post('/test', authorize('admin', 'super_admin', 'manager'), testTelegram)
export default router
