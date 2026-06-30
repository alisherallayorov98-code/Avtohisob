import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getOrgSettings, toggleSimplifiedView, setHiddenFeatures, setFuelThresholds, setFuelDistanceMode } from '../controllers/orgSettings'

const router = Router()
router.use(authenticate)

// Faqat admin/manager o'qiy oladi (UI da toggle ko'rsatish uchun)
router.get('/', authorize('admin', 'manager', 'super_admin'), getOrgSettings)
// Faqat admin toggle qila oladi (parol bilan)
router.put('/simplified-view', authorize('admin', 'super_admin'), toggleSimplifiedView)
// Yashirilgan funksiyalar — admin
router.put('/hidden-features', authorize('admin', 'super_admin'), setHiddenFeatures)
// Bak nazorati threshold'lari — admin/manager
router.put('/fuel-thresholds', authorize('admin', 'manager', 'super_admin'), setFuelThresholds)
// Yoqilg'i masofa rejimi (manual | gps) — admin/manager
router.put('/fuel-distance-mode', authorize('admin', 'manager', 'super_admin'), setFuelDistanceMode)

export default router
