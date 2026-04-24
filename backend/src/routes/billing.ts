import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { listPlans, getMySubscription, upgradePlan, cancelSubscription, getInvoices, getUsage, seedPlans, listAllSubscriptions, approveSubscription, grantSubscription } from '../controllers/billing'

const router = Router()

router.get('/plans', listPlans)
router.get('/subscription', authenticate, getMySubscription)
router.get('/usage', authenticate, getUsage)
router.post('/upgrade', authenticate, upgradePlan)
router.post('/cancel', authenticate, cancelSubscription)
router.get('/invoices', authenticate, getInvoices)
router.post('/seed-plans', authenticate, seedPlans)

// Super admin: subscription management
router.get('/admin/subscriptions', authenticate, listAllSubscriptions)
router.post('/admin/subscriptions/:id/approve', authenticate, approveSubscription)
router.post('/admin/grant', authenticate, grantSubscription)

export default router
