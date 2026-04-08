import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { listPlans, getMySubscription, upgradePlan, cancelSubscription, getInvoices, seedPlans } from '../controllers/billing'

const router = Router()

router.get('/plans', listPlans)
router.get('/subscription', authenticate, getMySubscription)
router.post('/upgrade', authenticate, upgradePlan)
router.post('/cancel', authenticate, cancelSubscription)
router.get('/invoices', authenticate, getInvoices)
router.post('/seed-plans', authenticate, authorize('admin'), seedPlans)

export default router
