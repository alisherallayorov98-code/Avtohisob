import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getTelegramSettings, saveTelegramSettings, testTelegram } from '../controllers/telegramSettings'
import { createLinkToken, listLinks, renameLink, deleteLink, testMessage } from '../controllers/telegramLink'
import { getOrgPrefs, upsertUserPref } from '../controllers/telegramPrefs'

const router = Router()
router.use(authenticate)

// Eski per-org token asosidagi sozlamalar (backward compat)
router.get('/settings', getTelegramSettings)
router.post('/settings', authorize('admin', 'super_admin', 'manager'), saveTelegramSettings)
router.post('/test', authorize('admin', 'super_admin', 'manager'), testTelegram)

// Yangi: markaziy bot + ko'p qurilma ulash
// Faqat admin/branch_manager adminlar Telegramga ulashi mumkin (smart alerts shu rollarga boradi)
router.post('/link-token', authorize('admin', 'super_admin', 'branch_manager'), createLinkToken)
router.get('/links', authorize('admin', 'super_admin', 'branch_manager'), listLinks)
router.patch('/links/:id', authorize('admin', 'super_admin', 'branch_manager'), renameLink)
router.delete('/links/:id', authorize('admin', 'super_admin', 'branch_manager'), deleteLink)
router.post('/test-message', authorize('admin', 'super_admin', 'branch_manager'), testMessage)

// Admin: org foydalanuvchilari uchun ogohlantirish prefs boshqaruvi
router.get('/admin/prefs', authorize('admin', 'super_admin'), getOrgPrefs)
router.put('/admin/prefs/:userId', authorize('admin', 'super_admin'), upsertUserPref)

export default router
