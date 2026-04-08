import { Router } from 'express'
import { listTickets, getTicket, createTicket, replyTicket, updateTicketStatus, getTicketStats } from '../controllers/support'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

router.get('/stats', authorize('admin', 'manager'), getTicketStats)
router.get('/', listTickets)
router.get('/:id', getTicket)
router.post('/', createTicket)
router.post('/:id/reply', replyTicket)
router.patch('/:id/status', authorize('admin', 'manager'), updateTicketStatus)

export default router
