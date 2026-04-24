import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { getAdminDashboard } from '../controllers/admin/dashboard'
import { listAdminUsers, getAdminUser, updateAdminUser, suspendAdminUser, activateAdminUser, deleteAdminUser, resetAdminUserPassword } from '../controllers/admin/users'
import { createOrganization, listOrganizations, getOrganization, setSubscription, suspendOrganization, activateOrganization, updateOrgAdmin, assignBranchesToOrg } from '../controllers/admin/organizations'
import { listAdminSubscriptions, getRevenueAnalytics, listAdminInvoices, approveSubscription, rejectSubscription, setMaxPlanType } from '../controllers/admin/billing'
import { listAdminTickets, getAdminTicket, replyAdminTicket, updateAdminTicketStatus } from '../controllers/admin/support'
import { listAdminAuditLogs } from '../controllers/admin/auditLogs'
import { listPromoCodes, createPromoCode, updatePromoCode, deletePromoCode } from '../controllers/admin/promoCodes'
import { getSystemMonitoring } from '../controllers/admin/monitoring'

const router = Router()
router.use(authenticate, authorize('super_admin'))

// Dashboard
router.get('/dashboard', getAdminDashboard)

// Users
router.get('/users', listAdminUsers)
router.get('/users/:id', getAdminUser)
router.patch('/users/:id', updateAdminUser)
router.post('/users/:id/suspend', suspendAdminUser)
router.post('/users/:id/activate', activateAdminUser)
router.delete('/users/:id', deleteAdminUser)
router.post('/users/:id/reset-password', resetAdminUserPassword)

// Organizations
router.post('/organizations', createOrganization)
router.get('/organizations', listOrganizations)
router.get('/organizations/:id', getOrganization)
router.post('/organizations/:id/subscription', setSubscription)
router.post('/organizations/:id/suspend', suspendOrganization)
router.post('/organizations/:id/activate', activateOrganization)
router.patch('/organizations/:id/admin', updateOrgAdmin)
router.post('/organizations/:id/branches', assignBranchesToOrg)

// Billing
router.get('/billing/subscriptions', listAdminSubscriptions)
router.post('/billing/subscriptions/:id/approve', approveSubscription)
router.post('/billing/subscriptions/:id/reject', rejectSubscription)
router.get('/billing/revenue', getRevenueAnalytics)
router.get('/billing/invoices', listAdminInvoices)
router.patch('/users/:id/max-plan-type', setMaxPlanType)

// Support
router.get('/support/tickets', listAdminTickets)
router.get('/support/tickets/:id', getAdminTicket)
router.post('/support/tickets/:id/reply', replyAdminTicket)
router.patch('/support/tickets/:id/status', updateAdminTicketStatus)

// Audit logs
router.get('/audit-logs', listAdminAuditLogs)

// Promo codes
router.get('/promo-codes', listPromoCodes)
router.post('/promo-codes', createPromoCode)
router.patch('/promo-codes/:id', updatePromoCode)
router.delete('/promo-codes/:id', deletePromoCode)

// Monitoring
router.get('/monitoring', getSystemMonitoring)

export default router
