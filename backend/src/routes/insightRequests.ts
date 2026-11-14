// Tahlil so'rovlari: admin filialga yuboradi, filial mas'uli javob beradi.
import { Router, Response, NextFunction } from 'express'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { AuthRequest, successResponse } from '../types'
import {
  sendRequests, listRequestsForAdmin, adminRequestAction, listRequestsForBranch, branchAnswer, branchRecheck, requestBadge,
} from '../services/insightRequestsService'

type Handler = (req: AuthRequest) => Promise<unknown>
const wrap = (fn: Handler) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(successResponse(await fn(req))) } catch (err) { next(err) }
}

const ADMIN = authorize('admin', 'super_admin')
const BRANCH = authorize('manager', 'branch_manager', 'operator')

const router = Router()
router.use(authenticate)

// Menyudagi raqam — hamma rol (o'z doirasida)
router.get('/badge', wrap(req => requestBadge(req.user!)))

// Filial mas'uli
router.get('/mine', BRANCH, wrap(req => listRequestsForBranch(req.user!)))
router.post('/:id/answer', BRANCH, wrap(req => branchAnswer(req.user!, req.params.id, req.body)))
router.post('/:id/recheck', BRANCH, wrap(req => branchRecheck(req.user!, req.params.id)))

// Admin
router.post('/send', ADMIN, wrap(req => sendRequests(req.user!, req.body)))
router.get('/', ADMIN, wrap(req => listRequestsForAdmin(req.user!, (req.query.status as string) || undefined)))
router.post('/:id/action', ADMIN, wrap(req => adminRequestAction(req.user!, req.params.id, req.body)))

export default router
