import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { listPlans, getMySubscription, upgradePlan, cancelSubscription, getInvoices, getUsage, seedPlans, listAllSubscriptions, approveSubscription, grantSubscription, grantAllAdmins, setBranchPlan } from '../controllers/billing'

const router = Router()

router.get('/plans', listPlans)
router.get('/subscription', authenticate, getMySubscription)
router.get('/usage', authenticate, getUsage)
// Subscription mutations — only org admin can upgrade/cancel own subscription
router.post('/upgrade', authenticate, authorize('admin'), upgradePlan)
router.post('/cancel', authenticate, authorize('admin'), cancelSubscription)
router.get('/invoices', authenticate, getInvoices)
router.post('/seed-plans', authenticate, authorize('super_admin'), seedPlans)

// Admin: assign plan to a branch
router.post('/branches/:branchId/plan', authenticate, authorize('admin', 'super_admin'), setBranchPlan)

// Super admin: subscription management (defense-in-depth; controllers also check role)
router.get('/admin/subscriptions', authenticate, authorize('super_admin'), listAllSubscriptions)
router.post('/admin/subscriptions/:id/approve', authenticate, authorize('super_admin'), approveSubscription)
router.post('/admin/grant', authenticate, authorize('super_admin'), grantSubscription)
router.post('/admin/grant-all', authenticate, authorize('super_admin'), grantAllAdmins)

export default router
