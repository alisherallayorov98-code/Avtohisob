import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { submitLead, listLeads, getLead, updateLead, deleteLead } from '../controllers/leads'
import { authenticate } from '../middleware/auth'

// ─── Public lead submission router (no auth) ─────────────────────────────────
// Strict rate-limit: 5 ariza / 15 daqiqa / IP. Spam himoyasi controller'da ham bor (3/24h DB darajasida).
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Juda ko\'p ariza yuborildi. Biroz kuting va qayta urinib ko\'ring.' },
  standardHeaders: true,
  legacyHeaders: false,
})

export const publicLeadsRouter = Router()
publicLeadsRouter.post('/', submitLimiter, submitLead)

// ─── Admin leads router (super_admin only — guard inside controllers) ────────
const adminRouter = Router()
adminRouter.use(authenticate)
adminRouter.get('/', listLeads)
adminRouter.get('/:id', getLead)
adminRouter.patch('/:id', updateLead)
adminRouter.delete('/:id', deleteLead)

export default adminRouter
