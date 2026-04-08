import { Router } from 'express'
import { getNotifications, markAsRead, deleteNotification } from '../controllers/notifications'
import { authenticate } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.get('/', getNotifications)
router.put('/:id/read', markAsRead)
router.delete('/:id', deleteNotification)
export default router
